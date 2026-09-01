const settingsMemory: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => settingsMemory[key] ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    settingsMemory[key] = value;
  }),
}));

import {
  applyConfigurationImport,
  parseConfigurationImport,
  serializeConfigurationExport,
} from '../configurationTransfer';
import {
  getFavorites,
  loadFavorites,
  toggleFavorite,
  type FavoritesIO,
} from '../favoritesStore';
import {
  createSkill,
  getSkills,
  loadSkills,
  type SkillsIO,
} from '../skillStore';
import { getSettings, resetSettings, saveSettings } from '../settingsStore';

function favoritesIO(): FavoritesIO {
  let content: string | null = null;
  return {
    filePath: '/favorites.json',
    readFile: async () => content,
    writeFile: async (next) => { content = next; },
  };
}

function skillsIO(): SkillsIO {
  const files = new Map<string, string>();
  return {
    dirPath: '/skills/',
    readFile: async (path) => files.get(path) ?? null,
    writeFile: async (path, content) => { files.set(path, content); },
    makeDir: async () => {},
    listDir: async () => [],
    deletePath: async (path) => {
      for (const file of [...files.keys()]) if (file.startsWith(path)) files.delete(file);
    },
  };
}

beforeEach(async () => {
  for (const key of Object.keys(settingsMemory)) delete settingsMemory[key];
  await resetSettings();
  await loadFavorites({ io: favoritesIO() });
  await loadSkills({ io: skillsIO() });
});

describe('configurationTransfer', () => {
  it('exports general, model, skills and favorites in one versioned document', async () => {
    await saveSettings({
      maxSteps: 42,
      customInstructions: '保持简洁',
      providerMode: 'cloud',
      cloudModelProfiles: [{
        id: 'ark',
        provider: 'openai',
        baseUrl: 'https://example.test/v1',
        apiKey: 'secret-key',
        model: 'model-a',
        contextWindowTokens: 64000,
      }],
      activeCloudModelProfileId: 'ark',
      tavilyApiKey: 'not-in-general-or-model',
    });
    createSkill({ name: 'pay-water', description: '缴水费', body: '先核对户号' });
    toggleFavorite('查询水费');

    const document = JSON.parse(
      serializeConfigurationExport(new Date('2026-09-01T00:00:00.000Z')),
    );

    expect(document).toMatchObject({
      format: 'doubao-configuration',
      version: 1,
      exportedAt: '2026-09-01T00:00:00.000Z',
      generalSettings: { maxSteps: 42, customInstructions: '保持简洁' },
      modelSettings: {
        activeCloudModelProfileId: 'ark',
        cloudModelProfiles: [expect.objectContaining({ apiKey: 'secret-key' })],
      },
      favorites: ['查询水费'],
      skills: expect.arrayContaining([
        expect.objectContaining({ name: 'pay-water', body: '先核对户号', disabled: false }),
      ]),
    });
    expect(document.generalSettings).not.toHaveProperty('tavilyApiKey');
    expect(document.modelSettings).not.toHaveProperty('toolConfigurationOverrides');
  });

  it('validates the complete document before applying it to existing stores', async () => {
    await saveSettings({
      maxSteps: 36,
      customInstructions: '导入指令',
      cloudModelProfiles: [{
        id: 'restore-model',
        provider: 'openai',
        baseUrl: 'https://restore.test/v1',
        apiKey: 'restore-key',
        model: 'restore-model-name',
        contextWindowTokens: 32000,
      }],
      activeCloudModelProfileId: 'restore-model',
    });
    createSkill({ name: 'shared-skill', description: '导入描述', body: '导入正文' });
    toggleFavorite('导入收藏');
    const content = serializeConfigurationExport();

    await resetSettings();
    await saveSettings({ maxSteps: 12, customInstructions: '本地指令' });
    const shared = getSkills().find((skill) => skill.name === 'shared-skill');
    expect(shared).toBeDefined();

    const parsed = parseConfigurationImport(content);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    await applyConfigurationImport(parsed.value);

    expect(getSettings()).toMatchObject({
      maxSteps: 36,
      customInstructions: '导入指令',
      activeCloudModelProfileId: 'restore-model',
      cloudBaseUrl: 'https://restore.test/v1',
      cloudApiKey: 'restore-key',
      cloudModel: 'restore-model-name',
    });
    expect(getSkills().find((skill) => skill.name === 'shared-skill')).toMatchObject({
      description: '导入描述',
      body: '导入正文',
    });
    expect(getFavorites()).toContain('导入收藏');
  });

  it('keeps legacy favorite exports importable', async () => {
    const parsed = parseConfigurationImport(JSON.stringify({
      format: 'doubao-favorite-commands',
      version: 1,
      commands: ['旧收藏'],
    }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    await expect(applyConfigurationImport(parsed.value)).resolves.toMatchObject({
      settingsImported: false,
      favoritesAdded: 1,
    });
    expect(getFavorites()).toEqual(['旧收藏']);
  });

  it('rejects invalid settings without mutating any store', () => {
    const document = JSON.parse(serializeConfigurationExport());
    document.generalSettings.maxSteps = 999999;
    const before = getSettings();

    expect(parseConfigurationImport(JSON.stringify(document))).toEqual({
      ok: false,
      error: 'invalid_settings',
    });
    expect(getSettings()).toEqual(before);
  });
});
