import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { SourceSummary, SourceType } from '#lib/types.ts';
import { config } from './config';
import { decrypt, deriveKey, encrypt } from './crypto';
import { all, get, run, writeBatch, type DB } from './db';
import type { SourceConfig } from './adapters/types';

let cachedKey: Buffer | undefined;

/** Uses SECRET_KEY. Outside Vercel, a key is generated once and kept in the data directory. */
export function getCredentialKey(): Buffer {
	if (cachedKey) return cachedKey;
	let secret = config.secretKey;
	if (!secret) {
		if (config.onVercel) throw new Error('SECRET_KEY must be set on Vercel');
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

export async function listSources(db: DB): Promise<SourceSummary[]> {
	const rows = await all<SourceRow & { library_count: number; item_count: number }>(
		db,
		`SELECT s.*,
			(SELECT COUNT(*) FROM libraries l WHERE l.source_id = s.id) AS library_count,
			(SELECT COUNT(*) FROM items i JOIN libraries l ON l.id = i.library_id WHERE l.source_id = s.id) AS item_count
		FROM sources s ORDER BY s.name COLLATE NOCASE`
	);
	return rows.map((row) => ({
		id: Number(row.id),
		type: row.type,
		name: row.name,
		baseUrl: row.base_url,
		enabled: Number(row.enabled) === 1,
		lastSyncAt: row.last_sync_at,
		lastSyncError: row.last_sync_error,
		libraryCount: Number(row.library_count),
		itemCount: Number(row.item_count)
	}));
}

export async function getSourceConfig(db: DB, id: number, key = getCredentialKey()): Promise<SourceConfig | undefined> {
	const row = await get<SourceRow>(db, 'SELECT * FROM sources WHERE id = ?', [id]);
	if (!row) return undefined;
	const source: SourceConfig = {
		id: Number(row.id),
		type: row.type,
		name: row.name,
		baseUrl: row.base_url,
		token: row.credentials_enc ? decrypt(row.credentials_enc, key) : ''
	};
	if (row.type === 'collection') source.collection = await getCollection(db, source.id);
	return source;
}

export async function enabledSourceIds(db: DB): Promise<{ id: number; lastSyncAt: string | null }[]> {
	const rows = await all<{ id: number; last_sync_at: string | null }>(
		db,
		'SELECT id, last_sync_at FROM sources WHERE enabled = 1'
	);
	return rows.map((row) => ({ id: Number(row.id), lastSyncAt: row.last_sync_at }));
}

export interface NewSource {
	type: SourceType;
	name: string;
	baseUrl: string;
	token: string;
	collection?: string;
}

export async function createSource(db: DB, input: NewSource, key = getCredentialKey()): Promise<number> {
	const result = await run(db, 'INSERT INTO sources (type, name, base_url, credentials_enc) VALUES (?, ?, ?, ?)', [
		input.type,
		input.name,
		input.baseUrl,
		input.token ? encrypt(input.token, key) : null
	]);
	const id = result.lastInsertRowid;
	if (input.collection !== undefined) await setCollection(db, id, input.collection);
	return id;
}

export async function getCollection(db: DB, sourceId: number): Promise<string> {
	return (
		(await get<{ body: string }>(db, 'SELECT body FROM collection_lists WHERE source_id = ?', [sourceId]))?.body ?? ''
	);
}

export async function setCollection(db: DB, sourceId: number, body: string): Promise<void> {
	await run(
		db,
		'INSERT INTO collection_lists (source_id, body) VALUES (?, ?) ON CONFLICT(source_id) DO UPDATE SET body = excluded.body',
		[sourceId, body]
	);
}

export async function setSourceEnabled(db: DB, id: number, enabled: boolean): Promise<void> {
	await run(db, 'UPDATE sources SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, id]);
}

/** Explicit cleanup, since foreign key enforcement is not guaranteed on every libSQL connection. */
export const ORPHAN_CLEANUP = [
	'DELETE FROM items WHERE library_id NOT IN (SELECT id FROM libraries)',
	'DELETE FROM overrides WHERE item_id NOT IN (SELECT id FROM items)',
	'DELETE FROM works WHERE id NOT IN (SELECT work_id FROM items)',
	'DELETE FROM work_external_ids WHERE work_id NOT IN (SELECT id FROM works)',
	'DELETE FROM work_availability WHERE work_id NOT IN (SELECT id FROM works)',
	'DELETE FROM availability_checks WHERE work_id NOT IN (SELECT id FROM works)',
	'DELETE FROM works_fts',
	'INSERT INTO works_fts (rowid, title) SELECT id, title FROM works'
];

export async function deleteSource(db: DB, id: number): Promise<void> {
	await writeBatch(db, [
		{ sql: 'DELETE FROM collection_lists WHERE source_id = ?', args: [id] },
		{ sql: 'DELETE FROM libraries WHERE source_id = ?', args: [id] },
		{ sql: 'DELETE FROM sources WHERE id = ?', args: [id] },
		...ORPHAN_CLEANUP
	]);
}
