import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';

export type DB = Database.Database;

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

CREATE TABLE IF NOT EXISTS poster_cache (
	item_id INTEGER PRIMARY KEY,
	file TEXT NOT NULL,
	content_type TEXT NOT NULL,
	bytes INTEGER NOT NULL,
	last_access INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS work_availability (
	work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
	service TEXT NOT NULL,
	PRIMARY KEY (work_id, service)
);

CREATE TABLE IF NOT EXISTS availability_checks (
	work_id INTEGER PRIMARY KEY REFERENCES works(id) ON DELETE CASCADE,
	region TEXT NOT NULL,
	link TEXT,
	checked_at INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS works_fts USING fts5 (title, tokenize = 'unicode61 remove_diacritics 2');
`;

export function openDb(file: string): DB {
	if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
	const db = new Database(file);
	db.pragma('journal_mode = WAL');
	db.pragma('foreign_keys = ON');
	db.exec(SCHEMA);
	return db;
}

let instance: DB | undefined;

export function getDb(): DB {
	instance ??= openDb(path.join(config.dataDir, 'anthology.db'));
	return instance;
}

export function getSetting(db: DB, key: string): string | undefined {
	const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
	return row?.value;
}

export function setSetting(db: DB, key: string, value: string): void {
	db.prepare(
		'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
	).run(key, value);
}
