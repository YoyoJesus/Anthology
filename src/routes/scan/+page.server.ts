import { fail } from '@sveltejs/kit';
import { addToCollection, parseCollection } from '#lib/server/adapters/collection.ts';
import { cleanProductTitle, lookUpBarcode, normalizeBarcode, type DiscFormat } from '#lib/server/barcode.ts';
import { config } from '#lib/server/config.ts';
import { getDb } from '#lib/server/db.ts';
import { runAvailabilityRefresh, runSync } from '#lib/server/jobs.ts';
import { createSource, getCollection, getSourceConfig, listSources, setCollection } from '#lib/server/sources.ts';
import { searchTitles, type TitleCandidate } from '#lib/server/tmdb.ts';
import type { Actions, PageServerLoad } from './$types';

/** Short, so adding a disc stays quick. Anything not reached is picked up by the scheduled refresh. */
const POSTER_LOOKUP_MS = 5_000;
const MAX_QUERY_LENGTH = 200;

function message(err: unknown): string {
	return err instanceof Error ? err.message : 'Something went wrong';
}

/** Without a TMDB token, the title is offered as read, so it can still be added. */
async function candidatesFor(
	title: string,
	year: number | null,
	kind: 'movie' | 'show' | undefined
): Promise<TitleCandidate[]> {
	if (!config.tmdbToken) return [{ tmdbId: '', kind: kind ?? 'movie', title, year, poster: null }];
	return searchTitles(title, { year, kind }, config.tmdbToken);
}

export const load: PageServerLoad = async () => {
	const sources = await listSources(await getDb());
	return {
		collections: sources
			.filter((s) => s.type === 'collection')
			.map((s) => ({ id: s.id, name: s.name, itemCount: s.itemCount })),
		tmdbConfigured: Boolean(config.tmdbToken)
	};
};

export const actions: Actions = {
	lookup: async ({ request }) => {
		const raw = String((await request.formData()).get('barcode') ?? '');
		const barcode = normalizeBarcode(raw);
		if (!barcode) return fail(400, { lookup: { error: 'That is not a valid UPC or EAN barcode.', query: '' } });
		let product: string | null;
		try {
			product = await lookUpBarcode(barcode);
		} catch (err) {
			return fail(502, { lookup: { error: message(err), query: '' } });
		}
		if (!product)
			return fail(404, { lookup: { error: `No product found for ${barcode}. Search by title instead.`, query: '' } });
		const cleaned = cleanProductTitle(product);
		if (!cleaned) return fail(404, { lookup: { error: `Could not read a title from "${product}".`, query: product } });
		try {
			const candidates = await candidatesFor(cleaned.title, cleaned.year, cleaned.kind);
			return { lookup: { barcode, product, format: cleaned.format, query: cleaned.title, candidates } };
		} catch (err) {
			return fail(502, { lookup: { error: message(err), query: cleaned.title } });
		}
	},
	search: async ({ request }) => {
		const query = String((await request.formData()).get('q') ?? '')
			.trim()
			.slice(0, MAX_QUERY_LENGTH);
		const entry = parseCollection(query).entries[0];
		if (!entry) return fail(400, { lookup: { error: 'Enter a title to search for.', query } });
		try {
			const candidates = await candidatesFor(entry.title, entry.year, entry.kind === 'show' ? 'show' : undefined);
			if (!candidates.length) return fail(404, { lookup: { error: `Nothing on TMDB matches "${query}".`, query } });
			return { lookup: { query, candidates, barcode: null, product: null, format: null as DiscFormat | null } };
		} catch (err) {
			return fail(502, { lookup: { error: message(err), query } });
		}
	},
	add: async ({ request }) => {
		const data = await request.formData();
		const id = Number(data.get('collection'));
		const title = String(data.get('title') ?? '').trim();
		const year = Number(data.get('year')) || null;
		const kind = data.get('kind') === 'show' ? 'show' : 'movie';
		const db = await getDb();
		if ((await getSourceConfig(db, id))?.type !== 'collection')
			return fail(404, { add: { error: 'Choose a collection to add to.' } });

		const result = addToCollection(await getCollection(db, id), { title, year, kind });
		const label = year ? `${title} (${year})` : title;
		if (result.status !== 'added') {
			if (result.status === 'duplicate') return { added: { label, notice: 'Already in this collection.' } };
			if (result.status === 'full') return fail(400, { add: { error: 'This collection is full. Start another one.' } });
			return fail(400, { add: { error: `"${title}" cannot be added as a title.` } });
		}

		await setCollection(db, id, result.body);
		try {
			await runSync(id);
		} catch {
			return { added: { label, notice: 'Saved. It shows in the library after the next sync.' } };
		}
		await runAvailabilityRefresh(Date.now() + POSTER_LOOKUP_MS).catch(() => null);
		return { added: { label, notice: 'Added.' } };
	},
	createCollection: async ({ request }) => {
		const name = String((await request.formData()).get('name') ?? '').trim() || 'Discs';
		const id = await createSource(await getDb(), {
			type: 'collection',
			name: name.slice(0, 100),
			baseUrl: 'collection://local',
			token: '',
			collection: ''
		});
		return { created: id };
	}
};
