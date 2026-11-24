import { fail } from '@sveltejs/kit';
import { createAdapter, supportedSourceTypes } from '#lib/server/adapters/index.ts';
import { parseCollection } from '#lib/server/adapters/collection.ts';
import { config } from '#lib/server/config.ts';
import { get, getDb } from '#lib/server/db.ts';
import { isRefreshingAvailability, isSyncing, runAvailabilityRefresh, runSync } from '#lib/server/jobs.ts';
import {
	createSource,
	deleteSource,
	getCollection,
	getSourceConfig,
	listSources,
	setCollection,
	setSourceEnabled
} from '#lib/server/sources.ts';
import { getEnabledServices, setEnabledServices } from '#lib/server/streaming.ts';
import { parseCollectionText, parseSourceForm } from '#lib/server/validation.ts';
import { STREAMING_SERVICES, type StreamingServiceId } from '#lib/types.ts';
import type { Actions, PageServerLoad } from './$types';

/** Leave room under the function time limit to send the response. */
const REFRESH_BUDGET_MS = 40_000;

function types() {
	return supportedSourceTypes(config.enableMockSources);
}

function message(err: unknown): string {
	return err instanceof Error ? err.message : 'Something went wrong';
}

async function sourceIdFrom(request: Request): Promise<number> {
	return Number((await request.formData()).get('id'));
}

export const load: PageServerLoad = async () => {
	const db = await getDb();
	const [sources, syncing, enabled, refreshing, checked] = await Promise.all([
		listSources(db),
		isSyncing(),
		getEnabledServices(db),
		isRefreshingAvailability(),
		get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM availability_checks WHERE region = ?', [config.streamingRegion])
	]);
	return {
		sources: await Promise.all(
			sources.map(async (source) => ({
				...source,
				syncing,
				collection: source.type === 'collection' ? await getCollection(db, source.id) : null
			}))
		),
		types: types(),
		streaming: {
			enabled,
			region: config.streamingRegion,
			configured: Boolean(config.tmdbToken),
			refreshing,
			checked: Number(checked?.n ?? 0)
		}
	};
};

export const actions: Actions = {
	testNew: async ({ request }) => {
		const parsed = parseSourceForm(await request.formData(), types());
		if (!parsed.ok) return fail(400, { add: { error: parsed.error } });
		if (parsed.value.type === 'collection') {
			const { entries, skipped } = parseCollection(parsed.value.collection ?? '');
			const skippedNote = skipped.length
				? ` Skipped line ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? '…' : ''}.`
				: '';
			return { add: { notice: `Read ${entries.length} ${entries.length === 1 ? 'title' : 'titles'}.${skippedNote}` } };
		}
		try {
			await createAdapter({ id: 0, ...parsed.value }).testConnection();
			return { add: { tested: true, name: parsed.value.name } };
		} catch (err) {
			return fail(400, { add: { error: `Could not connect: ${message(err)}` } });
		}
	},
	add: async ({ request }) => {
		const parsed = parseSourceForm(await request.formData(), types());
		if (!parsed.ok) return fail(400, { add: { error: parsed.error } });
		const id = await createSource(await getDb(), parsed.value);
		if (parsed.value.type === 'collection') {
			const result = await runSync(id).catch(() => null);
			if (result)
				return { add: { created: id, notice: `Added ${result.items} ${result.items === 1 ? 'title' : 'titles'}.` } };
		}
		return { add: { created: id } };
	},
	test: async ({ request }) => {
		const id = await sourceIdFrom(request);
		const source = await getSourceConfig(await getDb(), id);
		if (!source) return fail(404, { row: { id, error: 'Source not found' } });
		try {
			await createAdapter(source).testConnection();
			return { row: { id, notice: 'Connection works.' } };
		} catch (err) {
			return fail(400, { row: { id, error: message(err) } });
		}
	},
	sync: async ({ request }) => {
		const id = await sourceIdFrom(request);
		try {
			const result = await runSync(id);
			return {
				row: {
					id,
					notice: `Synced ${result.items} ${result.items === 1 ? 'item' : 'items'} from ${result.libraries} libraries.`
				}
			};
		} catch (err) {
			return fail(400, { row: { id, error: message(err) } });
		}
	},
	toggle: async ({ request }) => {
		const data = await request.formData();
		await setSourceEnabled(await getDb(), Number(data.get('id')), data.get('enabled') === 'true');
	},
	updateCollection: async ({ request }) => {
		const data = await request.formData();
		const id = Number(data.get('id'));
		const db = await getDb();
		if ((await getSourceConfig(db, id))?.type !== 'collection')
			return fail(404, { row: { id, error: 'Collection not found' } });
		const parsed = parseCollectionText(data.get('collection'));
		if (!parsed.ok) return fail(400, { row: { id, error: parsed.error } });
		await setCollection(db, id, parsed.value);
		try {
			const result = await runSync(id);
			return {
				row: { id, notice: `Saved. ${result.items} ${result.items === 1 ? 'title' : 'titles'} in this collection.` }
			};
		} catch (err) {
			return fail(400, { row: { id, error: message(err) } });
		}
	},
	saveStreaming: async ({ request }) => {
		const known = STREAMING_SERVICES.map((service) => service.id) as string[];
		const chosen = (await request.formData()).getAll('service').map(String);
		await setEnabledServices(
			await getDb(),
			chosen.filter((id): id is StreamingServiceId => known.includes(id))
		);
		return { streaming: { notice: 'Saved.' } };
	},
	refreshStreaming: async () => {
		if (!config.tmdbToken)
			return fail(400, { streaming: { error: 'Set TMDB_READ_TOKEN to look up streaming availability.' } });
		const result = await runAvailabilityRefresh(Date.now() + REFRESH_BUDGET_MS);
		if (!result) return fail(409, { streaming: { error: 'A check is already running. Try again shortly.' } });
		if (result.error) return fail(400, { streaming: { error: result.error } });
		const failed = result.failed ? ` ${result.failed} lookups failed.` : '';
		const skipped = result.skipped ? ` ${result.skipped} not found on TMDB.` : '';
		const remaining = result.remaining ? ` ${result.remaining} left for the next run.` : '';
		return {
			streaming: {
				notice: `Checked ${result.checked} ${result.checked === 1 ? 'title' : 'titles'}.${skipped}${failed}${remaining}`
			}
		};
	},
	remove: async ({ request }) => {
		await deleteSource(await getDb(), await sourceIdFrom(request));
	}
};
