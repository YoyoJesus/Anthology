import { describe, expect, it, vi } from 'vitest';
import { createStreamingAdapter } from '../src/lib/server/adapters/streaming';
import type { RawItem, SourceConfig } from '../src/lib/server/adapters/types';
import { all } from '../src/lib/server/db';
import { getSourceConfig, listSources, syncStreamingSources } from '../src/lib/server/sources';
import { refreshAvailability, setEnabledServices } from '../src/lib/server/streaming';
import { syncSource } from '../src/lib/server/sync';
import { browseWorks, getWork } from '../src/lib/server/works';
import { addMockSource, memoryDb, testKey } from './helpers';

const PROVIDERS = [
	{ provider_id: 8, provider_name: 'Netflix' },
	{ provider_id: 1796, provider_name: 'Netflix Standard with Ads' },
	{ provider_id: 9, provider_name: 'Amazon Prime Video' },
	{ provider_id: 2100, provider_name: 'Amazon Prime Video with Ads' },
	{ provider_id: 613, provider_name: 'Amazon Prime Video Free with Ads' },
	{ provider_id: 10, provider_name: 'Amazon Video' },
	{ provider_id: 582, provider_name: 'Paramount+ Amazon Channel' },
	{ provider_id: 2, provider_name: 'Apple TV Store' }
];

interface FakeTitle {
	id: number;
	title: string;
	year: number;
}

/** A fake TMDB with 20 results per page, honouring the year filters and the 500 page cap. */
function fakeTmdb(movies: FakeTitle[], shows: FakeTitle[] = []) {
	const calls: URL[] = [];
	const fetchFn = vi.fn(async (input: string | URL | Request) => {
		const url = new URL(String(input));
		calls.push(url);
		if (url.pathname.endsWith('/watch/providers/movie') || url.pathname.endsWith('/watch/providers/tv'))
			return Response.json({ results: PROVIDERS });
		const tv = url.pathname.endsWith('/discover/tv');
		const field = tv ? 'first_air_date' : 'primary_release_date';
		const from = Number(url.searchParams.get(`${field}.gte`)?.slice(0, 4) ?? 0);
		const to = Number(url.searchParams.get(`${field}.lte`)?.slice(0, 4) ?? 9999);
		const matches = (tv ? shows : movies).filter((t) => t.year >= from && t.year <= to);
		const page = Number(url.searchParams.get('page'));
		const results = matches
			.slice((page - 1) * 20, page * 20)
			.map((t) =>
				tv
					? { id: t.id, name: t.title, first_air_date: `${t.year}-05-01`, poster_path: `/p${t.id}.jpg` }
					: { id: t.id, title: t.title, release_date: `${t.year}-05-01`, poster_path: `/p${t.id}.jpg` }
			);
		return Response.json({ page, total_pages: Math.ceil(matches.length / 20), results });
	});
	return { fetchFn, calls };
}

const source = (service: string): SourceConfig => ({
	id: 1,
	type: 'streaming',
	name: service,
	baseUrl: `streaming://${service}`,
	token: ''
});

async function collect(items: AsyncIterable<RawItem>): Promise<RawItem[]> {
	const out: RawItem[] = [];
	for await (const item of items) out.push(item);
	return out;
}

describe('streaming catalogue adapter', () => {
	it('asks for every plan of the service and reads all pages', async () => {
		const movies = Array.from({ length: 45 }, (_, i) => ({ id: 1000 + i, title: `Synthetic Film ${i}`, year: 2020 }));
		const { fetchFn, calls } = fakeTmdb(movies);
		const adapter = createStreamingAdapter(source('netflix'), { token: 't', region: 'US', fetch: fetchFn });
		const [moviesLib] = await adapter.listLibraries();
		const items = await collect(adapter.fetchItems(moviesLib));
		expect(items).toHaveLength(45);
		expect(items[0]).toMatchObject({ remoteId: '1000', title: 'Synthetic Film 0', year: 2020, kind: 'movie' });
		expect(items[0].externalIds).toEqual({ tmdb: '1000' });
		const discover = calls.filter((u) => u.pathname.endsWith('/discover/movie'));
		expect(discover).toHaveLength(3);
		expect(discover[0].searchParams.get('with_watch_providers')).toBe('8|1796');
		expect(discover[0].searchParams.get('with_watch_monetization_types')).toBe('flatrate|ads');
		expect(adapter.buildLink(items[0])).toBe('https://www.netflix.com/search?q=Synthetic%20Film%200');
	});

	it('counts only what Prime includes, not the store, add-on channels or the free tier', async () => {
		const { fetchFn, calls } = fakeTmdb([{ id: 1, title: 'Synthetic Prime Film', year: 2020 }]);
		const adapter = createStreamingAdapter(source('prime'), { token: 't', region: 'US', fetch: fetchFn });
		const [moviesLib] = await adapter.listLibraries();
		await collect(adapter.fetchItems(moviesLib));
		const discover = calls.find((u) => u.pathname.endsWith('/discover/movie'))!;
		expect(discover.searchParams.get('with_watch_providers')).toBe('9|2100');
	});

	it('splits a catalogue over the page cap by release year', async () => {
		const movies = Array.from({ length: 10_020 }, (_, i) => ({
			id: i + 1,
			title: `Synthetic ${i}`,
			year: i < 6000 ? 1999 : 2015
		}));
		const { fetchFn } = fakeTmdb(movies);
		const adapter = createStreamingAdapter(source('netflix'), { token: 't', region: 'US', fetch: fetchFn });
		const [moviesLib] = await adapter.listLibraries();
		expect(await collect(adapter.fetchItems(moviesLib))).toHaveLength(10_020);
	});

	it('fails clearly without a TMDB token', async () => {
		const adapter = createStreamingAdapter(source('netflix'), { token: undefined, region: 'US', fetch: vi.fn() });
		const [moviesLib] = await adapter.listLibraries();
		await expect(collect(adapter.fetchItems(moviesLib))).rejects.toThrow('TMDB_READ_TOKEN');
	});

	it('only proxies TMDB poster paths', async () => {
		const adapter = createStreamingAdapter(source('netflix'), {
			token: 't',
			region: 'US',
			fetch: vi.fn(async () => new Response('x'))
		});
		await expect(adapter.fetchPoster('https://elsewhere.example/x.jpg')).rejects.toThrow('Invalid poster');
		await expect(adapter.fetchPoster('/abc123.jpg')).resolves.toBeInstanceOf(Response);
	});
});

describe('streaming sources', () => {
	it('follow the ticked services', async () => {
		const db = await memoryDb();
		expect((await syncStreamingSources(db, ['netflix', 'hulu'], testKey)).added).toHaveLength(2);
		expect((await syncStreamingSources(db, ['netflix', 'hulu'], testKey)).added).toHaveLength(0);
		const result = await syncStreamingSources(db, ['netflix', 'prime'], testKey);
		expect(result).toMatchObject({ removed: 1 });
		expect(result.added).toHaveLength(1);
		expect((await listSources(db)).map((s) => s.name).sort()).toEqual(['Netflix', 'Prime Video']);
	});

	it('merge with owned titles and mark them, without per-title lookups for catalogue titles', async () => {
		const db = await memoryDb();
		const owned = await addMockSource(db, 'Alpha', 'alpha');
		await syncSource(db, owned.id, owned.adapter);
		await setEnabledServices(db, ['netflix']);
		const [netflixId] = (await syncStreamingSources(db, ['netflix'], testKey)).added;
		const config = await getSourceConfig(db, netflixId, testKey);
		// 900002 is the TMDB ID of the owned mock title "Harbor Lights".
		const { fetchFn } = fakeTmdb([
			{ id: 900002, title: 'Harbor Lights', year: 2021 },
			{ id: 555, title: 'Synthetic Stream Only', year: 2024 }
		]);
		await syncSource(db, netflixId, createStreamingAdapter(config!, { token: 't', region: 'US', fetch: fetchFn }));

		const onNetflix = (await browseWorks(db, { streaming: 'netflix' })).works;
		expect(onNetflix.map((w) => w.title).sort()).toEqual(['Harbor Lights', 'Synthetic Stream Only']);
		const harbor = onNetflix.find((w) => w.title === 'Harbor Lights')!;
		expect(harbor.streaming).toEqual(['netflix']);
		expect(harbor.sources.map((s) => s.sourceName).sort()).toEqual(['Alpha', 'Netflix']);
		await db.execute("UPDATE items SET link_url = 'https://www.themoviedb.org/movie/900002/watch'");
		const netflixItem = (await getWork(db, harbor.id))!.items.find((i) => i.sourceType === 'streaming')!;
		expect(netflixItem.linkUrl).toBe('https://www.netflix.com/search?q=Harbor%20Lights');

		const lookups = vi.fn(async (_kind: 'movie' | 'tv', _id: string) => ({}));
		await refreshAvailability(db, {
			token: 't',
			region: 'US',
			fetchProviders: lookups,
			searchTitle: async () => null,
			fetchDetails: async () => null
		});
		const lookedUp = lookups.mock.calls.map((call) => String(call[1]));
		expect(lookedUp).not.toContain('555');
		const ownedWithTmdb = await all<{ n: number }>(
			db,
			`SELECT COUNT(DISTINCT w.id) AS n FROM works w JOIN items i ON i.work_id = w.id JOIN libraries l ON l.id = i.library_id
			JOIN sources s ON s.id = l.source_id WHERE s.type = 'mock' AND w.external_ids_json LIKE '%tmdb%'`
		);
		expect(lookedUp).toHaveLength(Number(ownedWithTmdb[0].n));
	});
});
