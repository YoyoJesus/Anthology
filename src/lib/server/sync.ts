import type { InStatement } from '@libsql/client';
import type { ExternalIds, MediaKind } from '#lib/types.ts';
import { all, run, writeBatch, type DB } from './db';
import type { Library, RawItem, SourceAdapter } from './adapters/types';
import { idsConflict, matchKey, normalizeTitle, parseIds } from './matcher';
import { ORPHAN_CLEANUP } from './sources';
import { randomToken } from './crypto';

interface WorkEntry {
	id: number;
	kind: MediaKind;
	title: string;
	year: number | null;
	ids: ExternalIds;
}

const titleKey = (kind: MediaKind, title: string) => `${kind}|${normalizeTitle(title)}`;
const idKey = (kind: MediaKind, provider: string, value: string) => `${kind}|${provider}|${value}`;

/**
 * In-memory view of works used to match a whole sync without a query per item.
 * Changes are collected as statements and written in one batch.
 */
export class WorkIndex {
	private byTitle = new Map<string, WorkEntry[]>();
	private byExternalId = new Map<string, number>();
	private byId = new Map<number, WorkEntry>();
	readonly statements: InStatement[] = [];

	private constructor(private nextId: number) {}

	static async load(db: DB): Promise<WorkIndex> {
		const works = await all<{
			id: number;
			kind: MediaKind;
			title: string;
			year: number | null;
			external_ids_json: string;
		}>(db, 'SELECT id, kind, title, year, external_ids_json FROM works');
		const externalIds = await all<{ kind: MediaKind; provider: string; value: string; work_id: number }>(
			db,
			'SELECT kind, provider, value, work_id FROM work_external_ids'
		);
		const index = new WorkIndex(works.reduce((max, w) => Math.max(max, Number(w.id)), 0) + 1);
		for (const w of works) {
			index.add({
				id: Number(w.id),
				kind: w.kind,
				title: w.title,
				year: w.year === null ? null : Number(w.year),
				ids: parseIds(w.external_ids_json)
			});
		}
		for (const row of externalIds)
			index.byExternalId.set(idKey(row.kind, row.provider, row.value), Number(row.work_id));
		return index;
	}

	private add(entry: WorkEntry): void {
		this.byId.set(entry.id, entry);
		const key = titleKey(entry.kind, entry.title);
		this.byTitle.set(key, [...(this.byTitle.get(key) ?? []), entry]);
	}

	/** Manual override, then external IDs, then title + year, then a unique title when one side has no year. */
	resolve(raw: RawItem, overrideWorkId?: number): number {
		if (overrideWorkId !== undefined && this.byId.has(overrideWorkId)) return overrideWorkId;

		for (const [provider, value] of Object.entries(raw.externalIds)) {
			const id = value ? this.byExternalId.get(idKey(raw.kind, provider, value)) : undefined;
			if (id !== undefined) return this.attach(id, raw.externalIds);
		}

		const sameTitle = (this.byTitle.get(titleKey(raw.kind, raw.title)) ?? []).filter(
			(work) => !idsConflict(work.ids, raw.externalIds)
		);
		const exact = sameTitle.find((work) => work.year === raw.year);
		if (exact) return this.attach(exact.id, raw.externalIds);

		const loose = raw.year === null ? sameTitle : sameTitle.filter((work) => work.year === null);
		if (loose.length === 1) {
			const work = loose[0];
			if (raw.year !== null) {
				work.year = raw.year;
				this.statements.push({
					sql: 'UPDATE works SET year = ?, match_key = ? WHERE id = ?',
					args: [raw.year, matchKey(work.kind, work.title, raw.year), work.id]
				});
			}
			return this.attach(work.id, raw.externalIds);
		}

		const work: WorkEntry = { id: this.nextId++, kind: raw.kind, title: raw.title, year: raw.year, ids: {} };
		this.add(work);
		this.statements.push({
			sql: 'INSERT INTO works (id, title, year, kind, match_key, external_ids_json) VALUES (?, ?, ?, ?, ?, ?)',
			args: [work.id, raw.title, raw.year, raw.kind, matchKey(raw.kind, raw.title, raw.year), '{}']
		});
		return this.attach(work.id, raw.externalIds);
	}

	private attach(workId: number, ids: ExternalIds): number {
		const work = this.byId.get(workId);
		if (!work) return workId;
		let changed = false;
		for (const [provider, value] of Object.entries(ids)) {
			if (!value) continue;
			const key = idKey(work.kind, provider, value);
			if (!this.byExternalId.has(key)) {
				this.byExternalId.set(key, workId);
				this.statements.push({
					sql: 'INSERT OR IGNORE INTO work_external_ids (kind, provider, value, work_id) VALUES (?, ?, ?, ?)',
					args: [work.kind, provider, value, workId]
				});
			}
			const p = provider as keyof ExternalIds;
			if (!work.ids[p]) {
				work.ids[p] = value;
				changed = true;
			}
		}
		if (changed) {
			this.statements.push({
				sql: 'UPDATE works SET external_ids_json = ? WHERE id = ?',
				args: [JSON.stringify(work.ids), workId]
			});
		}
		return workId;
	}
}

async function upsertLibraries(db: DB, sourceId: number, libraries: Library[]): Promise<Map<string, number>> {
	const results = await db.batch(
		libraries.map((lib) => ({
			sql: `INSERT INTO libraries (source_id, remote_id, name, kind) VALUES (?, ?, ?, ?)
				ON CONFLICT(source_id, remote_id) DO UPDATE SET name = excluded.name, kind = excluded.kind
				RETURNING id`,
			args: [sourceId, lib.remoteId, lib.name, lib.kind]
		})),
		'write'
	);
	const ids = new Map<string, number>();
	libraries.forEach((lib, i) => ids.set(lib.remoteId, Number(results[i].rows[0].id)));
	const keep = [...ids.values()];
	const notIn = keep.length ? `AND id NOT IN (${keep.map(() => '?').join(',')})` : '';
	await writeBatch(db, [
		{
			sql: `DELETE FROM items WHERE library_id IN (SELECT id FROM libraries WHERE source_id = ? ${notIn})`,
			args: [sourceId, ...keep]
		},
		{ sql: `DELETE FROM libraries WHERE source_id = ? ${notIn}`, args: [sourceId, ...keep] }
	]);
	return ids;
}

export interface SyncResult {
	libraries: number;
	items: number;
}

const UPSERT_ITEM = `INSERT INTO items (library_id, remote_id, work_id, title, year, kind, external_ids_json, link_url, poster_url, added_at, updated_at, sync_token)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT(library_id, remote_id) DO UPDATE SET
		work_id = excluded.work_id, title = excluded.title, year = excluded.year, kind = excluded.kind,
		external_ids_json = excluded.external_ids_json, link_url = excluded.link_url, poster_url = excluded.poster_url,
		added_at = excluded.added_at, updated_at = excluded.updated_at, sync_token = excluded.sync_token`;

/** Full sync: every item seen this run is kept, everything else from this source is removed. */
export async function syncSource(db: DB, sourceId: number, adapter: SourceAdapter): Promise<SyncResult> {
	const token = randomToken();
	try {
		const libraries = await adapter.listLibraries();
		const libraryIds = await upsertLibraries(db, sourceId, libraries);

		const index = await WorkIndex.load(db);
		const overrides = new Map<string, number>();
		for (const row of await all<{ library_id: number; remote_id: string; work_id: number }>(
			db,
			`SELECT i.library_id, i.remote_id, o.work_id FROM overrides o JOIN items i ON i.id = o.item_id
			JOIN libraries l ON l.id = i.library_id WHERE l.source_id = ?`,
			[sourceId]
		)) {
			overrides.set(`${row.library_id}|${row.remote_id}`, Number(row.work_id));
		}

		let count = 0;
		for (const library of libraries) {
			const libraryId = libraryIds.get(library.remoteId)!;
			for await (const raw of adapter.fetchItems(library)) {
				const workId = index.resolve(raw, overrides.get(`${libraryId}|${raw.remoteId}`));
				index.statements.push({
					sql: UPSERT_ITEM,
					args: [
						libraryId,
						raw.remoteId,
						workId,
						raw.title,
						raw.year,
						raw.kind,
						JSON.stringify(raw.externalIds),
						adapter.buildLink(raw),
						raw.posterRef,
						raw.addedAt,
						raw.updatedAt,
						token
					]
				});
				count++;
			}
		}

		await writeBatch(db, [
			...index.statements,
			{
				sql: `DELETE FROM items WHERE sync_token IS NOT ? AND library_id IN (SELECT id FROM libraries WHERE source_id = ?)`,
				args: [token, sourceId]
			},
			...ORPHAN_CLEANUP,
			`UPDATE works SET canonical_poster = (
				SELECT i.id FROM items i WHERE i.work_id = works.id AND i.poster_url IS NOT NULL ORDER BY i.id LIMIT 1
			)`,
			{
				sql: "UPDATE sources SET last_sync_at = datetime('now'), last_sync_error = NULL WHERE id = ?",
				args: [sourceId]
			}
		]);
		return { libraries: libraries.length, items: count };
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Sync failed';
		await run(db, 'UPDATE sources SET last_sync_error = ? WHERE id = ?', [message, sourceId]).catch(() => undefined);
		throw err;
	}
}
