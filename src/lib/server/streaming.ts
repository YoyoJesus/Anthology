import { STREAMING_SERVICES, type StreamingServiceId } from '#lib/types.ts';
import { all, get, getSetting, setSetting, type DB } from './db';
import { SERVICE_PATTERNS, TMDB_POSTER_PATH } from './adapters/streaming';
import { normalizeTitle, parseIds } from './matcher';

const TMDB_API = 'https://api.themoviedb.org/3';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Subscription offers only. Store listings (buy/rent) say nothing about what you can already watch. */
const SUBSCRIPTION_CATEGORIES = ['flatrate', 'ads'] as const;

interface TmdbProvider {
	provider_name: string;
}

export interface TmdbWatchProviders {
	results?: Record<string, ({ link?: string } & Partial<Record<string, TmdbProvider[] | string>>) | undefined>;
}

export function servicesFromProviders(
	payload: TmdbWatchProviders,
	region: string
): { services: StreamingServiceId[]; link: string | null } {
	const entry = payload.results?.[region];
	if (!entry) return { services: [], link: null };
	const names: string[] = [];
	for (const category of SUBSCRIPTION_CATEGORIES) {
		const list = entry[category];
		if (Array.isArray(list)) for (const p of list) names.push(p.provider_name.trim().toLowerCase());
	}
	const services = STREAMING_SERVICES.map((s) => s.id).filter((id) => names.some((n) => SERVICE_PATTERNS[id].test(n)));
	const link =
		typeof entry.link === 'string' && entry.link.startsWith('https://www.themoviedb.org/') ? entry.link : null;
	return { services, link };
}

export async function fetchWatchProviders(
	kind: 'movie' | 'tv',
	tmdbId: string,
	token: string
): Promise<TmdbWatchProviders> {
	const res = await fetch(`${TMDB_API}/${kind}/${encodeURIComponent(tmdbId)}/watch/providers`, {
		headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
		signal: AbortSignal.timeout(15_000)
	});
	if (res.status === 401) throw new Error('TMDB rejected the read access token');
	if (!res.ok) throw new Error(`TMDB responded with HTTP ${res.status}`);
	return (await res.json()) as TmdbWatchProviders;
}

interface TmdbSearchResult {
	id: number;
	title?: string;
	original_title?: string;
	release_date?: string;
	name?: string;
	original_name?: string;
	first_air_date?: string;
	poster_path?: string | null;
}

/** First result whose title matches exactly and whose year is within one of ours (when we know it). */
export function pickSearchResult(results: TmdbSearchResult[], title: string, year: number | null): string | null {
	const wanted = normalizeTitle(title);
	for (const r of results) {
		const titles = [r.title, r.original_title, r.name, r.original_name].filter((t): t is string => Boolean(t));
		if (!titles.some((t) => normalizeTitle(t) === wanted)) continue;
		const released = Number((r.release_date ?? r.first_air_date ?? '').slice(0, 4));
		if (year !== null && (!released || Math.abs(released - year) > 1)) continue;
		return String(r.id);
	}
	return null;
}

export interface SearchMatch {
	id: string;
	posterPath: string | null;
}

/** Finds a TMDB ID and poster for titles that came without one, such as digital collection entries. */
export async function searchTmdbId(
	kind: 'movie' | 'tv',
	title: string,
	year: number | null,
	token: string
): Promise<SearchMatch | null> {
	const params = new URLSearchParams({ query: title, include_adult: 'false' });
	const res = await fetch(`${TMDB_API}/search/${kind}?${params}`, {
		headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
		signal: AbortSignal.timeout(15_000)
	});
	if (res.status === 401) throw new Error('TMDB rejected the read access token');
	if (!res.ok) throw new Error(`TMDB responded with HTTP ${res.status}`);
	const results = ((await res.json()) as { results?: TmdbSearchResult[] }).results ?? [];
	const id = pickSearchResult(results, title, year);
	if (!id) return null;
	const poster = results.find((r) => String(r.id) === id)?.poster_path;
	return { id, posterPath: poster && TMDB_POSTER_PATH.test(poster) ? poster : null };
}

export async function getEnabledServices(db: DB): Promise<StreamingServiceId[]> {
	const known = STREAMING_SERVICES.map((s) => s.id) as string[];
	try {
		const value: unknown = JSON.parse((await getSetting(db, 'streaming_services')) ?? '[]');
		return Array.isArray(value) ? (value.filter((v) => known.includes(v)) as StreamingServiceId[]) : [];
	} catch {
		return [];
	}
}

export async function setEnabledServices(db: DB, services: StreamingServiceId[]): Promise<void> {
	await setSetting(db, 'streaming_services', JSON.stringify(services));
}

/**
 * (work_id, service) pairs: per-title lookups for titles you own, plus every title in an imported service catalogue.
 * 'streaming://' is 12 characters, so the service ID starts at character 13.
 */
export const AVAILABLE_SQL = `SELECT work_id, service FROM work_availability
	UNION SELECT i.work_id, substr(s.base_url, 13) AS service FROM items i
	JOIN libraries l ON l.id = i.library_id JOIN sources s ON s.id = l.source_id WHERE s.type = 'streaming'`;

/** Enabled services each work is on. Services you have not ticked are hidden. */
export async function availabilityFor(db: DB, workIds: number[]): Promise<Map<number, StreamingServiceId[]>> {
	const map = new Map<number, StreamingServiceId[]>();
	const enabled = await getEnabledServices(db);
	if (!workIds.length || !enabled.length) return map;
	const rows = await all<{ work_id: number; service: StreamingServiceId }>(
		db,
		`SELECT work_id, service FROM (${AVAILABLE_SQL})
		WHERE work_id IN (${workIds.map(() => '?').join(',')}) AND service IN (${enabled.map(() => '?').join(',')})`,
		[...workIds, ...enabled]
	);
	const order = STREAMING_SERVICES.map((s) => s.id) as StreamingServiceId[];
	for (const row of rows) {
		const workId = Number(row.work_id);
		const list = map.get(workId) ?? [];
		list.push(row.service);
		list.sort((a, b) => order.indexOf(a) - order.indexOf(b));
		map.set(workId, list);
	}
	return map;
}

export async function availabilityLink(db: DB, workId: number): Promise<string | null> {
	return (
		(await get<{ link: string | null }>(db, 'SELECT link FROM availability_checks WHERE work_id = ?', [workId]))
			?.link ?? null
	);
}

/** Poster path for a known TMDB ID, for titles that were matched before posters were stored. */
export async function fetchPosterPath(kind: 'movie' | 'tv', tmdbId: string, token: string): Promise<string | null> {
	const res = await fetch(`${TMDB_API}/${kind}/${encodeURIComponent(tmdbId)}`, {
		headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
		signal: AbortSignal.timeout(15_000)
	});
	if (res.status === 401) throw new Error('TMDB rejected the read access token');
	if (!res.ok) return null;
	const path = ((await res.json()) as { poster_path?: string | null }).poster_path;
	return path && TMDB_POSTER_PATH.test(path) ? path : null;
}

export interface RefreshOptions {
	token: string;
	region: string;
	force?: boolean;
	now?: number;
	concurrency?: number;
	/** Stop starting new lookups after this time (ms since epoch). The rest are picked up next run. */
	deadline?: number;
	fetchProviders?: typeof fetchWatchProviders;
	searchTitle?: typeof searchTmdbId;
	fetchPosterPath?: typeof fetchPosterPath;
}

export interface RefreshResult {
	checked: number;
	/** Titles TMDB had no confident match for. */
	skipped: number;
	failed: number;
	remaining: number;
	error: string | null;
}

/**
 * Look up subscription availability for titles you own that were not checked recently in this region, finding TMDB IDs
 * by title when missing. Titles that only come from an imported catalogue need no lookup.
 */
export async function refreshAvailability(db: DB, options: RefreshOptions): Promise<RefreshResult> {
	const now = options.now ?? Date.now();
	const fetchProviders = options.fetchProviders ?? fetchWatchProviders;
	const searchTitle = options.searchTitle ?? searchTmdbId;
	const works = await all<{
		id: number;
		kind: 'movie' | 'show';
		title: string;
		year: number | null;
		external_ids_json: string;
		region: string | null;
		checked_at: number | null;
	}>(
		db,
		`SELECT w.id, w.kind, w.title, w.year, w.external_ids_json, c.region, c.checked_at FROM works w
		LEFT JOIN availability_checks c ON c.work_id = w.id WHERE w.kind IN ('movie', 'show') AND EXISTS (
			SELECT 1 FROM items i JOIN libraries l ON l.id = i.library_id JOIN sources s ON s.id = l.source_id
			WHERE i.work_id = w.id AND s.type != 'streaming'
		)`
	);

	interface Job {
		id: number;
		kind: 'movie' | 'tv';
		title: string;
		year: number | null;
		ids: ReturnType<typeof parseIds>;
	}
	const queue: Job[] = [];
	for (const work of works) {
		const checkedAt = work.checked_at === null ? null : Number(work.checked_at);
		const fresh = work.region === options.region && checkedAt !== null && now - checkedAt < MAX_AGE_MS;
		if (options.force || !fresh)
			queue.push({
				id: Number(work.id),
				kind: work.kind === 'show' ? 'tv' : 'movie',
				title: work.title,
				year: work.year === null ? null : Number(work.year),
				ids: parseIds(work.external_ids_json)
			});
	}
	let skipped = 0;

	const save = (workId: number, services: StreamingServiceId[], link: string | null) =>
		db.batch(
			[
				{ sql: 'DELETE FROM work_availability WHERE work_id = ?', args: [workId] },
				...services.map((service) => ({
					sql: 'INSERT INTO work_availability (work_id, service) VALUES (?, ?)',
					args: [workId, service]
				})),
				{
					sql: `INSERT INTO availability_checks (work_id, region, link, checked_at) VALUES (?, ?, ?, ?)
					ON CONFLICT(work_id) DO UPDATE SET region = excluded.region, link = excluded.link, checked_at = excluded.checked_at`,
					args: [workId, options.region, link, now]
				}
			],
			'write'
		);

	let checked = 0;
	let failed = 0;
	let error: string | null = null;
	const outOfTime = () => options.deadline !== undefined && Date.now() >= options.deadline;
	const worker = async () => {
		while (!error && !outOfTime()) {
			const next = queue.shift();
			if (!next) return;
			try {
				let tmdbId = next.ids.tmdb ?? null;
				if (!tmdbId) {
					const match = await searchTitle(next.kind, next.title, next.year, options.token);
					tmdbId = match?.id ?? null;
					if (!match || !tmdbId) {
						await save(next.id, [], null);
						skipped++;
						continue;
					}
					await db.batch(
						[
							{
								sql: 'INSERT OR IGNORE INTO work_external_ids (kind, provider, value, work_id) VALUES (?, ?, ?, ?)',
								args: [next.kind === 'tv' ? 'show' : 'movie', 'tmdb', tmdbId, next.id]
							},
							{
								sql: 'UPDATE works SET external_ids_json = ? WHERE id = ?',
								args: [JSON.stringify({ ...next.ids, tmdb: tmdbId }), next.id]
							},
							...(match.posterPath
								? [
										{
											sql: `INSERT INTO work_posters (work_id, path) VALUES (?, ?)
											ON CONFLICT(work_id) DO UPDATE SET path = excluded.path`,
											args: [next.id, match.posterPath]
										}
									]
								: [])
						],
						'write'
					);
				}
				const payload = await fetchProviders(next.kind, tmdbId, options.token);
				const { services, link } = servicesFromProviders(payload, options.region);
				await save(next.id, services, link);
				checked++;
			} catch (err) {
				failed++;
				if (err instanceof Error && err.message.includes('rejected')) error = err.message;
			}
		}
	};
	await Promise.all(Array.from({ length: options.concurrency ?? 4 }, worker));

	// Titles you own with a TMDB ID but no artwork of their own. An empty path records that TMDB has none.
	const posterless = await all<{ id: number; kind: 'movie' | 'show'; external_ids_json: string }>(
		db,
		`SELECT w.id, w.kind, w.external_ids_json FROM works w WHERE w.kind IN ('movie', 'show')
		AND w.canonical_poster IS NULL AND w.id NOT IN (SELECT work_id FROM work_posters) AND EXISTS (
			SELECT 1 FROM items i JOIN libraries l ON l.id = i.library_id JOIN sources s ON s.id = l.source_id
			WHERE i.work_id = w.id AND s.type != 'streaming'
		)`
	);
	const getPoster = options.fetchPosterPath ?? fetchPosterPath;
	const posterWorker = async () => {
		while (!error && !outOfTime()) {
			const work = posterless.shift();
			if (!work) return;
			const tmdbId = parseIds(work.external_ids_json).tmdb;
			if (!tmdbId) continue;
			try {
				const path = await getPoster(work.kind === 'show' ? 'tv' : 'movie', tmdbId, options.token);
				await db.execute({
					sql: 'INSERT INTO work_posters (work_id, path) VALUES (?, ?) ON CONFLICT(work_id) DO UPDATE SET path = excluded.path',
					args: [Number(work.id), path ?? '']
				});
			} catch (err) {
				if (err instanceof Error && err.message.includes('rejected')) error = err.message;
			}
		}
	};
	await Promise.all(Array.from({ length: options.concurrency ?? 4 }, posterWorker));
	return { checked, skipped, failed, remaining: queue.length, error };
}
