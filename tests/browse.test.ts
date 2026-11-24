import { describe, expect, it, vi } from 'vitest';
import type { RawItem, SourceAdapter } from '../src/lib/server/adapters/types';
import { genresFromTmdb } from '../src/lib/genres';
import { createSource } from '../src/lib/server/sources';
import { syncSource } from '../src/lib/server/sync';
import { findPersonCredits } from '../src/lib/server/tmdb';
import { browseWorks, getWork } from '../src/lib/server/works';
import { memoryDb, testKey } from './helpers';

const item = (
	id: number,
	title: string,
	rating: RawItem['rating'],
	genres: RawItem['genres'] = [],
	kind: RawItem['kind'] = 'movie'
): RawItem => ({
	remoteId: String(id),
	title,
	year: 2000 + id,
	kind,
	externalIds: { tmdb: String(id) },
	posterRef: null,
	addedAt: null,
	updatedAt: null,
	rating,
	genres
});

const ITEMS = [
	item(1, 'Synthetic Cult Gem', { average: 9.8, votes: 3 }, ['horror']),
	item(2, 'Synthetic Classic', { average: 8.4, votes: 9000 }, ['drama']),
	item(3, 'Synthetic Crowd Pleaser', { average: 7.1, votes: 4000 }, ['comedy', 'drama']),
	item(4, 'Synthetic Unrated', null),
	item(5, 'Synthetic Series', { average: 7.9, votes: 800 }, ['scifi'], 'show')
];

async function libraryDb() {
	const db = await memoryDb();
	const id = await createSource(db, { type: 'mock', name: 'Synthetic', baseUrl: 'mock://local', token: 'x' }, testKey);
	const adapter: SourceAdapter = {
		id: String(id),
		type: 'mock',
		testConnection: async () => true,
		listLibraries: async () => [
			{ remoteId: 'm', name: 'Movies', kind: 'movie' },
			{ remoteId: 's', name: 'Shows', kind: 'show' }
		],
		async *fetchItems(library) {
			yield* ITEMS.filter((i) => i.kind === library.kind);
		},
		buildLink: () => '',
		fetchPoster: async () => new Response()
	};
	await syncSource(db, id, adapter);
	return db;
}

const titles = (works: { title: string }[]) => works.map((w) => w.title);

describe('browsing by rating and genre', () => {
	it('sorts by a vote-weighted rating by default, with unrated titles last', async () => {
		const db = await libraryDb();
		expect(titles((await browseWorks(db, {})).works)).toEqual([
			'Synthetic Classic',
			'Synthetic Series',
			'Synthetic Crowd Pleaser',
			'Synthetic Cult Gem',
			'Synthetic Unrated'
		]);
		expect(titles((await browseWorks(db, { sort: 'newest' })).works)[0]).toBe('Synthetic Series');
	});

	it('filters by minimum rating, ignoring ratings with too few votes', async () => {
		const db = await libraryDb();
		expect(titles((await browseWorks(db, { minRating: 8 })).works)).toEqual(['Synthetic Classic']);
	});

	it('filters by genre', async () => {
		const db = await libraryDb();
		expect(titles((await browseWorks(db, { genre: 'drama' })).works).sort()).toEqual([
			'Synthetic Classic',
			'Synthetic Crowd Pleaser'
		]);
	});

	it('limits to given TMDB IDs, keeping movie and show IDs apart', async () => {
		const db = await libraryDb();
		const result = await browseWorks(db, { tmdbIds: { movie: ['2', '5'], show: [] } });
		expect(titles(result.works)).toEqual(['Synthetic Classic']);
		expect((await browseWorks(db, { tmdbIds: { movie: [], show: [] } })).total).toBe(0);
	});

	it('shows rating, votes and genres on the title', async () => {
		const db = await libraryDb();
		const id = (await browseWorks(db, { q: 'Crowd' })).works[0].id;
		expect(await getWork(db, id)).toMatchObject({ rating: 7.1, votes: 4000, genres: ['comedy', 'drama'], tmdbId: '3' });
	});
});

describe('genresFromTmdb', () => {
	it('maps movie and TV genre numbers onto one list', () => {
		expect(genresFromTmdb([10759, 18])).toEqual(['action', 'adventure', 'drama']);
		expect(genresFromTmdb([878])).toEqual(['scifi']);
		expect(genresFromTmdb(undefined)).toEqual([]);
	});
});

describe('findPersonCredits', () => {
	/** Two people share the name: an actor (listed first) and a director. */
	const fetchFn = vi.fn(async (input: string | URL | Request) => {
		const url = new URL(String(input));
		if (url.pathname.endsWith('/search/person'))
			return Response.json({
				results: [
					{ id: 77, name: 'Synthetic Name', known_for_department: 'Acting' },
					{ id: 88, name: 'Synthetic Name', known_for_department: 'Directing' }
				]
			});
		if (url.pathname.includes('/person/77/'))
			return Response.json({
				cast: [
					{ id: 1, media_type: 'movie' },
					{ id: 9, media_type: 'tv' },
					{ id: 1, media_type: 'movie' }
				],
				crew: [{ id: 4, media_type: 'movie', job: 'Producer' }]
			});
		return Response.json({
			cast: [{ id: 5, media_type: 'movie' }],
			crew: [
				{ id: 2, media_type: 'movie', job: 'Director' },
				{ id: 6, media_type: 'tv', job: 'Creator' },
				{ id: 3, media_type: 'movie', job: 'Producer' }
			]
		});
	});

	it('returns what an actor appeared in', async () => {
		expect(await findPersonCredits('synthetic name', 't', 'actor', fetchFn)).toEqual({
			name: 'Synthetic Name',
			movie: ['1'],
			show: ['9']
		});
	});

	it('returns what a director directed or created, preferring someone known for directing', async () => {
		expect(await findPersonCredits('synthetic name', 't', 'director', fetchFn)).toEqual({
			name: 'Synthetic Name',
			movie: ['2'],
			show: ['6']
		});
	});

	it('returns null when nobody matches', async () => {
		const empty = vi.fn(async () => Response.json({ results: [] }));
		expect(await findPersonCredits('nobody', 't', 'actor', empty)).toBeNull();
	});
});
