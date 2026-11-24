import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { SourceSummary, SourceType } from '#lib/types.ts';
import { config } from './config';
import { decrypt, deriveKey, encrypt } from './crypto';
import type { DB } from './db';
import type { SourceConfig } from './adapters/types';

let cachedKey: Buffer | undefined;

/** Uses SECRET_KEY, or a key generated once and kept in the data directory. */
export function getCredentialKey(): Buffer {
	if (cachedKey) return cachedKey;
	let secret = config.secretKey;
	if (!secret) {
		const file = path.join(config.dataDir, 'secret.key');
		if (fs.existsSync(file)) {
			secret = fs.readFileSync(file, 'utf8').trim();
		} else {
			secret = randomBytes(32).toString('base64url');
			fs.mkdirSync(config.dataDir, { recursive: true });
			fs.writeFileSync(file, secret, { mode: 0o600 });
			console.warn(`SECRET_KEY is not set. Generated one at ${file}.`);
		}
	}
	cachedKey = deriveKey(secret);
	return cachedKey;
}

interface SourceRow {
	id: number;
	type: SourceType;
	name: string;
	base_url: string;
	credentials_enc: string | null;
	enabled: number;
	last_sync_at: string | null;
	last_sync_error: string | null;
}

export function listSources(db: DB): SourceSummary[] {
	const rows = db
		.prepare(
			`SELECT s.*,
				(SELECT COUNT(*) FROM libraries l WHERE l.source_id = s.id) AS library_count,
				(SELECT COUNT(*) FROM items i JOIN libraries l ON l.id = i.library_id WHERE l.source_id = s.id) AS item_count
			FROM sources s ORDER BY s.name COLLATE NOCASE`
		)
		.all() as (SourceRow & { library_count: number; item_count: number })[];
	return rows.map((row) => ({
		id: row.id,
		type: row.type,
		name: row.name,
		baseUrl: row.base_url,
		enabled: row.enabled === 1,
		lastSyncAt: row.last_sync_at,
		lastSyncError: row.last_sync_error,
		libraryCount: row.library_count,
		itemCount: row.item_count
	}));
}

function toConfig(row: SourceRow, key: Buffer): SourceConfig {
	return {
		id: row.id,
		type: row.type,
		name: row.name,
		baseUrl: row.base_url,
		token: row.credentials_enc ? decrypt(row.credentials_enc, key) : ''
	};
}

export function getSourceConfig(db: DB, id: number, key = getCredentialKey()): SourceConfig | undefined {
	const row = db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as SourceRow | undefined;
	return row ? toConfig(row, key) : undefined;
}

export function enabledSourceIds(db: DB): { id: number; lastSyncAt: string | null }[] {
	return (
		db.prepare('SELECT id, last_sync_at FROM sources WHERE enabled = 1').all() as {
			id: number;
			last_sync_at: string | null;
		}[]
	).map((row) => ({ id: row.id, lastSyncAt: row.last_sync_at }));
}

export interface NewSource {
	type: SourceType;
	name: string;
	baseUrl: string;
	token: string;
}

export function createSource(db: DB, input: NewSource, key = getCredentialKey()): number {
	const result = db
		.prepare('INSERT INTO sources (type, name, base_url, credentials_enc) VALUES (?, ?, ?, ?)')
		.run(input.type, input.name, input.baseUrl, input.token ? encrypt(input.token, key) : null);
	return Number(result.lastInsertRowid);
}

export function setSourceEnabled(db: DB, id: number, enabled: boolean): void {
	db.prepare('UPDATE sources SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
}

export function deleteSource(db: DB, id: number): void {
	db.transaction(() => {
		db.prepare('DELETE FROM sources WHERE id = ?').run(id);
		removeOrphanWorks(db);
	})();
}

export function removeOrphanWorks(db: DB): void {
	db.prepare('DELETE FROM works WHERE id NOT IN (SELECT work_id FROM items)').run();
	db.exec('DELETE FROM works_fts; INSERT INTO works_fts (rowid, title) SELECT id, title FROM works;');
}
