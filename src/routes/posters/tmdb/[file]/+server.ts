import { error } from '@sveltejs/kit';
import { fetchTmdbPoster } from '#lib/server/adapters/streaming.ts';
import { loadPoster } from '#lib/server/posters.ts';
import type { RequestHandler } from './$types';

/** TMDB artwork for titles without their own, proxied so the browser only talks to this app. */
export const GET: RequestHandler = async ({ params }) => {
	let poster: Awaited<ReturnType<typeof loadPoster>>;
	try {
		poster = await loadPoster({ fetchPoster: (path) => fetchTmdbPoster(path) }, `/${params.file}`);
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
