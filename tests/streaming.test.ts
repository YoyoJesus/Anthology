import { describe, expect, it, vi } from 'vitest';
import {
	pickSearchResult,
	refreshAvailability,
	servicesFromProviders,
	setEnabledServices,
	type TmdbWatchProviders
} from '../src/lib/server/streaming';
import { syncSource } from '../src/lib/server/sync';
import { browseWorks, getWork } from '../src/lib/server/works';
import { all } from '../src/lib/server/db';
import { addMockSource, memoryDb } from './helpers';

const provider = (provider_name: string) => ({ provider_name });

describe('servicesFromProviders', () => {
	it('reads subscription offers for the region only', () => {
		const payload: TmdbWatchProviders = {
			results: {
				US: {
					link: 'https://www.themoviedb.org/movie/1/watch?locale=US',
					flatrate: [provider('Netflix'), provider('Disney Plus'), provider('Paramount Plus Apple TV Channel')],
					ads: [provider('Hulu')],
					buy: [provider('Apple TV'), provider('Amazon Video')],
					rent: [provider('Amazon Prime Video')]
				},
				GB: { flatrate: [provider('Amazon Prime Video')] }
			}
		};
		expect(servicesFromProviders(payload, 'US')).toEqual({
			services: ['netflix', 'disney', 'hulu'],
			link: 'https://www.themoviedb.org/movie/1/watch?locale=US'
		});
		expect(servicesFromProviders(payload, 'GB').services).toEqual(['prime']);
		expect(servicesFromProviders(payload, 'CA')).toEqual({ services: [], link: null });
	});

	it('recognises Apple TV as a subscription only under flatrate', () => {
		const sub = { results: { US: { flatrate: [provider('Apple TV Plus')] } } };
		const renamed = { results: { US: { flatrate: [provider('Apple TV')] } } };
		const store = { results: { US: { buy: [provider('Apple TV')] } } };
		expect(servicesFromProviders(sub, 'US').services).toEqual(['appletv']);
		expect(servicesFromProviders(renamed, 'US').services).toEqual(['appletv']);
		expect(servicesFromProviders(store, 'US').services).toEqual([]);
	});
});

async function syncedDb() {
	const db = await memoryDb();
	const { id, adapter } = await addMockSource(db, 'Alpha', 'alpha');
	await syncSource(db, id, adapter);
	return db;
}

const netflixEverywhere = vi.fn(async () => ({ results: { US: { flatrate: [provider('Netflix')] } } }));
const noMatch = vi.fn(async () => null);
const noDetails = vi.fn(async () => null);

describe('refreshAvailability', () => {
	it('checks works with a TMDB ID and skips fresh ones', async () => {
		const db = await syncedDb();
		const first = await refreshAvailability(db, {
			token: 't',
			region: 'US',
			fetchProviders: netflixEverywhere,
			searchTitle: noMatch,
			fetchDetails: noDetails,
			now: 1000
		});
		expect(first.checked).toBeGreaterThan(0);
		expect(first.skipped).toBeGreaterThan(0);
		const second = await refreshAvailability(db, {
			token: 't',
			region: 'US',
			fetchProviders: netflixEverywhere,
			searchTitle: noMatch,
			fetchDetails: noDetails,
			now: 2000
		});
		expect(second.checked).toBe(0);
		const otherRegion = await refreshAvailability(db, {
			token: 't',
			region: 'GB',
			fetchProviders: netflixEverywhere,
			searchTitle: noMatch,
			fetchDetails: noDetails,
			now: 2000
		});
		expect(otherRegion.checked).toBe(first.checked);
	});

	it('only surfaces services the user has enabled', async () => {
		const db = await syncedDb();
		await refreshAvailability(db, {
			token: 't',
			region: 'US',
			fetchProviders: netflixEverywhere,
			searchTitle: noMatch,
			fetchDetails: noDetails
		});
		expect((await browseWorks(db, { streaming: 'any' })).total).toBe(0);
		await setEnabledServices(db, ['netflix']);
		const onNetflix = (await browseWorks(db, { streaming: 'any' })).works;
		expect(onNetflix.length).toBeGreaterThan(0);
		expect((await getWork(db, onNetflix[0].id))?.streaming).toEqual(['netflix']);
		expect((await browseWorks(db, { streaming: 'hulu' })).total).toBe(0);
	});

	it('leaves the rest for the next run once the deadline passes', async () => {
		const db = await syncedDb();
		const result = await refreshAvailability(db, {
			token: 't',
			region: 'US',
			fetchProviders: netflixEverywhere,
			searchTitle: noMatch,
			fetchDetails: noDetails,
			deadline: Date.now() - 1
		});
		expect(result.checked).toBe(0);
		expect(result.remaining).toBeGreaterThan(0);
	});

	it('stops early when TMDB rejects the token', async () => {
		const db = await syncedDb();
		const rejected = vi.fn(async () => {
			throw new Error('TMDB rejected the read access token');
		});
		const result = await refreshAvailability(db, {
			token: 'bad',
			region: 'US',
			fetchProviders: rejected,
			searchTitle: noMatch,
			fetchDetails: noDetails,
			concurrency: 1
		});
		expect(result.error).toBe('TMDB rejected the read access token');
		expect(rejected).toHaveBeenCalledTimes(1);
	});
});

describe('pickSearchResult', () => {
	const results = [
		{ id: 1, title: 'Harbor Lights Returns', release_date: '2021-03-01' },
		{ id: 2, title: 'Harbor Lights', release_date: '1990-05-01' },
		{ id: 3, title: 'The Harbor Lights', release_date: '2020-12-20' }
	];

	it('needs an exact title and a year within one', () => {
		expect(pickSearchResult(results, 'Harbor Lights', 2021)).toBe('3');
		expect(pickSearchResult(results, 'Harbor Lights', 2005)).toBeNull();
	});

	it('takes the first exact title when the year is unknown', () => {
		expect(pickSearchResult(results, 'Harbor Lights', null)).toBe('2');
		expect(pickSearchResult(results, 'Lights', null)).toBeNull();
	});

	it('matches TV names', () => {
		expect(
			pickSearchResult([{ id: 9, name: 'Copper Valley', first_air_date: '2015-01-01' }], 'Copper Valley', 2015)
		).toBe('9');
	});
});

describe('refreshAvailability title search', () => {
	it('finds missing TMDB IDs by title, stores them and skips titles with no match', async () => {
		const db = await syncedDb();
		const search = vi.fn(async (_kind: 'movie' | 'tv', title: string) =>
			title === 'Northbound'
				? { id: '777', posterPath: '/p777.jpg', rating: 7.5, votes: 120, genres: ['drama' as const] }
				: null
		);
		const lookups: string[] = [];
		const fetchProviders = vi.fn(async (_kind: 'movie' | 'tv', id: string) => {
			lookups.push(id);
			return { results: { US: { flatrate: [provider('Netflix')] } } };
		});
		const before = await all<{ title: string; external_ids_json: string }>(
			db,
			'SELECT title, external_ids_json FROM works'
		);
		const missing = before.filter((w) => !JSON.parse(w.external_ids_json).tmdb);
		const result = await refreshAvailability(db, {
			token: 't',
			region: 'US',
			fetchProviders,
			searchTitle: search,
			fetchDetails: noDetails
		});
		expect(search).toHaveBeenCalledTimes(missing.length);
		expect(result.skipped).toBe(missing.filter((w) => w.title !== 'Northbound').length);
		expect(result.checked + result.skipped).toBe(before.length);
		expect(lookups).toContain('777');
		const northbound = await all<{ external_ids_json: string }>(
			db,
			"SELECT external_ids_json FROM works WHERE title = 'Northbound'"
		);
		expect(JSON.parse(northbound[0].external_ids_json).tmdb).toBe('777');
		const stored = await all<{ path: string }>(
			db,
			"SELECT p.path FROM work_posters p JOIN works w ON w.id = p.work_id WHERE w.title = 'Northbound'"
		);
		expect(stored.map((r) => r.path)).toEqual(['/p777.jpg']);
		// The source's own artwork still wins over the TMDB poster.
		expect((await browseWorks(db, { q: 'Northbound' })).works[0].posterUrl).toMatch(/^\/posters\/\d+$/);
		const again = await refreshAvailability(db, {
			token: 't',
			region: 'US',
			fetchProviders,
			searchTitle: search,
			fetchDetails: noDetails
		});
		expect(again.checked + again.skipped).toBe(0);
	});
});
