import { config } from '#lib/server/config.ts';
import { getDb } from '#lib/server/db.ts';
import { listSources } from '#lib/server/sources.ts';
import { findPersonCredits, type PersonCredits } from '#lib/server/tmdb.ts';
import { BROWSE_SORTS, browseWorks, type BrowseSort } from '#lib/server/works.ts';
import { getEnabledServices } from '#lib/server/streaming.ts';
import { GENRES, isGenreId } from '#lib/genres.ts';
import { STREAMING_SERVICES, type MediaKind, type StreamingServiceId } from '#lib/types.ts';
import type { PageServerLoad } from './$types';

const PAGE_SIZE = 60;
const BROWSABLE: MediaKind[] = ['movie', 'show'];
const RATINGS = [6, 7, 8];

export const load: PageServerLoad = async ({ url }) => {
	const db = await getDb();
	const params = url.searchParams;
	const q = params.get('q')?.trim() ?? '';
	const byPerson = params.get('by') === 'person' && q !== '';
	const kindParam = params.get('kind') as MediaKind | null;
	const kind = kindParam && BROWSABLE.includes(kindParam) ? kindParam : undefined;
	const sourceId = Number(params.get('source')) || undefined;
	const enabled = await getEnabledServices(db);
	const streamingParam = params.get('streaming') ?? '';
	const streaming =
		streamingParam === 'any' || enabled.includes(streamingParam as StreamingServiceId)
			? (streamingParam as StreamingServiceId | 'any')
			: undefined;
	const genreParam = params.get('genre') ?? '';
	const genre = isGenreId(genreParam) ? genreParam : undefined;
	const minRating = RATINGS.includes(Number(params.get('rating'))) ? Number(params.get('rating')) : undefined;
	const sortParam = params.get('sort') as BrowseSort | null;
	const sort = sortParam && BROWSE_SORTS.includes(sortParam) ? sortParam : 'rating';
	const page = Math.max(1, Math.floor(Number(params.get('page'))) || 1);

	let person: PersonCredits | null = null;
	let personError: string | null = null;
	if (byPerson) {
		if (!config.tmdbToken) personError = 'Set TMDB_READ_TOKEN to search by actor.';
		else
			person = await findPersonCredits(q, config.tmdbToken).catch(() => {
				personError = 'TMDB could not be reached. Try again shortly.';
				return null;
			});
	}

	const { works, total } =
		byPerson && !person
			? { works: [], total: 0 }
			: await browseWorks(db, {
					q: byPerson ? undefined : q,
					tmdbIds: person ? { movie: person.movie, show: person.show } : undefined,
					kind,
					sourceId,
					streaming,
					genre,
					minRating,
					sort,
					limit: PAGE_SIZE,
					offset: (page - 1) * PAGE_SIZE
				});
	return {
		works,
		total,
		page,
		pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
		person: person?.name ?? null,
		personError,
		filters: {
			q,
			by: byPerson ? 'person' : '',
			kind: kind ?? '',
			source: sourceId ?? '',
			streaming: streaming ?? '',
			genre: genre ?? '',
			rating: minRating ?? '',
			sort: sort === 'rating' ? '' : sort
		},
		genres: GENRES.map(({ id, name }) => ({ id, name })),
		ratings: RATINGS,
		streamingServices: STREAMING_SERVICES.filter((service) => enabled.includes(service.id)),
		sources: (await listSources(db)).map((s) => ({ id: s.id, name: s.name, itemCount: s.itemCount }))
	};
};
