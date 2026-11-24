/** Live TMDB lookups for pages: people search and title details. Nothing here is stored. */
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
export async function findPersonCredits(
	query: string,
	token: string,
	fetchFn: typeof fetch = globalThis.fetch
): Promise<PersonCredits | null> {
	const search = await tmdbGet<{ results?: { id: number; name: string }[] }>(
		'/search/person',
		{ query, include_adult: 'false' },
		token,
		fetchFn
	);
	const person = search.results?.[0];
	if (!person) return null;
	const credits = await tmdbGet<{ cast?: Credit[]; crew?: Credit[] }>(
		`/person/${person.id}/combined_credits`,
		{},
		token,
		fetchFn
	);
	const all = [...(credits.cast ?? []), ...(credits.crew ?? []).filter((c) => c.job === 'Director')];
	const ids = (type: 'movie' | 'tv') => [...new Set(all.filter((c) => c.media_type === type).map((c) => String(c.id)))];
	return { name: person.name, movie: ids('movie'), show: ids('tv') };
}

export interface TitleInfo {
	overview: string | null;
	runtime: number | null;
	cast: string[];
	directors: string[];
}

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
		credits?: { cast?: { name: string; order?: number }[]; crew?: { name: string; job?: string }[] };
	}>(`/${kind}/${encodeURIComponent(tmdbId)}`, { append_to_response: 'credits' }, token, fetchFn);
	const cast = [...(body.credits?.cast ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
	const directors =
		kind === 'tv'
			? (body.created_by ?? []).map((c) => c.name)
			: (body.credits?.crew ?? []).filter((c) => c.job === 'Director').map((c) => c.name);
	return {
		overview: body.overview?.trim() || null,
		runtime: body.runtime || body.episode_run_time?.[0] || null,
		cast: [...new Set(cast.slice(0, 10).map((c) => c.name))],
		directors: [...new Set(directors)]
	};
}
