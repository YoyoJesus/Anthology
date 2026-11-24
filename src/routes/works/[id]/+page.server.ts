import { error } from '@sveltejs/kit';
import { config } from '#lib/server/config.ts';
import { getDb } from '#lib/server/db.ts';
import { availabilityLink } from '#lib/server/streaming.ts';
import { fetchTitleInfo, type TitleInfo } from '#lib/server/tmdb.ts';
import { getWork } from '#lib/server/works.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const db = await getDb();
	const work = await getWork(db, Number(params.id));
	if (!work) error(404, 'Title not found');
	const tmdbId = work.tmdbId;
	const info: TitleInfo | null =
		tmdbId && config.tmdbToken && (work.kind === 'movie' || work.kind === 'show')
			? await fetchTitleInfo(work.kind === 'show' ? 'tv' : 'movie', tmdbId, config.tmdbToken).catch(() => null)
			: null;
	return { work, info, watchLink: work.streaming.length ? await availabilityLink(db, work.id) : null };
};
