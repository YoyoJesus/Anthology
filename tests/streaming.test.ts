import { describe, expect, it, vi } from 'vitest';
import {
	refreshAvailability,
	servicesFromProviders,
	setEnabledServices,
	type TmdbWatchProviders
} from '../src/lib/server/streaming';
import { syncSource } from '../src/lib/server/sync';
import { browseWorks, getWork } from '../src/lib/server/works';
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
			services: ['netflix', 'hulu', 'disney'],
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

describe('refreshAvailability', () => {
	it('checks works with a TMDB ID and skips fresh ones', async () => {
		const db = await syncedDb();
		const first = await refreshAvailability(db, {
			token: 't',
			region: 'US',
			fetchProviders: netflixEverywhere,
			now: 1000
		});
		expect(first.checked).toBeGreaterThan(0);
		expect(first.skipped).toBeGreaterThan(0);
		const second = await refreshAvailability(db, {
			token: 't',
			region: 'US',
			fetchProviders: netflixEverywhere,
			now: 2000
		});
		expect(second.checked).toBe(0);
		const otherRegion = await refreshAvailability(db, {
			token: 't',
			region: 'GB',
			fetchProviders: netflixEverywhere,
			now: 2000
		});
		expect(otherRegion.checked).toBe(first.checked);
	});

	it('only surfaces services the user has enabled', async () => {
		const db = await syncedDb();
		await refreshAvailability(db, { token: 't', region: 'US', fetchProviders: netflixEverywhere });
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
			concurrency: 1
		});
		expect(result.error).toBe('TMDB rejected the read access token');
		expect(rejected).toHaveBeenCalledTimes(1);
	});
});
