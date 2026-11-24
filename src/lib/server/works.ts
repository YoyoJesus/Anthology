import type { MediaKind, SourceType, StreamingServiceId, WorkCard, WorkItem, WorkSource } from '#lib/types.ts';
import type { DB } from './db';
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

export function browseWorks(db: DB, query: BrowseQuery): { works: WorkCard[]; total: number } {
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
		const enabled = getEnabledServices(db);
		const services = query.streaming === 'any' ? enabled : enabled.filter((s) => s === query.streaming);
		if (!services.length) return { works: [], total: 0 };
		where.push(
			`w.id IN (SELECT work_id FROM work_availability WHERE service IN (${services.map(() => '?').join(',')}))`
		);
		params.push(...services);
	}
	const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
	const total = (db.prepare(`SELECT COUNT(*) AS n FROM works w ${clause}`).get(...params) as { n: number }).n;
	const rows = db
		.prepare(
			`SELECT w.id, w.title, w.year, w.kind, w.canonical_poster FROM works w ${clause}
			ORDER BY w.title COLLATE NOCASE, w.year LIMIT ? OFFSET ?`
		)
		.all(...params, query.limit ?? 60, query.offset ?? 0) as {
		id: number;
		title: string;
		year: number | null;
		kind: MediaKind;
		canonical_poster: number | null;
	}[];

	const ids = rows.map((row) => row.id);
	const sourcesByWork = workSources(db, ids);
	const streamingByWork = availabilityFor(db, ids);
	return {
		total,
		works: rows.map((row) => ({
			id: row.id,
			title: row.title,
			year: row.year,
			kind: row.kind,
			posterItemId: row.canonical_poster,
			sources: sourcesByWork.get(row.id) ?? [],
			streaming: streamingByWork.get(row.id) ?? []
		}))
	};
}

function workSources(db: DB, workIds: number[]): Map<number, WorkSource[]> {
	const map = new Map<number, WorkSource[]>();
	if (!workIds.length) return map;
	const rows = db
		.prepare(
			`SELECT DISTINCT i.work_id, s.id, s.name, s.type FROM items i
			JOIN libraries l ON l.id = i.library_id JOIN sources s ON s.id = l.source_id
			WHERE i.work_id IN (${workIds.map(() => '?').join(',')}) ORDER BY s.name COLLATE NOCASE`
		)
		.all(...workIds) as { work_id: number; id: number; name: string; type: SourceType }[];
	for (const row of rows) {
		const list = map.get(row.work_id) ?? [];
		list.push({ sourceId: row.id, sourceName: row.name, sourceType: row.type });
		map.set(row.work_id, list);
	}
	return map;
}

export function getWork(db: DB, id: number): (WorkCard & { items: WorkItem[] }) | null {
	const work = db.prepare('SELECT id, title, year, kind, canonical_poster FROM works WHERE id = ?').get(id) as
		{ id: number; title: string; year: number | null; kind: MediaKind; canonical_poster: number | null } | undefined;
	if (!work) return null;
	const items = db
		.prepare(
			`SELECT i.id, i.title, i.year, i.link_url, i.external_ids_json, l.name AS library_name,
				s.id AS source_id, s.name AS source_name, s.type AS source_type
			FROM items i JOIN libraries l ON l.id = i.library_id JOIN sources s ON s.id = l.source_id
			WHERE i.work_id = ? ORDER BY s.name COLLATE NOCASE`
		)
		.all(id) as {
		id: number;
		title: string;
		year: number | null;
		link_url: string;
		external_ids_json: string;
		library_name: string;
		source_id: number;
		source_name: string;
		source_type: SourceType;
	}[];
	return {
		id: work.id,
		title: work.title,
		year: work.year,
		kind: work.kind,
		posterItemId: work.canonical_poster,
		sources: workSources(db, [id]).get(id) ?? [],
		streaming: availabilityFor(db, [id]).get(id) ?? [],
		items: items.map((row) => ({
			id: row.id,
			title: row.title,
			year: row.year,
			linkUrl: row.link_url,
			sourceId: row.source_id,
			sourceName: row.source_name,
			sourceType: row.source_type,
			libraryName: row.library_name,
			externalIds: parseIds(row.external_ids_json)
		}))
	};
}

export function getPosterRef(db: DB, itemId: number): { posterRef: string; sourceId: number } | null {
	const row = db
		.prepare('SELECT i.poster_url, l.source_id FROM items i JOIN libraries l ON l.id = i.library_id WHERE i.id = ?')
		.get(itemId) as { poster_url: string | null; source_id: number } | undefined;
	return row?.poster_url ? { posterRef: row.poster_url, sourceId: row.source_id } : null;
}
