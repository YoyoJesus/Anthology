import { error } from '@sveltejs/kit';
import { createAdapter } from '#lib/server/adapters/index.ts';
import { getDb } from '#lib/server/db.ts';
import { loadPoster } from '#lib/server/posters.ts';
import { getSourceConfig } from '#lib/server/sources.ts';
import { getPosterRef } from '#lib/server/works.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const itemId = Number(params.itemId);
	if (!Number.isInteger(itemId)) error(404);
	const db = await getDb();
	const ref = await getPosterRef(db, itemId);
	const source = ref && (await getSourceConfig(db, ref.sourceId));
	if (!ref || !source) error(404);

	let poster: Awaited<ReturnType<typeof loadPoster>>;
	try {
		poster = await loadPoster(createAdapter(source), ref.posterRef);
	} catch {
		error(404);
	}
	return new Response(poster.body, {
		headers: {
			'Content-Type': poster.contentType,
			'Cache-Control': 'private, max-age=604800',
			'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox"
		}
	});
};
