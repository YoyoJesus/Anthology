import { STREAMING_SERVICES, type StreamingServiceId } from '#lib/types.ts';
import type { DB } from './db';
import { getSetting, setSetting } from './db';
import { parseIds } from './matcher';

const TMDB_API = 'https://api.themoviedb.org/3';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Subscription offers only. Store listings (buy/rent) say nothing about what you can already watch. */
const SUBSCRIPTION_CATEGORIES = ['flatrate', 'ads'] as const;

const PATTERNS: Record<StreamingServiceId, RegExp> = {
	netflix: /^netflix\b/,
	prime: /^amazon prime video\b/,
	hulu: /^hulu\b/,
	disney: /^disney(\+| plus)/,
	appletv: /^apple tv( plus|\+)?$/
};

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
	const services = STREAMING_SERVICES.map((s) => s.id).filter((id) => names.some((n) => PATTERNS[id].test(n)));
	return { services, link: typeof entry.link === 'string' ? entry.link : null };
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

export function getEnabledServices(db: DB): StreamingServiceId[] {
	const known = STREAMING_SERVICES.map((s) => s.id) as string[];
	try {
		const value: unknown = JSON.parse(getSetting(db, 'streaming_services') ?? '[]');
		return Array.isArray(value) ? (value.filter((v) => known.includes(v)) as StreamingServiceId[]) : [];
	} catch {
		return [];
	}
}

export function setEnabledServices(db: DB, services: StreamingServiceId[]): void {
	setSetting(db, 'streaming_services', JSON.stringify(services));
}

/** Enabled services each work is on. Services you have not ticked are hidden. */
export function availabilityFor(db: DB, workIds: number[]): Map<number, StreamingServiceId[]> {
	const map = new Map<number, StreamingServiceId[]>();
	const enabled = getEnabledServices(db);
	if (!workIds.length || !enabled.length) return map;
	const rows = db
		.prepare(
			`SELECT work_id, service FROM work_availability
			WHERE work_id IN (${workIds.map(() => '?').join(',')}) AND service IN (${enabled.map(() => '?').join(',')})`
		)
		.all(...workIds, ...enabled) as { work_id: number; service: StreamingServiceId }[];
	const order = STREAMING_SERVICES.map((s) => s.id) as StreamingServiceId[];
	for (const row of rows) {
		const list = map.get(row.work_id) ?? [];
		list.push(row.service);
		list.sort((a, b) => order.indexOf(a) - order.indexOf(b));
		map.set(row.work_id, list);
	}
	return map;
}

export function availabilityLink(db: DB, workId: number): string | null {
	const row = db.prepare('SELECT link FROM availability_checks WHERE work_id = ?').get(workId) as
		{ link: string | null } | undefined;
	return row?.link ?? null;
}

export interface RefreshOptions {
	token: string;
	region: string;
	force?: boolean;
	now?: number;
	concurrency?: number;
	fetchProviders?: typeof fetchWatchProviders;
}

export interface RefreshResult {
	checked: number;
	skipped: number;
	failed: number;
	error: string | null;
}

/** Look up subscription availability for works with a TMDB ID that were not checked recently in this region. */
export async function refreshAvailability(db: DB, options: RefreshOptions): Promise<RefreshResult> {
	const now = options.now ?? Date.now();
	const fetchProviders = options.fetchProviders ?? fetchWatchProviders;
	const works = db
		.prepare(
			`SELECT w.id, w.kind, w.external_ids_json, c.region, c.checked_at FROM works w
			LEFT JOIN availability_checks c ON c.work_id = w.id WHERE w.kind IN ('movie', 'show')`
		)
		.all() as {
		id: number;
		kind: 'movie' | 'show';
		external_ids_json: string;
		region: string | null;
		checked_at: number | null;
	}[];

	const queue: { id: number; kind: 'movie' | 'tv'; tmdbId: string }[] = [];
	let skipped = 0;
	for (const work of works) {
		const tmdbId = parseIds(work.external_ids_json).tmdb;
		const fresh = work.region === options.region && work.checked_at !== null && now - work.checked_at < MAX_AGE_MS;
		if (!tmdbId) skipped++;
		else if (options.force || !fresh) queue.push({ id: work.id, kind: work.kind === 'show' ? 'tv' : 'movie', tmdbId });
	}

	const save = db.transaction((workId: number, services: StreamingServiceId[], link: string | null) => {
		db.prepare('DELETE FROM work_availability WHERE work_id = ?').run(workId);
		const insert = db.prepare('INSERT INTO work_availability (work_id, service) VALUES (?, ?)');
		for (const service of services) insert.run(workId, service);
		db.prepare(
			`INSERT INTO availability_checks (work_id, region, link, checked_at) VALUES (?, ?, ?, ?)
			ON CONFLICT(work_id) DO UPDATE SET region = excluded.region, link = excluded.link, checked_at = excluded.checked_at`
		).run(workId, options.region, link, now);
	});

	let checked = 0;
	let failed = 0;
	let error: string | null = null;
	const worker = async () => {
		for (let next = queue.shift(); next && !error; next = queue.shift()) {
			try {
				const payload = await fetchProviders(next.kind, next.tmdbId, options.token);
				const { services, link } = servicesFromProviders(payload, options.region);
				save(next.id, services, link);
				checked++;
			} catch (err) {
				failed++;
				if (err instanceof Error && err.message.includes('rejected')) error = err.message;
			}
		}
	};
	await Promise.all(Array.from({ length: options.concurrency ?? 4 }, worker));
	return { checked, skipped, failed, error };
}
