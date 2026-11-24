import type { Client, InArgs, InStatement } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config';

export type DB = Client;
export type Row = Record<string, unknown>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
	token_hash TEXT PRIMARY KEY,
	expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
	id INTEGER PRIMARY KEY,
	type TEXT NOT NULL,
	name TEXT NOT NULL,
	base_url TEXT NOT NULL,
	credentials_enc TEXT,
	enabled INTEGER NOT NULL DEFAULT 1,
	last_sync_at TEXT,
	last_sync_error TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS collection_lists (
	source_id INTEGER PRIMARY KEY REFERENCES sources(id) ON DELETE CASCADE,
	body TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS libraries (
	id INTEGER PRIMARY KEY,
	source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
	remote_id TEXT NOT NULL,
	name TEXT NOT NULL,
	kind TEXT NOT NULL,
	UNIQUE (source_id, remote_id)
);

CREATE TABLE IF NOT EXISTS works (
	id INTEGER PRIMARY KEY,
	title TEXT NOT NULL,
	year INTEGER,
	kind TEXT NOT NULL,
	match_key TEXT NOT NULL,
	canonical_poster INTEGER,
	external_ids_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS works_match_key ON works (match_key);

CREATE TABLE IF NOT EXISTS work_external_ids (
	kind TEXT NOT NULL,
	provider TEXT NOT NULL,
	value TEXT NOT NULL,
	work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
	PRIMARY KEY (kind, provider, value)
);

CREATE TABLE IF NOT EXISTS items (
	id INTEGER PRIMARY KEY,
	library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
	remote_id TEXT NOT NULL,
	work_id INTEGER NOT NULL REFERENCES works(id),
	title TEXT NOT NULL,
	year INTEGER,
	kind TEXT NOT NULL,
	external_ids_json TEXT NOT NULL DEFAULT '{}',
	link_url TEXT NOT NULL,
	poster_url TEXT,
	added_at TEXT,
	updated_at TEXT,
	sync_token TEXT,
	UNIQUE (library_id, remote_id)
);
CREATE INDEX IF NOT EXISTS items_work ON items (work_id);

CREATE TABLE IF NOT EXISTS overrides (
	id INTEGER PRIMARY KEY,
	item_id INTEGER NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,
	work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS work_availability (
	work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
	service TEXT NOT NULL,
	PRIMARY KEY (work_id, service)
);

-- TMDB poster paths for works that came without artwork, such as digital collection titles.
CREATE TABLE IF NOT EXISTS work_posters (
	work_id INTEGER PRIMARY KEY REFERENCES works(id) ON DELETE CASCADE,
	path TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS availability_checks (
	work_id INTEGER PRIMARY KEY REFERENCES works(id) ON DELETE CASCADE,
	region TEXT NOT NULL,
	link TEXT,
	checked_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS locks (
	name TEXT PRIMARY KEY,
	expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS login_failures (
	client TEXT PRIMARY KEY,
	count INTEGER NOT NULL,
	since INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS works_fts USING fts5 (title, tokenize = 'unicode61 remove_diacritics 2');
`;

export async function openDb(url: string, authToken?: string): Promise<DB> {
	if (url.startsWith('file:') && !url.includes(':memory:')) {
		const file = url.startsWith('file://') ? fileURLToPath(url) : url.slice('file:'.length);
		fs.mkdirSync(path.dirname(file), { recursive: true });
	}
	// Local files need the native client. Remote databases use the HTTP client, which has no native dependency.
	const local = url === ':memory:' || url.startsWith('file:');
	const { createClient } = local ? await import('@libsql/client') : await import('@libsql/client/web');
	const db = createClient({ url, authToken });
	await db.execute('PRAGMA foreign_keys = ON');
	await db.executeMultiple(SCHEMA);
	return db;
}

let instance: Promise<DB> | undefined;

export function getDb(): Promise<DB> {
	instance ??= openDb(config.databaseUrl, config.databaseAuthToken).catch((err) => {
		instance = undefined;
		throw err;
	});
	return instance;
}

export async function all<T = Row>(db: DB, sql: string, args: InArgs = []): Promise<T[]> {
	return (await db.execute({ sql, args })).rows as unknown as T[];
}

export async function get<T = Row>(db: DB, sql: string, args: InArgs = []): Promise<T | undefined> {
	return (await all<T>(db, sql, args))[0];
}

export async function run(
	db: DB,
	sql: string,
	args: InArgs = []
): Promise<{ lastInsertRowid: number; changes: number }> {
	const res = await db.execute({ sql, args });
	return { lastInsertRowid: Number(res.lastInsertRowid ?? 0), changes: res.rowsAffected };
}

/** Runs statements atomically, in chunks so very large syncs stay within request limits. */
export async function writeBatch(db: DB, statements: InStatement[], chunk = 1000): Promise<void> {
	for (let i = 0; i < statements.length; i += chunk) await db.batch(statements.slice(i, i + chunk), 'write');
}

export async function getSetting(db: DB, key: string): Promise<string | undefined> {
	return (await get<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', [key]))?.value;
}

export async function setSetting(db: DB, key: string, value: string): Promise<void> {
	await run(
		db,
		'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
		[key, value]
	);
}

/** A lease that survives across serverless instances. Returns false if someone else holds it. */
export async function acquireLock(db: DB, name: string, ttlMs: number, now = Date.now()): Promise<boolean> {
	const res = await run(
		db,
		`INSERT INTO locks (name, expires_at) VALUES (?, ?)
		ON CONFLICT(name) DO UPDATE SET expires_at = excluded.expires_at WHERE locks.expires_at < ?`,
		[name, now + ttlMs, now]
	);
	return res.changes > 0;
}

export async function releaseLock(db: DB, name: string): Promise<void> {
	await run(db, 'DELETE FROM locks WHERE name = ?', [name]);
}

export async function isLocked(db: DB, name: string, now = Date.now()): Promise<boolean> {
	return Boolean(await get(db, 'SELECT 1 FROM locks WHERE name = ? AND expires_at >= ?', [name, now]));
}
