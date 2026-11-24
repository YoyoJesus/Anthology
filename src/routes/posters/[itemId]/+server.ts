import fs from 'node:fs';
import { error } from '@sveltejs/kit';
import { createAdapter } from '#lib/server/adapters/index.ts';
import { getDb } from '#lib/server/db.ts';
import { PosterCache } from '#lib/server/posters.ts';
import { getSourceConfig } from '#lib/server/sources.ts';
import { getPosterRef } from '#lib/server/works.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const itemId = Number(params.itemId);
	if (!Number.isInteger(itemId)) error(404);
	const db = getDb();
	const cache = new PosterCache(db);

	let poster = cache.get(itemId);
	if (!poster) {
		const ref = getPosterRef(db, itemId);
		const source = ref && getSourceConfig(db, ref.sourceId);
		if (!ref || !source) error(404);
		try {
			poster = await cache.fetch(itemId, ref.posterRef, createAdapter(source));
		} catch {
			error(404);
		}
	}

	return new Response(fs.readFileSync(poster.file), {
		headers: {
			'Content-Type': poster.contentType,
			'Cache-Control': 'private, max-age=86400',
			'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox"
		}
	});
};
