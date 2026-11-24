import type { ExternalIds } from '#lib/types.ts';
import type { DB } from './db';
import type { Library, RawItem, SourceAdapter } from './adapters/types';
import { idsConflict, matchKey, parseIds } from './matcher';
import { removeOrphanWorks } from './sources';
import { randomToken } from './crypto';

interface WorkRow {
	id: number;
	external_ids_json: string;
}

/** Find or create the work an item belongs to: manual override, then external IDs, then title + year. */
export function resolveWork(db: DB, raw: RawItem, existingItemId?: number): number {
	if (existingItemId !== undefined) {
		const override = db.prepare('SELECT work_id FROM overrides WHERE item_id = ?').get(existingItemId) as
			{ work_id: number } | undefined;
		if (override) return override.work_id;
	}

	const byId = db.prepare('SELECT work_id FROM work_external_ids WHERE kind = ? AND provider = ? AND value = ?');
	for (const [provider, value] of Object.entries(raw.externalIds)) {
		const row = byId.get(raw.kind, provider, value) as { work_id: number } | undefined;
		if (row) return attachIds(db, row.work_id, raw.externalIds);
	}

	const key = matchKey(raw.kind, raw.title, raw.year);
	const candidates = db.prepare('SELECT id, external_ids_json FROM works WHERE match_key = ?').all(key) as WorkRow[];
	const match = candidates.find((work) => !idsConflict(parseIds(work.external_ids_json), raw.externalIds));
	if (match) return attachIds(db, match.id, raw.externalIds);

	const result = db
		.prepare('INSERT INTO works (title, year, kind, match_key, external_ids_json) VALUES (?, ?, ?, ?, ?)')
		.run(raw.title, raw.year, raw.kind, key, JSON.stringify(raw.externalIds));
	const workId = Number(result.lastInsertRowid);
	return attachIds(db, workId, raw.externalIds);
}

function attachIds(db: DB, workId: number, ids: ExternalIds): number {
	const insert = db.prepare(
		'INSERT OR IGNORE INTO work_external_ids (kind, provider, value, work_id) SELECT kind, ?, ?, id FROM works WHERE id = ?'
	);
	for (const [provider, value] of Object.entries(ids)) insert.run(provider, value, workId);
	const row = db.prepare('SELECT external_ids_json FROM works WHERE id = ?').get(workId) as WorkRow | undefined;
	const merged = { ...ids, ...parseIds(row?.external_ids_json) };
	db.prepare('UPDATE works SET external_ids_json = ? WHERE id = ?').run(JSON.stringify(merged), workId);
	return workId;
}

function upsertLibraries(db: DB, sourceId: number, libraries: Library[]): Map<string, number> {
	const ids = new Map<string, number>();
	db.transaction(() => {
		const upsert = db.prepare(
			`INSERT INTO libraries (source_id, remote_id, name, kind) VALUES (?, ?, ?, ?)
			ON CONFLICT(source_id, remote_id) DO UPDATE SET name = excluded.name, kind = excluded.kind
			RETURNING id`
		);
		for (const lib of libraries) {
			const row = upsert.get(sourceId, lib.remoteId, lib.name, lib.kind) as { id: number };
			ids.set(lib.remoteId, row.id);
		}
		const keep = [...ids.values()];
		db.prepare(
			`DELETE FROM libraries WHERE source_id = ? AND id NOT IN (${keep.map(() => '?').join(',') || 'NULL'})`
		).run(sourceId, ...keep);
	})();
	return ids;
}

function writeItems(db: DB, adapter: SourceAdapter, libraryId: number, items: RawItem[], token: string): void {
	const existing = db.prepare('SELECT id FROM items WHERE library_id = ? AND remote_id = ?');
	const upsert = db.prepare(
		`INSERT INTO items (library_id, remote_id, work_id, title, year, kind, external_ids_json, link_url, poster_url, added_at, updated_at, sync_token)
		VALUES (@libraryId, @remoteId, @workId, @title, @year, @kind, @ids, @link, @poster, @addedAt, @updatedAt, @token)
		ON CONFLICT(library_id, remote_id) DO UPDATE SET
			work_id = excluded.work_id, title = excluded.title, year = excluded.year, kind = excluded.kind,
			external_ids_json = excluded.external_ids_json, link_url = excluded.link_url, poster_url = excluded.poster_url,
			added_at = excluded.added_at, updated_at = excluded.updated_at, sync_token = excluded.sync_token`
	);
	db.transaction(() => {
		for (const raw of items) {
			const current = existing.get(libraryId, raw.remoteId) as { id: number } | undefined;
			upsert.run({
				libraryId,
				remoteId: raw.remoteId,
				workId: resolveWork(db, raw, current?.id),
				title: raw.title,
				year: raw.year,
				kind: raw.kind,
				ids: JSON.stringify(raw.externalIds),
				link: adapter.buildLink(raw),
				poster: raw.posterRef,
				addedAt: raw.addedAt,
				updatedAt: raw.updatedAt,
				token
			});
		}
	})();
}

function finishSync(db: DB, sourceId: number, token: string): void {
	db.transaction(() => {
		db.prepare(
			`DELETE FROM items WHERE sync_token IS NOT ?
			AND library_id IN (SELECT id FROM libraries WHERE source_id = ?)`
		).run(token, sourceId);
		removeOrphanWorks(db);
		db.exec(
			`UPDATE works SET canonical_poster = (
				SELECT i.id FROM items i WHERE i.work_id = works.id AND i.poster_url IS NOT NULL ORDER BY i.id LIMIT 1
			)`
		);
		db.prepare("UPDATE sources SET last_sync_at = datetime('now'), last_sync_error = NULL WHERE id = ?").run(sourceId);
	})();
}

export interface SyncResult {
	libraries: number;
	items: number;
}

/** Full sync: every item seen this run is kept, everything else from this source is removed. */
export async function syncSource(db: DB, sourceId: number, adapter: SourceAdapter): Promise<SyncResult> {
	const token = randomToken();
	try {
		const libraries = await adapter.listLibraries();
		const libraryIds = upsertLibraries(db, sourceId, libraries);
		let count = 0;
		for (const library of libraries) {
			const batch: RawItem[] = [];
			for await (const item of adapter.fetchItems(library)) batch.push(item);
			writeItems(db, adapter, libraryIds.get(library.remoteId)!, batch, token);
			count += batch.length;
		}
		finishSync(db, sourceId, token);
		return { libraries: libraries.length, items: count };
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Sync failed';
		db.prepare('UPDATE sources SET last_sync_error = ? WHERE id = ?').run(message, sourceId);
		throw err;
	}
}
