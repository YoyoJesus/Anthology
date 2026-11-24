import type { MediaKind, SourceType, StreamingServiceId, WorkCard, WorkItem, WorkSource } from '#lib/types.ts';
import { all, get, type DB } from './db';
import { parseIds } from './matcher';
import { availabilityFor, getEnabledServices } from './streaming';

export interface BrowseQuery {
	q?: string;
	kind?: MediaKind;
	sourceId?: number;
	/** A service ID, or 'any' for any of the enabled services. */
	streaming?: StreamingServiceId | 'any';
	limit?: number;
	offset?: number;
}

/** Turn free text into a safe FTS5 prefix query, or null if nothing is searchable. */
export function toFtsQuery(input: string): string | null {
	const terms = input
		.normalize('NFKC')
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean)
		.slice(0, 8);
	return terms.length ? terms.map((term) => `"${term}"*`).join(' ') : null;
}

interface WorkRow {
	id: number;
	title: string;
	year: number | null;
	kind: MediaKind;
	canonical_poster: number | null;
}

const num = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));

export async function browseWorks(db: DB, query: BrowseQuery): Promise<{ works: WorkCard[]; total: number }> {
	const where: string[] = [];
	const params: (string | number)[] = [];
	const fts = query.q ? toFtsQuery(query.q) : null;
	if (query.q && !fts) return { works: [], total: 0 };
	if (fts) {
		where.push('w.id IN (SELECT rowid FROM works_fts WHERE works_fts MATCH ?)');
		params.push(fts);
	}
	if (query.kind) {
		where.push('w.kind = ?');
		params.push(query.kind);
	}
	if (query.sourceId) {
		where.push('w.id IN (SELECT i.work_id FROM items i JOIN libraries l ON l.id = i.library_id WHERE l.source_id = ?)');
		params.push(query.sourceId);
	}
	if (query.streaming) {
		const enabled = await getEnabledServices(db);
		const services = query.streaming === 'any' ? enabled : enabled.filter((s) => s === query.streaming);
		if (!services.length) return { works: [], total: 0 };
		where.push(
			`w.id IN (SELECT work_id FROM work_availability WHERE service IN (${services.map(() => '?').join(',')}))`
		);
		params.push(...services);
	}
	const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
	const [countRows, rows] = await Promise.all([
		all<{ n: number }>(db, `SELECT COUNT(*) AS n FROM works w ${clause}`, params),
		all<WorkRow>(
			db,
			`SELECT w.id, w.title, w.year, w.kind, w.canonical_poster FROM works w ${clause}
			ORDER BY w.title COLLATE NOCASE, w.year LIMIT ? OFFSET ?`,
			[...params, query.limit ?? 60, query.offset ?? 0]
		)
	]);

	const ids = rows.map((row) => Number(row.id));
	const [sourcesByWork, streamingByWork] = await Promise.all([workSources(db, ids), availabilityFor(db, ids)]);
	return {
		total: Number(countRows[0]?.n ?? 0),
		works: rows.map((row) => {
			const id = Number(row.id);
			return {
				id,
				title: row.title,
				year: num(row.year),
				kind: row.kind,
				posterItemId: num(row.canonical_poster),
				sources: sourcesByWork.get(id) ?? [],
				streaming: streamingByWork.get(id) ?? []
			};
		})
	};
}

async function workSources(db: DB, workIds: number[]): Promise<Map<number, WorkSource[]>> {
	const map = new Map<number, WorkSource[]>();
	if (!workIds.length) return map;
	const rows = await all<{ work_id: number; id: number; name: string; type: SourceType }>(
		db,
		`SELECT DISTINCT i.work_id, s.id, s.name, s.type FROM items i
		JOIN libraries l ON l.id = i.library_id JOIN sources s ON s.id = l.source_id
		WHERE i.work_id IN (${workIds.map(() => '?').join(',')}) ORDER BY s.name COLLATE NOCASE`,
		workIds
	);
	for (const row of rows) {
		const workId = Number(row.work_id);
		const list = map.get(workId) ?? [];
		list.push({ sourceId: Number(row.id), sourceName: row.name, sourceType: row.type });
		map.set(workId, list);
	}
	return map;
}

export async function getWork(db: DB, id: number): Promise<(WorkCard & { items: WorkItem[] }) | null> {
	const work = await get<WorkRow>(db, 'SELECT id, title, year, kind, canonical_poster FROM works WHERE id = ?', [id]);
	if (!work) return null;
	const [items, sources, streaming] = await Promise.all([
		all<{
			id: number;
			title: string;
			year: number | null;
			link_url: string;
			external_ids_json: string;
			library_name: string;
			source_id: number;
			source_name: string;
			source_type: SourceType;
		}>(
			db,
			`SELECT i.id, i.title, i.year, i.link_url, i.external_ids_json, l.name AS library_name,
				s.id AS source_id, s.name AS source_name, s.type AS source_type
			FROM items i JOIN libraries l ON l.id = i.library_id JOIN sources s ON s.id = l.source_id
			WHERE i.work_id = ? ORDER BY s.name COLLATE NOCASE`,
			[id]
		),
		workSources(db, [id]),
		availabilityFor(db, [id])
	]);
	return {
		id: Number(work.id),
		title: work.title,
		year: num(work.year),
		kind: work.kind,
		posterItemId: num(work.canonical_poster),
		sources: sources.get(id) ?? [],
		streaming: streaming.get(id) ?? [],
		items: items.map((row) => ({
			id: Number(row.id),
			title: row.title,
			year: num(row.year),
			linkUrl: row.link_url,
			sourceId: Number(row.source_id),
			sourceName: row.source_name,
			sourceType: row.source_type,
			libraryName: row.library_name,
			externalIds: parseIds(row.external_ids_json)
		}))
	};
}

export async function getPosterRef(db: DB, itemId: number): Promise<{ posterRef: string; sourceId: number } | null> {
	const row = await get<{ poster_url: string | null; source_id: number }>(
		db,
		'SELECT i.poster_url, l.source_id FROM items i JOIN libraries l ON l.id = i.library_id WHERE i.id = ?',
		[itemId]
	);
	return row?.poster_url ? { posterRef: row.poster_url, sourceId: Number(row.source_id) } : null;
}
