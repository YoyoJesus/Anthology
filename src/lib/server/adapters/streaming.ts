import { STREAMING_SERVICES, type MediaKind, type StreamingServiceId } from '#lib/types.ts';
import { serviceSearchUrl } from '#lib/service-links.ts';
import { config } from '../config';
import type { Library, RawItem, SourceAdapter, SourceConfig } from './types';

const TMDB_API = 'https://api.themoviedb.org/3';
const TMDB_IMAGES = 'https://image.tmdb.org/t/p/w342';
/** TMDB returns at most 500 pages (10,000 results) for one discover query. */
const MAX_PAGES = 500;
const CONCURRENCY = 12;
const FIRST_YEAR = 1900;

export const STREAMING_URL_PREFIX = 'streaming://';

/** TMDB image paths look like "/abc123.jpg". Anything else is refused so the proxy cannot be pointed elsewhere. */
export const TMDB_POSTER_PATH = /^\/[\w-]+\.(jpg|png)$/;

export function fetchTmdbPoster(path: string, fetchFn: typeof fetch = globalThis.fetch): Promise<Response> {
	if (!TMDB_POSTER_PATH.test(path)) return Promise.reject(new Error('Invalid poster reference'));
	return fetchFn(`${TMDB_IMAGES}${path}`, { signal: AbortSignal.timeout(15_000) });
}

/**
 * Provider names as TMDB lists them, lowercased. Plans with ads count as the same service. Paid add-ons ("... Amazon
 * Channel"), stores ("Amazon Video") and Amazon's free tier ("Amazon Prime Video Free with Ads") do not.
 */
export const SERVICE_PATTERNS: Record<StreamingServiceId, RegExp> = {
	netflix: /^netflix\b/,
	prime: /^amazon prime video( with ads)?$/,
	hulu: /^hulu\b/,
	disney: /^disney(\+| plus)/,
	appletv: /^apple tv( plus|\+)?$/
};

export function serviceFromBaseUrl(baseUrl: string): StreamingServiceId | null {
	const id = baseUrl.startsWith(STREAMING_URL_PREFIX) ? baseUrl.slice(STREAMING_URL_PREFIX.length) : '';
	return STREAMING_SERVICES.some((s) => s.id === id) ? (id as StreamingServiceId) : null;
}

interface DiscoverResult {
	id: number;
	title?: string;
	name?: string;
	release_date?: string;
	first_air_date?: string;
	poster_path?: string | null;
}

interface DiscoverPage {
	page: number;
	total_pages: number;
	results: DiscoverResult[];
}

export interface StreamingDeps {
	token: string | undefined;
	region: string;
	fetch: typeof fetch;
}

type TmdbKind = 'movie' | 'tv';

export function createStreamingAdapter(
	source: SourceConfig,
	deps: StreamingDeps = { token: config.tmdbToken, region: config.streamingRegion, fetch: globalThis.fetch }
): SourceAdapter {
	const service = serviceFromBaseUrl(source.baseUrl);
	const providerCache = new Map<TmdbKind, Promise<number[]>>();

	async function tmdb<T>(path: string, params: Record<string, string> = {}): Promise<T> {
		if (!deps.token) throw new Error('Set TMDB_READ_TOKEN to import streaming catalogues.');
		const url = `${TMDB_API}${path}?${new URLSearchParams(params)}`;
		for (let attempt = 0; ; attempt++) {
			const res = await deps.fetch(url, {
				headers: { Authorization: `Bearer ${deps.token}`, Accept: 'application/json' },
				signal: AbortSignal.timeout(20_000)
			});
			if (res.status === 429 && attempt < 4) {
				const wait = Number(res.headers.get('retry-after')) || 1 + attempt;
				await new Promise((resolve) => setTimeout(resolve, wait * 1000));
				continue;
			}
			if (res.status === 401) throw new Error('TMDB rejected the read access token');
			if (!res.ok) throw new Error(`TMDB responded with HTTP ${res.status}`);
			return (await res.json()) as T;
		}
	}

	function providerIds(kind: TmdbKind): Promise<number[]> {
		let ids = providerCache.get(kind);
		if (!ids) {
			ids = tmdb<{ results?: { provider_id: number; provider_name: string }[] }>(`/watch/providers/${kind}`, {
				watch_region: deps.region
			}).then((body) => {
				const pattern = SERVICE_PATTERNS[service!];
				return (body.results ?? [])
					.filter((p) => pattern.test(p.provider_name.trim().toLowerCase()))
					.map((p) => p.provider_id);
			});
			providerCache.set(kind, ids);
		}
		return ids;
	}

	function discover(kind: TmdbKind, providers: number[], page: number, years?: [number, number]) {
		const params: Record<string, string> = {
			watch_region: deps.region,
			with_watch_providers: providers.join('|'),
			with_watch_monetization_types: 'flatrate|ads',
			include_adult: 'false',
			sort_by: 'popularity.desc',
			page: String(page)
		};
		if (years) {
			const field = kind === 'movie' ? 'primary_release_date' : 'first_air_date';
			params[`${field}.gte`] = `${years[0]}-01-01`;
			params[`${field}.lte`] = `${years[1]}-12-31`;
		}
		return tmdb<DiscoverPage>(`/discover/${kind}`, params);
	}

	/** Every result for a query. Queries over the page cap are split by release year until they fit. */
	async function* allResults(
		kind: TmdbKind,
		providers: number[],
		years?: [number, number]
	): AsyncGenerator<DiscoverResult> {
		const first = await discover(kind, providers, 1, years);
		if (first.total_pages > MAX_PAGES && (!years || years[0] < years[1])) {
			const [from, to] = years ?? [FIRST_YEAR, new Date().getUTCFullYear() + 1];
			const mid = Math.floor((from + to) / 2);
			yield* allResults(kind, providers, [from, mid]);
			yield* allResults(kind, providers, [mid + 1, to]);
			return;
		}
		yield* first.results;
		const last = Math.min(first.total_pages, MAX_PAGES);
		for (let start = 2; start <= last; start += CONCURRENCY) {
			const pages = [];
			for (let page = start; page < start + CONCURRENCY && page <= last; page++)
				pages.push(discover(kind, providers, page, years));
			for (const page of await Promise.all(pages)) yield* page.results;
		}
	}

	return {
		id: String(source.id),
		type: 'streaming',
		async testConnection() {
			if (!service) throw new Error('Unknown streaming service');
			if (!(await providerIds('movie')).length) throw new Error(`TMDB lists no providers for this service`);
			return true;
		},
		async listLibraries(): Promise<Library[]> {
			if (!service) throw new Error('Unknown streaming service');
			return [
				{ remoteId: 'movies', name: 'Movies', kind: 'movie' },
				{ remoteId: 'shows', name: 'TV Shows', kind: 'show' }
			];
		},
		async *fetchItems(library) {
			const kind: TmdbKind = library.kind === 'show' ? 'tv' : 'movie';
			const providers = await providerIds(kind);
			if (!providers.length) return;
			const seen = new Set<number>();
			for await (const result of allResults(kind, providers)) {
				const title = (kind === 'movie' ? result.title : result.name)?.trim();
				if (!title || seen.has(result.id)) continue;
				seen.add(result.id);
				const year = Number((kind === 'movie' ? result.release_date : result.first_air_date)?.slice(0, 4));
				const item: RawItem = {
					remoteId: String(result.id),
					title,
					year: year || null,
					kind: library.kind as MediaKind,
					externalIds: { tmdb: String(result.id) },
					posterRef: result.poster_path && TMDB_POSTER_PATH.test(result.poster_path) ? result.poster_path : null,
					addedAt: null,
					updatedAt: null
				};
				yield item;
			}
		},
		buildLink(item) {
			return service ? serviceSearchUrl(service, item.title) : '';
		},
		fetchPoster(posterRef) {
			return fetchTmdbPoster(posterRef, deps.fetch);
		}
	};
}
