/**
 * Tests for the experience library store: CRUD, persistence round-trips,
 * rename semantics, soft-delete tombstones, index rebuild from directory
 * scan, and the one-time seed skill.
 */

import {
  createSkill,
  deleteSkill,
  getActiveSkills,
  getPortableSkills,
  getSkillBody,
  getSkills,
  importPortableSkills,
  loadSkills,
  parsePortableSkills,
  renameSkill,
  setSkillDisabled,
  subscribeSkills,
  updateSkill,
  type SkillsIO,
} from '../skillStore';

const DIR = '/skills/';

/** In-memory filesystem implementing SkillsIO (paths are strings). */
function memIO(initial: Record<string, string> = {}): SkillsIO & { files: Map<string, string> } {
  const files = new Map<string, string>(Object.entries(initial));
  return {
    files,
    dirPath: DIR,
    readFile: async (p) => files.get(p) ?? null,
    writeFile: async (p, c) => {
      files.set(p, c);
    },
    makeDir: async () => {},
    listDir: async () => {
      const dirs = new Set<string>();
      for (const key of files.keys()) {
        if (!key.startsWith(DIR)) continue;
        const rest = key.slice(DIR.length);
        const slash = rest.indexOf('/');
        if (slash > 0) dirs.add(rest.slice(0, slash));
      }
      return [...dirs];
    },
    deletePath: async (p) => {
      for (const key of [...files.keys()]) {
        if (key.startsWith(p)) files.delete(key);
      }
    },
  };
}

/** Flushes pending microtasks so fire-and-forget file writes land. */
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

const sk = (name: string, description = '描述', body = '正文') =>
  `${'---'}\nname: ${name}\ndescription: ${description}\n${'---'}\n\n${body}\n`;

describe('skillStore', () => {
  it('creates a skill and persists SKILL.md plus index.json', async () => {
    const io = memIO();
    await loadSkills({ io });
    await tick();

    const result = createSkill({
      name: 'alipay-topup',
      description: '支付宝充值流程',
      body: '## 操作流程\n1. 打开支付宝',
    });
    expect(result.ok).toBe(true);
    expect(getSkills().map((s) => s.name)).toContain('alipay-topup');

    await tick();
    expect(io.files.get(`${DIR}alipay-topup/SKILL.md`)).toContain('name: alipay-topup');
    const index = JSON.parse(io.files.get(`${DIR}index.json`) ?? '[]');
    expect(index.some((e: { name: string }) => e.name === 'alipay-topup')).toBe(true);
  });

  it('rejects invalid and duplicate names', async () => {
    const io = memIO();
    await loadSkills({ io });
    await tick();

    expect(createSkill({ name: 'a/b', description: 'x', body: 'y' }).ok).toBe(false);
    expect(createSkill({ name: 'a@b', description: 'x', body: 'y' }).ok).toBe(false);
    expect(createSkill({ name: 'a'.repeat(31), description: 'x', body: 'y' }).ok).toBe(false);
    expect(createSkill({ name: '', description: 'x', body: 'y' }).ok).toBe(false);
    expect(createSkill({ name: 'ok-skill', description: '', body: 'y' }).ok).toBe(false);

    expect(createSkill({ name: 'ok-skill', description: 'x', body: 'y' }).ok).toBe(true);
    expect(createSkill({ name: 'ok-skill', description: 'x2', body: 'y2' }).ok).toBe(false);
  });

  it('persists and reloads skills, keeping ids stable', async () => {
    const io = memIO();
    await loadSkills({ io });
    await tick();
    createSkill({ name: 'skill-a', description: 'A', body: 'body-a' });
    const idBefore = getSkills().find((s) => s.name === 'skill-a')?.id;
    await tick();

    await loadSkills({ io });
    const reloaded = getSkills();
    expect(reloaded.map((s) => s.name)).toContain('skill-a');
    expect(reloaded.find((s) => s.name === 'skill-a')?.id).toBe(idBefore);
    expect(reloaded.find((s) => s.name === 'skill-a')?.body).toBe('body-a');
  });

  it('round-trips a Chinese-named skill through create, reload and rename', async () => {
    const io = memIO();
    await loadSkills({ io });
    await tick();
    const created = createSkill({ name: '支付宝充值', description: '充值流程', body: '正文' });
    expect(created.ok).toBe(true);
    const id = getSkills().find((s) => s.name === '支付宝充值')?.id;
    await tick();
    expect(io.files.get(`${DIR}支付宝充值/SKILL.md`)).toContain('name: 支付宝充值');
    expect(await getSkillBody('支付宝充值')).toBe('正文');

    await loadSkills({ io });
    expect(getSkills().find((s) => s.id === id)?.name).toBe('支付宝充值');

    const renamed = renameSkill(id!, '支付宝 充值 v2');
    expect(renamed.ok).toBe(true);
    await tick();
    expect(io.files.has(`${DIR}支付宝 充值 v2/SKILL.md`)).toBe(true);
    expect(io.files.has(`${DIR}支付宝充值/SKILL.md`)).toBe(false);
    expect(await getSkillBody('支付宝充值')).toBeNull();
    expect(await getSkillBody('支付宝 充值 v2')).toBe('正文');
  });

  it('renames a skill: id stays, directory migrates, old name lookup fails', async () => {
    const io = memIO();
    await loadSkills({ io });
    await tick();
    createSkill({ name: 'old-name', description: 'x', body: 'b' });
    const id = getSkills().find((s) => s.name === 'old-name')?.id;
    await tick();

    const result = renameSkill(id!, 'new-name');
    expect(result.ok).toBe(true);
    await tick();

    const renamed = getSkills().find((s) => s.id === id);
    expect(renamed?.name).toBe('new-name');
    expect(io.files.has(`${DIR}new-name/SKILL.md`)).toBe(true);
    expect(io.files.has(`${DIR}old-name/SKILL.md`)).toBe(false);
    expect(await getSkillBody('old-name')).toBeNull();
    expect(await getSkillBody('new-name')).toBe('b');
  });

  it('rejects renaming to an existing active name', async () => {
    const io = memIO();
    await loadSkills({ io });
    await tick();
    createSkill({ name: 'skill-a', description: 'x', body: 'b' });
    createSkill({ name: 'skill-b', description: 'x', body: 'b' });
    const idA = getSkills().find((s) => s.name === 'skill-a')?.id;

    expect(renameSkill(idA!, 'skill-b').ok).toBe(false);
  });

  it('soft-deletes: tombstone hides the skill but keeps the index entry', async () => {
    const io = memIO();
    await loadSkills({ io });
    await tick();
    createSkill({ name: 'doomed', description: 'x', body: 'b' });
    const id = getSkills().find((s) => s.name === 'doomed')?.id;
    await tick();

    expect(deleteSkill(id!).ok).toBe(true);
    await tick();

    expect(getSkills().map((s) => s.name)).not.toContain('doomed');
    expect(await getSkillBody('doomed')).toBeNull();
    const index = JSON.parse(io.files.get(`${DIR}index.json`) ?? '[]');
    const entry = index.find((e: { id: string }) => e.id === id);
    expect(entry.deletedAt).not.toBeNull();
  });

  it('allows re-creating the same name after soft delete', async () => {
    const io = memIO();
    await loadSkills({ io });
    await tick();
    createSkill({ name: 'reused', description: 'x', body: 'first' });
    const id = getSkills().find((s) => s.name === 'reused')?.id;
    deleteSkill(id!);
    await tick();

    const again = createSkill({ name: 'reused', description: 'x', body: 'second' });
    expect(again.ok).toBe(true);
    const active = getSkills().filter((s) => s.name === 'reused');
    expect(active).toHaveLength(1);
    expect(active[0].body).toBe('second');
    expect(active[0].id).not.toBe(id);
  });

  it('disables a skill: kept on disk and in getSkills but hidden from retrieval', async () => {
    const io = memIO();
    await loadSkills({ io });
    await tick();
    createSkill({ name: 'paused', description: 'x', body: 'body-paused' });
    const id = getSkills().find((s) => s.name === 'paused')?.id;
    await tick();

    expect(setSkillDisabled(id!, true).ok).toBe(true);
    await tick();

    // UI view still contains it, flagged as disabled.
    const record = getSkills().find((s) => s.id === id);
    expect(record?.disabledAt).not.toBeNull();
    // Retrieval view hides it; body lookups return null.
    expect(getActiveSkills().map((s) => s.name)).not.toContain('paused');
    expect(await getSkillBody('paused')).toBeNull();
    // Files stay on disk and the flag persists in the index.
    expect(io.files.get(`${DIR}paused/SKILL.md`)).toContain('body-paused');
    const index = JSON.parse(io.files.get(`${DIR}index.json`) ?? '[]');
    expect(index.find((e: { id: string }) => e.id === id).disabledAt).not.toBeNull();

    // Reload keeps the disabled state.
    await loadSkills({ io });
    expect(getSkills().find((s) => s.id === id)?.disabledAt).not.toBeNull();
    expect(getActiveSkills().map((s) => s.name)).not.toContain('paused');
  });

  it('re-enables a disabled skill and restores retrieval', async () => {
    const io = memIO();
    await loadSkills({ io });
    await tick();
    createSkill({ name: 'resume', description: 'x', body: 'body-resume' });
    const id = getSkills().find((s) => s.name === 'resume')?.id;
    setSkillDisabled(id!, true);
    await tick();

    expect(setSkillDisabled(id!, false).ok).toBe(true);
    await tick();

    expect(getSkills().find((s) => s.id === id)?.disabledAt).toBeNull();
    expect(getActiveSkills().map((s) => s.name)).toContain('resume');
    expect(await getSkillBody('resume')).toBe('body-resume');
  });

  it('setSkillDisabled on a deleted or unknown skill fails', async () => {
    const io = memIO();
    await loadSkills({ io });
    await tick();

    expect(setSkillDisabled('missing-id', true).ok).toBe(false);
    createSkill({ name: 'gone', description: 'x', body: 'b' });
    const id = getSkills().find((s) => s.name === 'gone')?.id;
    deleteSkill(id!);
    expect(setSkillDisabled(id!, true).ok).toBe(false);
  });

  it('updates description and body in place', async () => {
    const io = memIO();
    await loadSkills({ io });
    await tick();
    createSkill({ name: 'editable', description: '旧描述', body: '旧正文' });
    const id = getSkills().find((s) => s.name === 'editable')?.id;

    const result = updateSkill(id!, { description: '新描述', body: '新正文' });
    expect(result.ok).toBe(true);
    await tick();

    const updated = getSkills().find((s) => s.id === id);
    expect(updated?.description).toBe('新描述');
    expect(updated?.body).toBe('新正文');
    expect(io.files.get(`${DIR}editable/SKILL.md`)).toContain('description: 新描述');
  });

  it('exports and merges portable skills without deleting local extras', async () => {
    const io = memIO();
    await loadSkills({ io });
    await tick();
    createSkill({ name: 'local-only', description: '本地', body: '保留' });
    createSkill({ name: 'shared', description: '旧描述', body: '旧正文' });
    await tick();

    const parsed = parsePortableSkills([
      { name: 'shared', description: '新描述', body: '新正文', disabled: true },
      { name: 'imported', description: '导入', body: '正文', disabled: false },
    ]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    await expect(importPortableSkills(parsed.skills)).resolves.toMatchObject({
      added: 1,
      updated: 1,
    });
    expect(getSkills().map((skill) => skill.name)).toEqual(expect.arrayContaining([
      'local-only',
      'shared',
      'imported',
    ]));
    expect(getSkills().find((skill) => skill.name === 'shared')).toMatchObject({
      description: '新描述',
      body: '新正文',
    });
    expect(getActiveSkills().map((skill) => skill.name)).not.toContain('shared');
    expect(getPortableSkills().find((skill) => skill.name === 'shared')).toEqual({
      name: 'shared',
      description: '新描述',
      body: '新正文',
      disabled: true,
    });
    expect(io.files.get(`${DIR}shared/SKILL.md`)).toContain('新正文');
  });

  it('rejects malformed or duplicate portable skills before mutation', async () => {
    const io = memIO();
    await loadSkills({ io });
    const before = getSkills();

    expect(parsePortableSkills([{ name: 'bad/name', description: 'x', body: 'y', disabled: false }]))
      .toEqual({ ok: false, error: 'invalid_skills' });
    expect(parsePortableSkills([
      { name: 'same', description: 'x', body: 'y', disabled: false },
      { name: 'same', description: 'x', body: 'z', disabled: false },
    ])).toEqual({ ok: false, error: 'invalid_skills' });
    expect(getSkills()).toEqual(before);
  });

  it('rebuilds the library from the directory when index.json is missing', async () => {
    const io = memIO({
      [`${DIR}alpha/SKILL.md`]: sk('alpha', '第一条', 'body-alpha'),
      [`${DIR}beta/SKILL.md`]: sk('beta', '第二条', 'body-beta'),
    });
    await loadSkills({ io });

    expect(getSkills().map((s) => s.name).sort()).toEqual([
      'alpha',
      'beta',
      'bilibili-one-click-triple',
      'jd-cart-delete',
      'netease-cloud-music-search',
    ]);
    expect(await getSkillBody('beta')).toBe('body-beta');
  });

  it('skips damaged SKILL.md files during a directory rebuild', async () => {
    const io = memIO({
      [`${DIR}good/SKILL.md`]: sk('good', 'x', 'b'),
      [`${DIR}bad/SKILL.md`]: 'not a markdown frontmatter at all',
    });
    await loadSkills({ io });

    expect(getSkills().map((s) => s.name).sort()).toEqual([
      'bilibili-one-click-triple',
      'good',
      'jd-cart-delete',
      'netease-cloud-music-search',
    ]);
  });

  it('seeds the bundled experiences only once on a fresh library', async () => {
    const io = memIO();
    await loadSkills({ io });
    await tick();
    expect(getSkills().map((s) => s.name).sort()).toEqual([
      'bilibili-one-click-triple',
      'jd-cart-delete',
      'netease-cloud-music-search',
      'scroll-list-search',
    ]);
    expect(await getSkillBody('scroll-list-search')).toContain('## 操作流程');
    expect(await getSkillBody('netease-cloud-music-search')).toContain('## 返回键约束');
    expect(await getSkillBody('bilibili-one-click-triple')).toBe(
      '在哔哩哔哩视频页执行“一键三连”时，对点赞图标中心调用 ui_long_press 的 coordinate 模式，使用最新截图的 observationId 和 0～1000 归一化坐标，并设置 durationMs=3000。',
    );
    const jdCartDelete = await getSkillBody('jd-cart-delete');
    expect(jdCartDelete).toContain('“管理”变为“完成”');
    expect(jdCartDelete).toContain('不得写死坐标');
    expect(getSkills().every((skill) => skill.builtIn)).toBe(true);

    // The index now exists with both records — reloading must not duplicate either.
    await loadSkills({ io });
    expect(getSkills()).toHaveLength(4);
  });

  it('allows bundled experiences to be edited, renamed and deleted', async () => {
    const io = memIO();
    await loadSkills({ io });
    await tick();

    const bundled = getSkills().find((skill) => skill.name === 'scroll-list-search')!;
    expect(updateSkill(bundled.id, { description: '已修改', body: 'changed' }).ok).toBe(true);
    expect(renameSkill(bundled.id, 'renamed-built-in').ok).toBe(true);
    expect(setSkillDisabled(bundled.id, true).ok).toBe(true);
    await tick();
    expect(io.files.get(`${DIR}renamed-built-in/SKILL.md`)).toContain('changed');
    expect(deleteSkill(bundled.id).ok).toBe(true);
    await tick();

    await loadSkills({ io });
    expect(getSkills().find((skill) => skill.id === bundled.id)).toBeUndefined();
    expect(io.files.has(`${DIR}renamed-built-in/SKILL.md`)).toBe(false);
  });

  it('does not recreate the NetEase experience after it is renamed and deleted', async () => {
    const now = Date.now();
    const io = memIO({
      [`${DIR}alpha/SKILL.md`]: sk('alpha', '已有经验', 'body-alpha'),
      [`${DIR}index.json`]: JSON.stringify([{
        id: 'skill-existing-alpha',
        name: 'alpha',
        description: '已有经验',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        disabledAt: null,
      }]),
    });

    await loadSkills({ io });
    await tick();
    expect(getSkills().map((s) => s.name).sort()).toEqual([
      'alpha',
      'bilibili-one-click-triple',
      'jd-cart-delete',
      'netease-cloud-music-search',
    ]);

    const netease = getSkills().find((skill) => skill.name === 'netease-cloud-music-search');
    expect(netease?.builtIn).toBe(true);
    expect(renameSkill(netease!.id, 'my-netease-search').ok).toBe(true);
    await tick();
    await loadSkills({ io });
    expect(getSkills().map((s) => s.name).sort()).toEqual([
      'alpha',
      'bilibili-one-click-triple',
      'jd-cart-delete',
      'my-netease-search',
    ]);

    expect(deleteSkill(netease!.id).ok).toBe(true);
    await tick();
    await loadSkills({ io });

    expect(getSkills().map((s) => s.name).sort()).toEqual([
      'alpha',
      'bilibili-one-click-triple',
      'jd-cart-delete',
    ]);
  });

  it('migrates a legacy bundled tombstone without reviving the deleted experience', async () => {
    const now = Date.now();
    const io = memIO({
      [`${DIR}index.json`]: JSON.stringify([{
        id: 'legacy-deleted-netease',
        name: 'netease-cloud-music',
        description: '旧描述',
        createdAt: now - 1000,
        updatedAt: now,
        deletedAt: now,
        disabledAt: now - 500,
      }]),
    });

    await loadSkills({ io });
    await tick();

    expect(getSkills().find((skill) => skill.id === 'legacy-deleted-netease')).toBeUndefined();
    const index = JSON.parse(io.files.get(`${DIR}index.json`) ?? '[]') as Array<{
      id: string;
      name: string;
      deletedAt: number | null;
      disabledAt: number | null;
      builtIn: boolean;
    }>;
    const migrated = index.find((skill) => skill.id === 'legacy-deleted-netease');
    expect(migrated).toMatchObject({
      name: 'netease-cloud-music-search',
      deletedAt: now,
      disabledAt: now - 500,
      builtIn: true,
    });
    expect(io.files.has(`${DIR}netease-cloud-music-search/SKILL.md`)).toBe(false);
  });

  it('notifies subscribers on mutations', async () => {
    const io = memIO();
    await loadSkills({ io });
    await tick();
    const seen: string[][] = [];
    const unsub = subscribeSkills((all) => seen.push(all.map((s) => s.name)));

    createSkill({ name: 'watched', description: 'x', body: 'b' });
    unsub();

    expect(seen[seen.length - 1]).toContain('watched');
  });

  it('keeps in-memory state when writes fail', async () => {
    const io = memIO();
    await loadSkills({ io });
    await tick();
    io.writeFile = async () => {
      throw new Error('disk full');
    };

    expect(() => createSkill({ name: 'resilient', description: 'x', body: 'b' })).not.toThrow();
    expect(getSkills().map((s) => s.name)).toContain('resilient');
  });
});
