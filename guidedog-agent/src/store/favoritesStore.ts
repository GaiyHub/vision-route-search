/**
 * Favorites store.
 *
 * Persists the user's favorited commands to a local JSON file in the app
 * documents directory so favorites survive app restarts. The in-memory list
 * is the single source of truth during a session; every mutation is mirrored
 * to disk. Persistence IO is injectable so tests can use a temp directory.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
type LegacyFileSystem = {
  documentDirectory?: string;
  readAsStringAsync?: (
    path: string,
    opts?: { encoding?: unknown },
  ) => Promise<string>;
  writeAsStringAsync?: (
    path: string,
    content: string,
    opts?: { encoding?: unknown },
  ) => Promise<void>;
  EncodingType?: Record<string, unknown>;
};

const DEFAULT_FILE_NAME = 'favorites.json';
const FAVORITES_EXPORT_FORMAT = 'doubao-favorite-commands';
const FAVORITES_EXPORT_VERSION = 1;
export const MAX_IMPORTED_FAVORITES = 500;
export const MAX_FAVORITE_LENGTH = 4000;

export interface FavoritesIO {
  filePath: string;
  readFile: () => Promise<string | null>;
  writeFile: (content: string) => Promise<void>;
}

export interface LoadFavoritesOptions {
  /** Override persistence (used by tests); defaults to the app documents dir. */
  io?: FavoritesIO;
  /** Legacy saved commands to migrate when the favorites file is empty. */
  legacyCommands?: string[];
  /** Called after a legacy migration so the caller can clear the old setting. */
  onLegacyMigrated?: (commands: string[]) => void;
}

export type ImportFavoritesResult =
  | { ok: true; added: number; total: number }
  | {
      ok: false;
      error: 'invalid_json' | 'invalid_format' | 'too_many_commands';
    };

export type ParseFavoritesResult =
  | { ok: true; commands: string[] }
  | {
      ok: false;
      error: 'invalid_json' | 'invalid_format' | 'too_many_commands';
    };

let _favorites: string[] = [];
let _listeners: Array<(favorites: string[]) => void> = [];
let _io: FavoritesIO | null = null;

function notify(): void {
  const snapshot = [..._favorites];
  for (const listener of _listeners) listener(snapshot);
}

function defaultIO(): FavoritesIO {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('expo-file-system/legacy') as LegacyFileSystem;
  const filePath = (fs.documentDirectory ?? '') + DEFAULT_FILE_NAME;
  return {
    filePath,
    readFile: () =>
      (fs.readAsStringAsync?.(filePath, {
        encoding: fs.EncodingType?.UTF8,
      }) as Promise<string>).catch(() => null),
    writeFile: (content) =>
      (fs.writeAsStringAsync?.(filePath, content, {
        encoding: fs.EncodingType?.UTF8,
      }) as Promise<void>).catch(() => {}),
  };
}

function normalize(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const command of raw) {
    if (typeof command !== 'string') continue;
    const trimmed = command.trim();
    if (!trimmed || trimmed.length > MAX_FAVORITE_LENGTH || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

function persist(): void {
  const io = _io;
  if (!io) return;
  Promise.resolve(io.writeFile(JSON.stringify(_favorites))).catch(() => {
    // Write failures never block the session — keep the in-memory state.
  });
}

/**
 * Load favorites from disk (optionally migrating legacy saved commands when
 * the file is empty). Safe to call multiple times; re-reads the file.
 */
export async function loadFavorites(options: LoadFavoritesOptions = {}): Promise<void> {
  _io = options.io ?? defaultIO();
  let stored: string[] = [];
  try {
    const raw = await _io.readFile();
    if (raw) {
      try {
        stored = normalize(JSON.parse(raw));
      } catch {
        stored = [];
      }
    }
  } catch {
    stored = [];
  }

  let migrated = false;
  if (
    stored.length === 0 &&
    options.legacyCommands &&
    options.legacyCommands.length > 0
  ) {
    stored = normalize(options.legacyCommands);
    migrated = true;
    options.onLegacyMigrated?.(stored);
  }

  _favorites = stored;
  notify();
  if (migrated && stored.length > 0) persist();
}

/** Toggle a command's favorite state. Returns the new state. */
export function toggleFavorite(text: string): { nowFavorite: boolean } {
  const trimmed = text.trim();
  if (!trimmed) return { nowFavorite: false };
  const exists = _favorites.includes(trimmed);
  if (exists) {
    _favorites = _favorites.filter((c) => c !== trimmed);
  } else {
    _favorites = [trimmed, ..._favorites];
  }
  notify();
  persist();
  return { nowFavorite: !exists };
}

/** Remove a command from favorites if present. */
export function removeFavorite(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || !_favorites.includes(trimmed)) return false;
  _favorites = _favorites.filter((c) => c !== trimmed);
  notify();
  persist();
  return true;
}

export function isFavorite(text: string): boolean {
  return _favorites.includes(text.trim());
}

export function getFavorites(): string[] {
  return [..._favorites];
}

/** Serialize the current favorites as a portable, versioned JSON document. */
export function serializeFavoritesExport(now: Date = new Date()): string {
  return JSON.stringify(
    {
      format: FAVORITES_EXPORT_FORMAT,
      version: FAVORITES_EXPORT_VERSION,
      exportedAt: now.toISOString(),
      commands: _favorites,
    },
    null,
    2,
  );
}

/**
 * Merge commands from an exported JSON document into the current favorites.
 * A plain string array is also accepted for backwards-compatible/manual files.
 */
export function parseFavoritesJson(content: string): ParseFavoritesResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, error: 'invalid_json' };
  }

  let rawCommands: unknown;
  if (Array.isArray(parsed)) {
    rawCommands = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const document = parsed as Record<string, unknown>;
    if (
      document.format !== FAVORITES_EXPORT_FORMAT ||
      document.version !== FAVORITES_EXPORT_VERSION
    ) {
      return { ok: false, error: 'invalid_format' };
    }
    rawCommands = document.commands;
  } else {
    return { ok: false, error: 'invalid_format' };
  }

  if (!Array.isArray(rawCommands) || rawCommands.some((item) => typeof item !== 'string')) {
    return { ok: false, error: 'invalid_format' };
  }
  if (rawCommands.length > MAX_IMPORTED_FAVORITES) {
    return { ok: false, error: 'too_many_commands' };
  }

  return { ok: true, commands: normalize(rawCommands) };
}

export function mergeFavorites(imported: string[]): ImportFavoritesResult {
  const existing = new Set(_favorites);
  const additions = imported.filter((command) => !existing.has(command));
  if (_favorites.length + additions.length > MAX_IMPORTED_FAVORITES) {
    return { ok: false, error: 'too_many_commands' };
  }
  if (additions.length > 0) {
    _favorites = [..._favorites, ...additions];
    notify();
    persist();
  }
  return { ok: true, added: additions.length, total: _favorites.length };
}

export function importFavoritesJson(content: string): ImportFavoritesResult {
  const parsed = parseFavoritesJson(content);
  return parsed.ok ? mergeFavorites(parsed.commands) : parsed;
}

export function subscribeFavorites(listener: (favorites: string[]) => void): () => void {
  _listeners.push(listener);
  listener([..._favorites]);
  return () => {
    _listeners = _listeners.filter((l) => l !== listener);
  };
}
