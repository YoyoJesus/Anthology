import { fail } from '@sveltejs/kit';
import { createAdapter, supportedSourceTypes } from '#lib/server/adapters/index.ts';
import { config } from '#lib/server/config.ts';
import { getDb } from '#lib/server/db.ts';
import { isRefreshingAvailability, isSyncing, runAvailabilityRefresh, runSync } from '#lib/server/jobs.ts';
import { PosterCache } from '#lib/server/posters.ts';
import { createSource, deleteSource, getSourceConfig, listSources, setSourceEnabled } from '#lib/server/sources.ts';
import { getEnabledServices, setEnabledServices } from '#lib/server/streaming.ts';
import { parseSourceForm } from '#lib/server/validation.ts';
import { STREAMING_SERVICES, type StreamingServiceId } from '#lib/types.ts';
import type { Actions, PageServerLoad } from './$types';

function types() {
	return supportedSourceTypes(config.enableMockSources);
}

function message(err: unknown): string {
	return err instanceof Error ? err.message : 'Something went wrong';
}

async function sourceIdFrom(request: Request): Promise<number> {
	return Number((await request.formData()).get('id'));
}

export const load: PageServerLoad = () => {
	const db = getDb();
	const checked = db
		.prepare('SELECT COUNT(*) AS n FROM availability_checks WHERE region = ?')
		.get(config.streamingRegion) as {
		n: number;
	};
	return {
		sources: listSources(db).map((source) => ({ ...source, syncing: isSyncing(source.id) })),
		types: types(),
		streaming: {
			enabled: getEnabledServices(db),
			region: config.streamingRegion,
			configured: Boolean(config.tmdbToken),
			refreshing: isRefreshingAvailability(),
			checked: checked.n
		}
	};
};

export const actions: Actions = {
	testNew: async ({ request }) => {
		const parsed = parseSourceForm(await request.formData(), types());
		if (!parsed.ok) return fail(400, { add: { error: parsed.error } });
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
		const id = createSource(getDb(), parsed.value);
		return { add: { created: id } };
	},
	test: async ({ request }) => {
		const id = await sourceIdFrom(request);
		const source = getSourceConfig(getDb(), id);
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
		setSourceEnabled(getDb(), Number(data.get('id')), data.get('enabled') === 'true');
	},
	saveStreaming: async ({ request }) => {
		const known = STREAMING_SERVICES.map((service) => service.id) as string[];
		const chosen = (await request.formData()).getAll('service').map(String);
		setEnabledServices(
			getDb(),
			chosen.filter((id): id is StreamingServiceId => known.includes(id))
		);
		return { streaming: { notice: 'Saved.' } };
	},
	refreshStreaming: async () => {
		const result = await runAvailabilityRefresh();
		if (!result) return fail(400, { streaming: { error: 'Set TMDB_READ_TOKEN to look up streaming availability.' } });
		if (result.error) return fail(400, { streaming: { error: result.error } });
		const failed = result.failed ? ` ${result.failed} lookups failed.` : '';
		return {
			streaming: { notice: `Checked ${result.checked} ${result.checked === 1 ? 'title' : 'titles'}.${failed}` }
		};
	},
	remove: async ({ request }) => {
		const db = getDb();
		deleteSource(db, await sourceIdFrom(request));
		new PosterCache(db).pruneOrphans();
	}
};
