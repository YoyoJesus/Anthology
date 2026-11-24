import { getDb } from '#lib/server/db.ts';
import { listSources } from '#lib/server/sources.ts';
import { browseWorks } from '#lib/server/works.ts';
import { getEnabledServices } from '#lib/server/streaming.ts';
import { STREAMING_SERVICES, type MediaKind, type StreamingServiceId } from '#lib/types.ts';
import type { PageServerLoad } from './$types';

const PAGE_SIZE = 60;
const BROWSABLE: MediaKind[] = ['movie', 'show'];

export const load: PageServerLoad = async ({ url }) => {
	const db = await getDb();
	const q = url.searchParams.get('q')?.trim() ?? '';
	const kindParam = url.searchParams.get('kind') as MediaKind | null;
	const kind = kindParam && BROWSABLE.includes(kindParam) ? kindParam : undefined;
	const sourceId = Number(url.searchParams.get('source')) || undefined;
	const enabled = await getEnabledServices(db);
	const streamingParam = url.searchParams.get('streaming') ?? '';
	const streaming =
		streamingParam === 'any' || enabled.includes(streamingParam as StreamingServiceId)
			? (streamingParam as StreamingServiceId | 'any')
			: undefined;
	const page = Math.max(1, Math.floor(Number(url.searchParams.get('page'))) || 1);

	const { works, total } = await browseWorks(db, {
		q,
		kind,
		sourceId,
		streaming,
		limit: PAGE_SIZE,
		offset: (page - 1) * PAGE_SIZE
	});
	return {
		works,
		total,
		page,
		pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
		filters: { q, kind: kind ?? '', source: sourceId ?? '', streaming: streaming ?? '' },
		streamingServices: STREAMING_SERVICES.filter((service) => enabled.includes(service.id)),
		sources: (await listSources(db)).map((s) => ({ id: s.id, name: s.name, itemCount: s.itemCount }))
	};
};
