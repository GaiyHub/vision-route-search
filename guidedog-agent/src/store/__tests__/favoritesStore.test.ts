import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  getFavorites,
  importFavoritesJson,
  isFavorite,
  loadFavorites,
  parseFavoritesJson,
  removeFavorite,
  serializeFavoritesExport,
  subscribeFavorites,
  toggleFavorite,
  type FavoritesIO,
} from '../favoritesStore';

function tempIO(): FavoritesIO & { dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'favs-'));
  const filePath = path.join(dir, 'favorites.json');
  return {
    dir,
    filePath,
    readFile: async () =>
      fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null,
    writeFile: async (content: string) => {
      fs.writeFileSync(filePath, content);
    },
  };
}

async function freshLoad(io: FavoritesIO, opts: Parameters<typeof loadFavorites>[0] = {}) {
  await loadFavorites({ ...opts, io });
}

afterEach(() => {
  // The store is a module singleton; each test reloads from its own temp file.
});

describe('favoritesStore', () => {
  it('toggles a command in and out of favorites', async () => {
    const io = tempIO();
    await freshLoad(io);

    expect(isFavorite('打开设置')).toBe(false);
    expect(toggleFavorite('打开设置')).toEqual({ nowFavorite: true });
    expect(isFavorite('打开设置')).toBe(true);

    expect(toggleFavorite('打开设置')).toEqual({ nowFavorite: false });
    expect(isFavorite('打开设置')).toBe(false);
  });

  it('keeps favorites deduplicated and newest first', async () => {
    const io = tempIO();
    await freshLoad(io, { legacyCommands: ['A'] });

    toggleFavorite('B');
    expect(getFavorites()).toEqual(['B', 'A']);

    // Toggling an existing favorite removes it entirely (never duplicates).
    toggleFavorite('B');
    expect(getFavorites()).toEqual(['A']);
  });

  it('persists favorites to the local file and reloads them', async () => {
    const io = tempIO();
    await freshLoad(io);
    toggleFavorite('打开设置');
    toggleFavorite('给妈妈发消息');

    await freshLoad(io);
    expect(getFavorites()).toEqual(['给妈妈发消息', '打开设置']);
  });

  it('falls back to an empty list on a corrupt file', async () => {
    const io = tempIO();
    fs.writeFileSync(io.filePath, 'not json{{{');
    await freshLoad(io);

    expect(getFavorites()).toEqual([]);
  });

  it('filters non-string entries from the file', async () => {
    const io = tempIO();
    fs.writeFileSync(io.filePath, JSON.stringify(['ok', 42, null, '  spaced  ']));
    await freshLoad(io);

    expect(getFavorites()).toEqual(['ok', 'spaced']);
  });

  it('notifies subscribers on changes', async () => {
    const io = tempIO();
    await freshLoad(io);
    const seen: string[][] = [];
    const unsub = subscribeFavorites((f) => seen.push(f));

    toggleFavorite('X');
    toggleFavorite('X');
    unsub();

    expect(seen[0]).toEqual([]);
    expect(seen[1]).toEqual(['X']);
    expect(seen[2]).toEqual([]);
  });

  it('migrates legacy saved commands when the file is empty', async () => {
    const io = tempIO();
    let migrated: string[] | null = null;
    await freshLoad(io, {
      legacyCommands: ['旧指令A', '旧指令B'],
      onLegacyMigrated: (cmds) => {
        migrated = cmds;
      },
    });

    expect(migrated).toEqual(['旧指令A', '旧指令B']);
    expect(getFavorites()).toEqual(['旧指令A', '旧指令B']);
    expect(fs.existsSync(io.filePath)).toBe(true);
  });

  it('does not migrate when favorites already exist', async () => {
    const io = tempIO();
    await freshLoad(io);
    toggleFavorite('已有收藏');

    let migrated = false;
    await freshLoad(io, {
      legacyCommands: ['旧指令'],
      onLegacyMigrated: () => {
        migrated = true;
      },
    });

    expect(migrated).toBe(false);
    expect(getFavorites()).toEqual(['已有收藏']);
  });

  it('keeps in-memory state when the write fails', async () => {
    const io: FavoritesIO = {
      filePath: '/nonexistent/favorites.json',
      readFile: async () => null,
      writeFile: async () => {
        throw new Error('disk full');
      },
    };
    await freshLoad(io);

    expect(() => toggleFavorite('依然收藏')).not.toThrow();
    expect(getFavorites()).toEqual(['依然收藏']);
  });

  it('removeFavorite only removes an existing favorite', async () => {
    const io = tempIO();
    await freshLoad(io);
    toggleFavorite('A');

    expect(removeFavorite('不存在的')).toBe(false);
    expect(removeFavorite('A')).toBe(true);
    expect(getFavorites()).toEqual([]);
  });

  it('exports a versioned JSON document without changing command order', async () => {
    const io = tempIO();
    await freshLoad(io, { legacyCommands: ['打开设置', '查看天气'] });

    const exported = JSON.parse(
      serializeFavoritesExport(new Date('2026-08-20T10:00:00.000Z')),
    );
    expect(exported).toEqual({
      format: 'doubao-favorite-commands',
      version: 1,
      exportedAt: '2026-08-20T10:00:00.000Z',
      commands: ['打开设置', '查看天气'],
    });
  });

  it('imports a versioned file by merging and deduplicating commands', async () => {
    const io = tempIO();
    await freshLoad(io, { legacyCommands: ['已有指令'] });

    const result = importFavoritesJson(JSON.stringify({
      format: 'doubao-favorite-commands',
      version: 1,
      commands: [' 新指令 ', '已有指令', '新指令'],
    }));

    expect(result).toEqual({ ok: true, added: 1, total: 2 });
    expect(getFavorites()).toEqual(['已有指令', '新指令']);
    await freshLoad(io);
    expect(getFavorites()).toEqual(['已有指令', '新指令']);
  });

  it('accepts a plain string array import for compatibility', async () => {
    const io = tempIO();
    await freshLoad(io);

    expect(importFavoritesJson('["A", "B"]')).toEqual({
      ok: true,
      added: 2,
      total: 2,
    });
    expect(getFavorites()).toEqual(['A', 'B']);
  });

  it('parses a portable favorite document without mutating storage', async () => {
    const io = tempIO();
    await freshLoad(io, { legacyCommands: ['保留'] });

    expect(parseFavoritesJson(JSON.stringify({
      format: 'doubao-favorite-commands',
      version: 1,
      commands: [' 新指令 ', '新指令'],
    }))).toEqual({ ok: true, commands: ['新指令'] });
    expect(getFavorites()).toEqual(['保留']);
  });

  it('does not mutate favorites when an import is invalid', async () => {
    const io = tempIO();
    await freshLoad(io, { legacyCommands: ['保留'] });

    expect(importFavoritesJson('{bad json')).toEqual({
      ok: false,
      error: 'invalid_json',
    });
    expect(importFavoritesJson(JSON.stringify({ commands: ['A'] }))).toEqual({
      ok: false,
      error: 'invalid_format',
    });
    expect(getFavorites()).toEqual(['保留']);
  });
});
