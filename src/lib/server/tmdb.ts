/** Live TMDB lookups for pages: people search and title details. Nothing here is stored. */
import { TMDB_POSTER_PATH } from './adapters/streaming';
const TMDB_API = 'https://api.themoviedb.org/3';

async function tmdbGet<T>(
	path: string,
	params: Record<string, string>,
	token: string,
	fetchFn: typeof fetch
): Promise<T> {
	const res = await fetchFn(`${TMDB_API}${path}?${new URLSearchParams(params)}`, {
		headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
		signal: AbortSignal.timeout(10_000)
	});
	if (res.status === 401) throw new Error('TMDB rejected the read access token');
	if (!res.ok) throw new Error(`TMDB responded with HTTP ${res.status}`);
	return (await res.json()) as T;
}

export interface PersonCredits {
	name: string;
	movie: string[];
	show: string[];
}

interface Credit {
	id: number;
	media_type?: 'movie' | 'tv';
	job?: string;
}

/** The best-known person matching a name, with the TMDB IDs of everything they acted in or directed. */
export type PersonRole = 'actor' | 'director';

/** TMDB lists film directors as "Director" and the people who created a show as "Creator". */
const DIRECTING_JOBS = new Set(['Director', 'Creator']);
const DEPARTMENT: Record<PersonRole, readonly string[]> = {
	actor: ['Acting'],
	director: ['Directing', 'Writing', 'Creator']
};

/**
 * The best-known person matching a name in that role, with the TMDB IDs of everything they acted in (actor) or
 * directed or created (director). Among people with the same name, one known for the role is preferred.
 */
export async function findPersonCredits(
	query: string,
	token: string,
	role: PersonRole = 'actor',
	fetchFn: typeof fetch = globalThis.fetch
): Promise<PersonCredits | null> {
	const search = await tmdbGet<{ results?: { id: number; name: string; known_for_department?: string }[] }>(
		'/search/person',
		{ query, include_adult: 'false' },
		token,
		fetchFn
	);
	const results = search.results ?? [];
	const person =
		results.find((p) => p.known_for_department && DEPARTMENT[role].includes(p.known_for_department)) ?? results[0];
	if (!person) return null;
	const credits = await tmdbGet<{ cast?: Credit[]; crew?: Credit[] }>(
		`/person/${person.id}/combined_credits`,
		{},
		token,
		fetchFn
	);
	const all =
		role === 'actor' ? (credits.cast ?? []) : (credits.crew ?? []).filter((c) => c.job && DIRECTING_JOBS.has(c.job));
	const ids = (type: 'movie' | 'tv') => [...new Set(all.filter((c) => c.media_type === type).map((c) => String(c.id)))];
	return { name: person.name, movie: ids('movie'), show: ids('tv') };
}

export interface CastMember {
	name: string;
	character: string | null;
	/** TMDB image path, served through /posters/tmdb. */
	photo: string | null;
}

export interface TitleInfo {
	overview: string | null;
	runtime: number | null;
	cast: CastMember[];
	directors: string[];
}

const CAST_SIZE = 12;

/** Summary, runtime, top-billed cast and directors (or creators, for shows). */
export async function fetchTitleInfo(
	kind: 'movie' | 'tv',
	tmdbId: string,
	token: string,
	fetchFn: typeof fetch = globalThis.fetch
): Promise<TitleInfo> {
	const body = await tmdbGet<{
		overview?: string;
		runtime?: number;
		episode_run_time?: number[];
		created_by?: { name: string }[];
		credits?: {
			cast?: { name: string; order?: number; character?: string; profile_path?: string | null }[];
			crew?: { name: string; job?: string }[];
		};
	}>(`/${kind}/${encodeURIComponent(tmdbId)}`, { append_to_response: 'credits' }, token, fetchFn);
	const cast = [...(body.credits?.cast ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
	const directors =
		kind === 'tv'
			? (body.created_by ?? []).map((c) => c.name)
			: (body.credits?.crew ?? []).filter((c) => c.job === 'Director').map((c) => c.name);
	return {
		overview: body.overview?.trim() || null,
		runtime: body.runtime || body.episode_run_time?.[0] || null,
		cast: cast
			.filter((c, i) => cast.findIndex((other) => other.name === c.name) === i)
			.slice(0, CAST_SIZE)
			.map((c) => ({
				name: c.name,
				character: c.character?.trim() || null,
				photo: c.profile_path && TMDB_POSTER_PATH.test(c.profile_path) ? c.profile_path : null
			})),
		directors: [...new Set(directors)]
	};
}

export interface TitleCandidate {
	tmdbId: string;
	kind: 'movie' | 'show';
	title: string;
	year: number | null;
	/** TMDB image path, served through /posters/tmdb. */
	poster: string | null;
}

interface MultiResult {
	id: number;
	media_type?: string;
	title?: string;
	name?: string;
	release_date?: string;
	first_air_date?: string;
	poster_path?: string | null;
	popularity?: number;
}

const CANDIDATES = 6;

/** Movies and shows matching a title, closest year and the expected kind first, then TMDB's own order. */
export async function searchTitles(
	query: string,
	options: { year?: number | null; kind?: 'movie' | 'show' },
	token: string,
	fetchFn: typeof fetch = globalThis.fetch
): Promise<TitleCandidate[]> {
	const body = await tmdbGet<{ results?: MultiResult[] }>(
		'/search/multi',
		{ query, include_adult: 'false' },
		token,
		fetchFn
	);
	const candidates = (body.results ?? []).flatMap((r): TitleCandidate[] => {
		if (r.media_type !== 'movie' && r.media_type !== 'tv') return [];
		const title = (r.media_type === 'movie' ? r.title : r.name)?.trim();
		if (!title) return [];
		const year = Number((r.release_date ?? r.first_air_date ?? '').slice(0, 4)) || null;
		const poster = r.poster_path && TMDB_POSTER_PATH.test(r.poster_path) ? r.poster_path : null;
		return [{ tmdbId: String(r.id), kind: r.media_type === 'movie' ? 'movie' : 'show', title, year, poster }];
	});
	const score = (c: TitleCandidate) =>
		(options.year && c.year ? Math.min(Math.abs(c.year - options.year), 5) : 5) +
		(options.kind && c.kind !== options.kind ? 3 : 0);
	return candidates
		.map((c, i) => ({ c, i }))
		.sort((a, b) => score(a.c) - score(b.c) || a.i - b.i)
		.slice(0, CANDIDATES)
		.map(({ c }) => c);
}
