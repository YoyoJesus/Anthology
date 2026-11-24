import { error } from '@sveltejs/kit';
import { getDb } from '#lib/server/db.ts';
import { getWork } from '#lib/server/works.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const work = getWork(getDb(), Number(params.id));
	if (!work) error(404, 'Title not found');
	return { work };
};
