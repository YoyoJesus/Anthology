import { error } from '@sveltejs/kit';
import { getDb } from '#lib/server/db.ts';
import { availabilityLink } from '#lib/server/streaming.ts';
import { getWork } from '#lib/server/works.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const db = await getDb();
	const work = await getWork(db, Number(params.id));
	if (!work) error(404, 'Title not found');
	return { work, watchLink: work.streaming.length ? await availabilityLink(db, work.id) : null };
};
