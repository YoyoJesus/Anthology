import { getDb } from '#lib/server/db.ts';
import { listSources } from '#lib/server/sources.ts';
import { browseWorks } from '#lib/server/works.ts';
import type { MediaKind } from '#lib/types.ts';
import type { PageServerLoad } from './$types';

const PAGE_SIZE = 60;
const BROWSABLE: MediaKind[] = ['movie', 'show'];

export const load: PageServerLoad = ({ url }) => {
	const db = getDb();
	const q = url.searchParams.get('q')?.trim() ?? '';
	const kindParam = url.searchParams.get('kind') as MediaKind | null;
	const kind = kindParam && BROWSABLE.includes(kindParam) ? kindParam : undefined;
	const sourceId = Number(url.searchParams.get('source')) || undefined;
	const page = Math.max(1, Math.floor(Number(url.searchParams.get('page'))) || 1);

	const { works, total } = browseWorks(db, { q, kind, sourceId, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
	return {
		works,
		total,
		page,
		pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
		filters: { q, kind: kind ?? '', source: sourceId ?? '' },
		sources: listSources(db).map((s) => ({ id: s.id, name: s.name, itemCount: s.itemCount }))
	};
};
