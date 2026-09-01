/**
 * Experience library store (skills).
 *
 * Persists user-authored skills as SKILL.md documents under
 * `<documents>/skills/<name>/SKILL.md` plus a metadata index at
 * `skills/index.json`. The index is authoritative for the library shape
 * (stable id, timestamps, soft-delete tombstones — the minimal trio needed
 * for a future cloud sync); the SKILL.md files carry the document bodies.
 *
 * The in-memory list is the single source of truth during a session; every
 * mutation is mirrored to disk. Persistence IO is injectable so tests can
 * use an in-memory filesystem.
 */

import {
  isValidSkillName,
  parseSkillMarkdown,
  serializeSkillMarkdown,
} from '../agent/skillFile';

export interface SkillRecord {
  /** Stable id, decoupled from the (renamable) name; the sync key of the future. */
  id: string;
  name: string;
  description: string;
  body: string;
  createdAt: number;
  updatedAt: number;
  /** Soft-delete tombstone; set records stay in the index but are hidden. */
  deletedAt: number | null;
  /** Disabled skills are kept (files and index intact) but never retrieved. */
  disabledAt: number | null;
  /** Origin marker used for display; bundled records follow the same CRUD rules. */
  builtIn: boolean;
}

/** Index entry persisted to skills/index.json (no body — SKILL.md has it). */
interface SkillIndexEntry {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  disabledAt: number | null;
  builtIn: boolean;
}

export interface SkillsIO {
  /** Absolute path of the skills directory (no trailing slash needed). */
  dirPath: string;
  readFile: (path: string) => Promise<string | null>;
  writeFile: (path: string, content: string) => Promise<void>;
  makeDir: (path: string) => Promise<void>;
  listDir: (path: string) => Promise<string[]>;
  /** Best-effort recursive delete; failures are ignored by the caller. */
  deletePath: (path: string) => Promise<void>;
}

export interface LoadSkillsOptions {
  /** Override persistence (used by tests); defaults to the app documents dir. */
  io?: SkillsIO;
}

export interface SkillMutationResult {
  ok: boolean;
  error?: string;
}

export interface PortableSkill {
  name: string;
  description: string;
  body: string;
  disabled: boolean;
}

export type PortableSkillsParseResult =
  | { ok: true; skills: PortableSkill[] }
  | { ok: false; error: 'invalid_skills' | 'too_many_skills' };

export const MAX_IMPORTED_SKILLS = 500;

let _skills: SkillRecord[] = [];
let _listeners: Array<(skills: SkillRecord[]) => void> = [];
let _io: SkillsIO | null = null;

function notify(): void {
  const snapshot = [..._skills];
  for (const listener of _listeners) listener(snapshot);
}

function defaultIO(): SkillsIO {
  // Lazy-require so tests can inject a custom IO without touching the
  // native expo-file-system module (same pattern as favoritesStore).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const FileSystem = require('expo-file-system/legacy') as typeof import('expo-file-system/legacy');
  const dirPath = (FileSystem.documentDirectory ?? '') + 'skills/';
  const read = (path: string) =>
    FileSystem.readAsStringAsync(path, { encoding: FileSystem.EncodingType.UTF8 }).catch(
      () => null,
    );
  return {
    dirPath,
    readFile: read,
    writeFile: (path, content) =>
      FileSystem.writeAsStringAsync(path, content, {
        encoding: FileSystem.EncodingType.UTF8,
      }).catch(() => {}),
    makeDir: (path) => FileSystem.makeDirectoryAsync(path, { intermediates: true }).catch(() => {}),
    listDir: (path) => FileSystem.readDirectoryAsync(path).catch(() => []),
    deletePath: (path) => FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {}),
  };
}

/** Stable local id; no uuid dependency. */
function generateId(): string {
  return `skill-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeIndex(raw: unknown): SkillIndexEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: SkillIndexEntry[] = [];
  for (const entry of raw) {
    const e = entry as Record<string, unknown> | null | undefined;
    if (!e || typeof e !== 'object') continue;
    if (typeof e.id !== 'string' || typeof e.name !== 'string') continue;
    if (!isValidSkillName(e.name)) continue;
    out.push({
      id: e.id,
      name: e.name,
      description: typeof e.description === 'string' ? e.description : '',
      createdAt: typeof e.createdAt === 'number' ? e.createdAt : Date.now(),
      updatedAt: typeof e.updatedAt === 'number' ? e.updatedAt : Date.now(),
      deletedAt: typeof e.deletedAt === 'number' ? e.deletedAt : null,
      disabledAt: typeof e.disabledAt === 'number' ? e.disabledAt : null,
      // Migrate indexes written before builtIn was persisted.
      builtIn: e.builtIn === true || isBundledSkillName(e.name),
    });
  }
  return out;
}

function indexPath(): string {
  return (_io?.dirPath ?? '') + 'index.json';
}

function skillDirPath(name: string): string {
  return `${_io?.dirPath ?? ''}${name}/`;
}

function skillFilePath(name: string): string {
  return `${skillDirPath(name)}SKILL.md`;
}

/** Rewrites skills/index.json with the full in-memory list (tombstones included). */
function persistIndex(): void {
  void writeIndexSnapshot();
}

async function writeIndexSnapshot(): Promise<void> {
  const io = _io;
  if (!io) return;
  const entries: SkillIndexEntry[] = _skills.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    deletedAt: s.deletedAt,
    disabledAt: s.disabledAt,
    builtIn: s.builtIn,
  }));
  await Promise.resolve(io.writeFile(indexPath(), JSON.stringify(entries, null, 2))).catch(() => {
    // Write failures never block the session — keep the in-memory state.
  });
}

/**
 * Built-in seed skill written the first time the library is created, so the
 * end-to-end path (catalog injection + read_skill) works out of the box.
 * Content follows the scroll-until-found pattern from docs/agent-patterns.md.
 */
const SEED_SKILL = {
  name: 'scroll-list-search',
  description: '在长列表/滚动页面中查找目标条目的通用流程（先读屏幕树，找不到再滚动）',
  body: [
    '## 适用场景',
    '需要在可滚动的长列表（联系人、订单、歌曲、设置项等）中定位某个目标条目。',
    '',
    '## 操作流程',
    '1. 调用 ui_inspect 查看当前界面结构，检查目标条目是否已可见。',
    '2. 若可见且目标文本唯一：直接调用 ui_tap 的 text 模式点击；存在同名条目时再查询节点消歧。',
    '3. 若不可见：调用 scroll 向下滚动一屏，再重复第 1 步。',
    '4. 连续滚动 3 次仍找不到时，改用搜索框或筛选入口缩小范围；无搜索能力则调用 task_failed 说明目标不存在。',
    '',
    '## 验证点',
    '- 每次滚动后必须重新调用 ui_inspect，不能凭记忆点击。',
    '- 定位到条目后先核对文本与目标完全一致再点击，避免误点同名或近似条目。',
    '',
    '## 陷阱',
    '- 不要盲目连续滚动超过 3 次：可能已错过目标，应先回滚或换搜索方式。',
    '- 部分应用滚动后无障碍树未刷新，需要先 wait 500ms 再 ui_inspect。',
  ].join('\n'),
};

/**
 * Bundled experience specifically for entering and using NetEase Cloud Music
 * search. It is intentionally not a general app skill: playback, playlists,
 * account management and other product flows are outside its scope.
 */
const NETEASE_CLOUD_MUSIC_SEARCH_SKILL = {
  name: 'netease-cloud-music-search',
  description: '在网易云音乐中可靠进入搜索页并搜索指定歌曲、歌手或内容，覆盖播放器页、广告遮罩和搜索入口点击无效等场景',
  body: [
    '## 适用场景',
    '用户要求在网易云音乐中搜索指定歌曲、歌手或其他内容。目标应用包名为 `com.netease.cloudmusic`。本经验只负责进入搜索、提交关键词并确认结果，不覆盖播放、收藏、歌单或账号操作。',
    '',
    '## 操作流程',
    '1. 调用 open_app 打开 `com.netease.cloudmusic`，确认 launchConfirmed=true。',
    '2. 调用 ui_inspect 判断当前页面；如果树中没有明确、可点击的搜索入口，立即调用 ui_screenshot，不要通过 back 或 home 猜测导航路径。',
    '3. 若处于播放页但底部仍显示“搜索”页签，直接按“搜索”文本点击该页签。点击后页面未变化时，使用最新截图中“搜索”文字或图标的中心坐标重试一次。ref 和坐标只对当前页面有效，不得跨页面复用。',
    '4. 若有广告、视频或活动遮罩，先在截图中寻找“关闭”“跳过”或关闭图标；按钮暂不可用时等待一次后重新截图。不要用系统 back 关闭遮罩，以免直接退出网易云。',
    '5. 进入搜索页后，若输入框语义明确，直接调用 ui_fill 写入“歌手名 歌曲名”并提交；存在多个输入框时再观察和消歧。',
    '6. 搜索结果出现后，核对搜索词以及结果中的歌曲名、歌手名或内容类型；同名内容存在时不要只按标题判断。',
    '7. 用户目标仅为搜索时，在确认结果页已出现目标相关内容后调用 task_complete；不要擅自点击结果或开始播放。用户另有后续明确要求时，再依据当前界面继续处理，但不要把后续操作归因于本经验。',
    '',
    '## 返回键约束',
    '- 不要把 home 当作寻找搜索入口的办法。',
    '- 只有截图或结构明确证明当前是需要退出的子页面，才允许调用一次 back。',
    '- 每次 back 后必须重新 ui_inspect 或 ui_screenshot；没有新鲜观察结果时禁止连续 back。',
    '- 如果一次点击返回成功但页面没有变化，应重新观察并换用视觉坐标，不要立刻 back。',
    '',
    '## 验证点',
    '- ui_tap 返回 true 只表示点击请求已执行，不表示已经进入搜索页或完成搜索。',
    '- 搜索页应能看到输入框、搜索词或结果列表中的至少一项。',
    '- 完成前必须确认搜索词已提交，并且结果页出现与目标相关的歌曲、歌手或内容。',
  ].join('\n'),
};

/**
 * Bundled experience for Bilibili's one-click triple interaction only. The
 * visual coordinates are always derived from a fresh ui_screenshot; no layout
 * constants or app-specific coordinates are persisted here.
 */
const LEGACY_BILIBILI_LONG_PRESS_STEP =
  '5. 调用 ui_long_press 的 coordinate 模式，在最新截图中的点赞图标中心执行物理长按，并携带最新 observationId。不要使用 ref 模式代替物理长按，也不要把点赞、投币、收藏拆成三个普通点击。';
const CURRENT_BILIBILI_LONG_PRESS_STEP =
  '5. 调用 ui_long_press 的 coordinate 模式，在最新截图中的点赞图标中心执行约 3000 毫秒的物理长按（durationMs=3000），并携带最新 observationId。不要使用 ref 模式代替物理长按，也不要把点赞、投币、收藏拆成三个普通点击。';
const LEGACY_BILIBILI_DESCRIPTION =
  '在哔哩哔哩视频详情页执行一键三连：定位点赞按钮并通过物理长按触发点赞、投币和收藏';
const LEGACY_BILIBILI_BODY = [
  '## 适用场景',
  '用户明确要求在哔哩哔哩对当前或指定视频“一键三连”。目标应用通常为 `tv.danmaku.bili`。本经验只覆盖长按点赞触发点赞、投币、收藏，不覆盖评论、关注、充电或分享。',
  '',
  '## 操作流程',
  '1. 确认当前位于目标视频的详情或播放页面，并从当前界面核对视频标题。若尚未进入目标视频，先完成定位和进入视频。',
  '2. 调用 ui_screenshot，结合图片和结构信息定位互动栏中的“点赞”按钮。记录该截图返回的 observationId，以及点赞图标中心的 0～1000 归一化坐标。不要使用投币或收藏按钮作为长按目标。',
  '3. 一键三连会同时点赞、投币和收藏，属于会产生真实外部影响的操作。调用 confirm_action，说明目标视频及将执行的三项动作，等待用户授权。',
  '4. confirmed=true 后重新调用 ui_screenshot。风险确认期间前台应用发生过切换，确认前的 observationId、ref 和坐标不得继续使用。重新核对仍在同一个视频页面，并重新取得点赞图标中心坐标。',
  CURRENT_BILIBILI_LONG_PRESS_STEP,
  '6. 长按完成后等待一次界面反馈，再重新 ui_screenshot，检查点赞、投币、收藏三个图标的选中状态、三连动画或页面提示。',
  '7. 三项状态均已生效时完成任务。若页面明确提示硬币不足、已投币、登录失效或其他失败原因，如实向用户说明；结果不明确时不得宣称投币成功。',
  '',
  '## 验证点',
  '- 一键三连的操作目标是点赞图标，动作是持续物理长按。',
  '- ui_long_press 返回成功只说明手势已派发，最终结果以操作后的页面状态和提示为准。',
  '- 风险确认前后的观察结果不跨界面复用。',
].join('\n');
const PREVIOUS_BILIBILI_LONG_PRESS_ONLY_BODY =
  '在哔哩哔哩视频页执行“一键三连”时，对点赞图标中心调用 ui_long_press 的 coordinate 模式，并设置 durationMs=3000。';
const BILIBILI_LONG_PRESS_ONLY_BODY =
  '在哔哩哔哩视频页执行“一键三连”时，对点赞图标中心调用 ui_long_press 的 coordinate 模式，使用最新截图的 observationId 和 0～1000 归一化坐标，并设置 durationMs=3000。';

const BILIBILI_ONE_CLICK_TRIPLE_SKILL = {
  name: 'bilibili-one-click-triple',
  description: 'B站一键三连：长按点赞图标约3秒',
  body: BILIBILI_LONG_PRESS_ONLY_BODY,
};

/**
 * Bundled experience for deleting products from JD's shopping cart. The
 * workflow deliberately avoids fixed coordinates because JD's cart header is
 * custom-rendered and its OCR may merge adjacent labels such as “对比 管理”.
 */
const JD_CART_DELETE_SKILL = {
  name: 'jd-cart-delete',
  description: '在京东购物车中进入管理模式并删除全部或指定商品',
  body: [
    '## 适用场景',
    '用户要求删除京东购物车中的全部商品或指定商品。',
    '',
    '## 操作流程',
    '1. 打开京东购物车并定位“管理”。无障碍树找不到时调用 ui_screenshot：OCR 独立识别“管理”则使用其 ref；若与“对比”等文字合并，则按最新截图定位“管理”自身并使用 coordinate 模式。不得写死坐标或复用旧观察结果。',
    '2. 点击后重新观察，确认“管理”变为“完成”或消失，并且底部出现“删除”。复选框和“全选”不能证明已进入管理模式。未进入时重新定位并最多重试一次，仍失败则调用 request_user_action 请用户手动点击“管理”。',
    '3. 按用户要求选择全部或指定商品。调用 confirm_action 说明删除范围；确认后复查页面和选择范围，再以 high 风险点击“删除”并处理应用内确认框。',
    '4. 删除后重新观察：删除全部时确认购物车为空；删除指定商品时确认目标已消失且其他商品仍在。只有页面状态满足目标时才能调用 task_complete。',
    '',
    'ui_tap 返回已派发不代表操作成功，必须以后续页面状态为准。',
  ].join('\n'),
};

const LEGACY_NETEASE_CLOUD_MUSIC_SKILL_NAME = 'netease-cloud-music';

const BUILT_IN_SKILL_NAMES = new Set([
  SEED_SKILL.name,
  NETEASE_CLOUD_MUSIC_SEARCH_SKILL.name,
  BILIBILI_ONE_CLICK_TRIPLE_SKILL.name,
  JD_CART_DELETE_SKILL.name,
]);

const LEGACY_BUILT_IN_SKILL_NAMES = new Set([
  LEGACY_NETEASE_CLOUD_MUSIC_SKILL_NAME,
]);

function isBundledSkillName(name: string): boolean {
  return BUILT_IN_SKILL_NAMES.has(name) || LEGACY_BUILT_IN_SKILL_NAMES.has(name);
}

/** Active (non-tombstoned) skills, newest first — the shape the UI consumes. */
export function getSkills(): SkillRecord[] {
  return _skills.filter((s) => s.deletedAt === null);
}

export function getPortableSkills(): PortableSkill[] {
  return getSkills().map((skill) => ({
    name: skill.name,
    description: skill.description,
    body: skill.body,
    disabled: skill.disabledAt !== null,
  }));
}

export function parsePortableSkills(value: unknown): PortableSkillsParseResult {
  if (!Array.isArray(value)) return { ok: false, error: 'invalid_skills' };
  if (value.length > MAX_IMPORTED_SKILLS) return { ok: false, error: 'too_many_skills' };
  const names = new Set<string>();
  const skills: PortableSkill[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return { ok: false, error: 'invalid_skills' };
    }
    const raw = candidate as Record<string, unknown>;
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    const description = typeof raw.description === 'string' ? raw.description.trim() : '';
    if (
      !isValidSkillName(name) || !description || typeof raw.body !== 'string' ||
      typeof raw.disabled !== 'boolean' || names.has(name)
    ) {
      return { ok: false, error: 'invalid_skills' };
    }
    names.add(name);
    skills.push({ name, description, body: raw.body, disabled: raw.disabled });
  }
  return { ok: true, skills };
}

/** Merge by name: imported records replace same-name content but never delete local extras. */
export async function importPortableSkills(
  skills: PortableSkill[],
): Promise<{ added: number; updated: number; total: number }> {
  let added = 0;
  let updated = 0;
  const changed: SkillRecord[] = [];
  for (const imported of skills) {
    const existing = _skills.find(
      (skill) => skill.name === imported.name && skill.deletedAt === null,
    );
    const now = Date.now();
    if (existing) {
      existing.description = imported.description;
      existing.body = imported.body;
      existing.disabledAt = imported.disabled ? (existing.disabledAt ?? now) : null;
      existing.updatedAt = now;
      changed.push(existing);
      updated += 1;
      continue;
    }
    const record: SkillRecord = {
      id: generateId(),
      name: imported.name,
      description: imported.description,
      body: imported.body,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      disabledAt: imported.disabled ? now : null,
      builtIn: isBundledSkillName(imported.name),
    };
    _skills = [record, ..._skills];
    changed.push(record);
    added += 1;
  }
  if (changed.length > 0) {
    notify();
    await Promise.all(changed.map((record) => writeSkillFiles(record)));
    await writeIndexSnapshot();
  }
  return { added, updated, total: getSkills().length };
}

/**
 * Retrievable skills (non-tombstoned AND non-disabled) — the shape the
 * agent consumes for the catalog / read_skill lookups. Disabled records
 * stay on disk and in getSkills() but are invisible to the model.
 */
export function getActiveSkills(): SkillRecord[] {
  return _skills.filter((s) => s.deletedAt === null && s.disabledAt === null);
}

/** Body lookup for the read_skill tool; tombstoned/disabled/unknown names return null. */
export function getSkillBody(name: string): Promise<string | null> {
  const record = _skills.find(
    (s) => s.name === name && s.deletedAt === null && s.disabledAt === null,
  );
  return Promise.resolve(record ? record.body : null);
}

export function subscribeSkills(listener: (skills: SkillRecord[]) => void): () => void {
  _listeners.push(listener);
  listener([..._skills]);
  return () => {
    _listeners = _listeners.filter((l) => l !== listener);
  };
}

/**
 * Loads the library from disk. Safe to call multiple times; re-reads the
 * files. When index.json is missing or unreadable the directory is scanned
 * and frontmatter-rebuilt; when the library has never existed, a seed skill
 * is written so the catalog is non-empty out of the box.
 */
export async function loadSkills(options: LoadSkillsOptions = {}): Promise<void> {
  _io = options.io ?? defaultIO();
  const io = _io;

  await io.makeDir(io.dirPath);
  let indexEntries: SkillIndexEntry[] | null = null;
  let seedNeeded = false;
  try {
    const rawIndex = await io.readFile(indexPath());
    if (rawIndex === null) {
      seedNeeded = true;
    } else {
      try {
        indexEntries = normalizeIndex(JSON.parse(rawIndex));
        if (indexEntries.length === 0) seedNeeded = true;
      } catch {
        indexEntries = null;
        seedNeeded = true;
      }
    }
  } catch {
    indexEntries = null;
    seedNeeded = true;
  }

  // Rebuild from the directory when the index is damaged or missing. Every
  // parsed document gets a fresh id; tombstones cannot be recovered here.
  if (indexEntries === null) {
    indexEntries = [];
    const dirs = await io.listDir(io.dirPath);
    for (const dir of dirs) {
      if (!isValidSkillName(dir)) continue;
      const raw = await io.readFile(skillFilePath(dir));
      if (!raw) continue;
      const parsed = parseSkillMarkdown(raw);
      if (!parsed || parsed.name !== dir) continue;
      const now = Date.now();
      indexEntries.push({
        id: generateId(),
        name: parsed.name,
        description: parsed.description,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        disabledAt: null,
        builtIn: isBundledSkillName(parsed.name),
      });
    }
  }

  // Hydrate bodies from SKILL.md; an entry whose file vanished (externally
  // deleted, or a tombstone) keeps an empty body. In-memory bodies are plain
  // markdown (not the full document), so parse the frontmatter out here.
  const records: SkillRecord[] = [];
  for (const entry of indexEntries) {
    const raw = entry.deletedAt === null ? await io.readFile(skillFilePath(entry.name)) : null;
    const parsed = raw ? parseSkillMarkdown(raw) : null;
    records.push({
      id: entry.id,
      name: entry.name,
      description: entry.description || parsed?.description || '',
      body: parsed?.body ?? '',
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      deletedAt: entry.deletedAt,
      disabledAt: entry.disabledAt,
      builtIn: entry.builtIn,
    });
  }

  _skills = records;
  migrateBuiltInSkillName(
    LEGACY_NETEASE_CLOUD_MUSIC_SKILL_NAME,
    NETEASE_CLOUD_MUSIC_SEARCH_SKILL,
  );
  notify();

  if (seedNeeded) {
    const existing = _skills.filter((s) => s.deletedAt === null);
    if (existing.length === 0) {
      ensureBuiltInSkill(SEED_SKILL);
    } else {
      persistIndex();
    }
  }

  // Install bundled app-specific experiences for users who never had them. A
  // tombstone counts as an existing record: user deletion must survive reload.
  ensureBuiltInSkill(NETEASE_CLOUD_MUSIC_SEARCH_SKILL);
  ensureBuiltInSkill(BILIBILI_ONE_CLICK_TRIPLE_SKILL);
  ensureBuiltInSkill(JD_CART_DELETE_SKILL);
  simplifyBuiltInBilibiliExperience();
}

function activeNameExists(name: string): boolean {
  return _skills.some((s) => s.name === name && s.deletedAt === null);
}

async function writeSkillFiles(record: SkillRecord): Promise<void> {
  const io = _io;
  if (!io) return;
  try {
    await io.makeDir(skillDirPath(record.name));
    await io.writeFile(
      skillFilePath(record.name),
      serializeSkillMarkdown({
        name: record.name,
        description: record.description,
        body: record.body,
      }),
    );
  } catch {
    // Body writes must never break the session — the in-memory state stays.
  }
}

function ensureBuiltInSkill(input: {
  name: string;
  description: string;
  body: string;
}): void {
  const existing = _skills.find((skill) => skill.name === input.name);
  if (!existing) {
    createSkillRecord(input, true);
  }
}

/** Simplify only untouched bundled text; preserve edited, renamed or deleted experiences. */
function simplifyBuiltInBilibiliExperience(): void {
  const existing = _skills.find(
    (skill) => skill.name === BILIBILI_ONE_CLICK_TRIPLE_SKILL.name
      && skill.builtIn
      && skill.deletedAt === null,
  );
  if (!existing) return;
  const legacyDurationBody = LEGACY_BILIBILI_BODY.replace(
    CURRENT_BILIBILI_LONG_PRESS_STEP,
    LEGACY_BILIBILI_LONG_PRESS_STEP,
  );
  if (
    existing.body !== LEGACY_BILIBILI_BODY &&
    existing.body !== legacyDurationBody &&
    existing.body !== PREVIOUS_BILIBILI_LONG_PRESS_ONLY_BODY
  ) return;
  existing.body = BILIBILI_LONG_PRESS_ONLY_BODY;
  if (existing.description === LEGACY_BILIBILI_DESCRIPTION) {
    existing.description = BILIBILI_ONE_CLICK_TRIPLE_SKILL.description;
  }
  existing.updatedAt = Date.now();
  notify();
  persistIndex();
  void writeSkillFiles(existing);
}

/** Rename a bundled skill without changing its stable id or disabled state.
 * This makes built-in naming corrections safe for existing installations and
 * removes the obsolete directory only after the replacement file is written. */
function migrateBuiltInSkillName(
  legacyName: string,
  input: { name: string; description: string; body: string },
): void {
  const legacy = _skills.find((skill) => skill.name === legacyName);
  if (!legacy) return;
  const current = _skills.find((skill) => skill.name === input.name);
  const now = Date.now();
  if (current && current !== legacy) {
    // The canonical bundled record already exists. Hide the obsolete record
    // while preserving it as an index tombstone for future sync semantics.
    legacy.deletedAt = legacy.deletedAt ?? now;
    legacy.updatedAt = now;
    persistIndex();
    return;
  }

  const oldDir = skillDirPath(legacy.name);
  legacy.name = input.name;
  legacy.description = input.description;
  legacy.body = input.body;
  legacy.builtIn = true;
  legacy.updatedAt = now;
  void (async () => {
    if (legacy.deletedAt === null) await writeSkillFiles(legacy);
    const io = _io;
    if (io) await io.deletePath(oldDir);
  })().catch(() => {});
  persistIndex();
}

/** Creates a new skill. Fails on invalid or duplicate (active) names. */
function createSkillRecord(input: {
  name: string;
  description: string;
  body: string;
}, builtIn: boolean): SkillMutationResult {
  const name = input.name.trim();
  const description = input.description.trim();
  if (!isValidSkillName(name)) {
    return { ok: false, error: '名称需为 1-30 字，支持中文、字母、数字、空格、- 和 _' };
  }
  if (!description) {
    return { ok: false, error: '描述不能为空' };
  }
  if (activeNameExists(name)) {
    return { ok: false, error: `已存在名为「${name}」的经验` };
  }
  const now = Date.now();
  const record: SkillRecord = {
    id: generateId(),
    name,
    description,
    body: input.body,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    disabledAt: null,
    builtIn,
  };
  _skills = [record, ..._skills];
  notify();
  void writeSkillFiles(record);
  persistIndex();
  return { ok: true };
}

/** Creates a user-authored skill. Bundled records are created internally. */
export function createSkill(input: {
  name: string;
  description: string;
  body: string;
}): SkillMutationResult {
  return createSkillRecord(input, false);
}

/** Updates description/body of an existing (active) skill. */
export function updateSkill(
  id: string,
  patch: { description?: string; body?: string },
): SkillMutationResult {
  const record = _skills.find((s) => s.id === id && s.deletedAt === null);
  if (!record) {
    return { ok: false, error: '经验不存在或已删除' };
  }
  const description = (patch.description ?? record.description).trim();
  if (!description) {
    return { ok: false, error: '描述不能为空' };
  }
  record.description = description;
  if (patch.body !== undefined) record.body = patch.body;
  record.updatedAt = Date.now();
  notify();
  void writeSkillFiles(record);
  persistIndex();
  return { ok: true };
}

/**
 * Renames a skill: new SKILL.md written under the new directory, then the
 * old directory is deleted. Write-new-then-delete-old is used instead of
 * moveAsync — the project's IO precedents only use read/write primitives,
 * which avoids cross-directory rename quirks on some Android vendors.
 */
export function renameSkill(id: string, newName: string): SkillMutationResult {
  const name = newName.trim();
  if (!isValidSkillName(name)) {
    return { ok: false, error: '名称需为 1-30 字，支持中文、字母、数字、空格、- 和 _' };
  }
  const record = _skills.find((s) => s.id === id && s.deletedAt === null);
  if (!record) {
    return { ok: false, error: '经验不存在或已删除' };
  }
  if (name === record.name) {
    return { ok: true };
  }
  if (activeNameExists(name)) {
    return { ok: false, error: `已存在名为「${name}」的经验` };
  }
  const oldDir = skillDirPath(record.name);
  const now = Date.now();
  // Bundled injection is name-based for backwards compatibility. Preserve a
  // hidden origin tombstone before the first rename so a later reload knows
  // the bundled experience was already installed and intentionally renamed.
  if (record.builtIn && BUILT_IN_SKILL_NAMES.has(record.name)) {
    _skills.push({
      ...record,
      id: generateId(),
      body: '',
      updatedAt: now,
      deletedAt: now,
    });
  }
  record.name = name;
  record.updatedAt = now;
  notify();
  void (async () => {
    await writeSkillFiles(record);
    const io = _io;
    if (io) await io.deletePath(oldDir);
  })().catch(() => {});
  persistIndex();
  return { ok: true };
}

/**
 * Soft-deletes a skill: the SKILL.md directory is removed, the tombstone
 * stays in index.json so a future sync cannot resurrect the record on other
 * devices. The name becomes reusable immediately.
 */
export function deleteSkill(id: string): SkillMutationResult {
  const record = _skills.find((s) => s.id === id && s.deletedAt === null);
  if (!record) {
    return { ok: false, error: '经验不存在或已删除' };
  }
  record.deletedAt = Date.now();
  record.updatedAt = Date.now();
  notify();
  const io = _io;
  if (io) void io.deletePath(skillDirPath(record.name));
  persistIndex();
  return { ok: true };
}

/**
 * Disables/enables a skill. Disabling keeps the SKILL.md files and the index
 * entry untouched — the record is only hidden from retrieval (catalog
 * injection and read_skill lookups) until re-enabled.
 */
export function setSkillDisabled(id: string, disabled: boolean): SkillMutationResult {
  const record = _skills.find((s) => s.id === id && s.deletedAt === null);
  if (!record) {
    return { ok: false, error: '经验不存在或已删除' };
  }
  if (disabled === (record.disabledAt !== null)) {
    return { ok: true };
  }
  record.disabledAt = disabled ? Date.now() : null;
  notify();
  persistIndex();
  return { ok: true };
}
