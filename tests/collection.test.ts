import { describe, expect, it, vi } from 'vitest';
import { createCollectionAdapter, parseCollection } from '../src/lib/server/adapters/collection';
import { createSource, getSourceConfig, setCollection } from '../src/lib/server/sources';
import { refreshAvailability } from '../src/lib/server/streaming';
import { syncSource } from '../src/lib/server/sync';
import { parseSourceForm } from '../src/lib/server/validation';
import { browseWorks } from '../src/lib/server/works';
import type { DB } from '../src/lib/server/db';
import { addMockSource, memoryDb, testKey } from './helpers';

describe('parseCollection', () => {
	it('reads titles, years and TV prefixes, skipping comments, blanks and duplicates', () => {
		const { entries, skipped } = parseCollection(
			[
				'# Apple TV',
				'The Glass Orchard (2019)',
				'',
				'tv: Low Tide Club (2018)',
				'Northbound',
				'Northbound',
				'!!!'
			].join('\r\n')
		);
		expect(entries).toEqual([
			{ title: 'The Glass Orchard', year: 2019, kind: 'movie' },
			{ title: 'Low Tide Club', year: 2018, kind: 'show' },
			{ title: 'Northbound', year: null, kind: 'movie' }
		]);
		expect(skipped).toEqual([7]);
	});

	it('keeps a parenthesised number that is not a year in the title', () => {
		expect(parseCollection('Room (0042)').entries).toEqual([{ title: 'Room (0042)', year: null, kind: 'movie' }]);
	});
});

async function libraryWithCollection(list: string) {
	const db = await memoryDb();
	const mock = await addMockSource(db, 'Server', 'alpha');
	await syncSource(db, mock.id, mock.adapter);
	const id = await createSource(
		db,
		{ type: 'collection', name: 'Apple TV', baseUrl: 'collection://local', token: '', collection: list },
		testKey
	);
	const config = (await getSourceConfig(db, id, testKey))!;
	await syncSource(db, id, createCollectionAdapter(config));
	return { db, id };
}

async function sourcesOf(db: DB, title: string) {
	return (await browseWorks(db, { q: title })).works
		.filter((w) => w.title === title)
		.map((w) => ({ year: w.year, sources: w.sources.map((s) => s.sourceName) }));
}

describe('collection sources', () => {
	it('stores the list and merges entries into existing works', async () => {
		const { db, id } = await libraryWithCollection(
			'The Glass Orchard (2019)\nNorthbound\nTV: Low Tide Club (2018)\nA Film Only I Own (2001)'
		);
		expect((await getSourceConfig(db, id, testKey))?.collection).toContain('Northbound');
		expect(await sourcesOf(db, 'The Glass Orchard')).toEqual([{ year: 2019, sources: ['Apple TV', 'Server'] }]);
		expect(await sourcesOf(db, 'Northbound')).toEqual([{ year: 2016, sources: ['Apple TV', 'Server'] }]);
		expect(await sourcesOf(db, 'Low Tide Club')).toEqual([{ year: 2018, sources: ['Apple TV', 'Server'] }]);
		expect(await sourcesOf(db, 'A Film Only I Own')).toEqual([{ year: 2001, sources: ['Apple TV'] }]);
	});

	it('does not guess when a yearless title matches more than one work', async () => {
		const db = await memoryDb();
		const a = await addMockSource(db, 'A', 'alpha');
		const b = await addMockSource(db, 'B', 'beta');
		await syncSource(db, a.id, a.adapter);
		await syncSource(db, b.id, b.adapter);
		const id = await createSource(
			db,
			{ type: 'collection', name: 'Apple TV', baseUrl: 'collection://local', token: '', collection: 'Second Draft' },
			testKey
		);
		await syncSource(db, id, createCollectionAdapter((await getSourceConfig(db, id, testKey))!));
		expect(await sourcesOf(db, 'Second Draft')).toHaveLength(3);
	});

	it('gives a yearless work the year of a later match', async () => {
		const db = await memoryDb();
		const id = await createSource(
			db,
			{ type: 'collection', name: 'Apple TV', baseUrl: 'collection://local', token: '', collection: 'Copper Valley' },
			testKey
		);
		await syncSource(db, id, createCollectionAdapter((await getSourceConfig(db, id, testKey))!));
		const mock = await addMockSource(db, 'Server', 'alpha');
		await syncSource(db, mock.id, mock.adapter);
		expect(await sourcesOf(db, 'Copper Valley')).toEqual([{ year: 2015, sources: ['Apple TV', 'Server'] }]);
	});
});

describe('collection form', () => {
	const form = (values: Record<string, string>) => {
		const data = new FormData();
		for (const [k, v] of Object.entries(values)) data.set(k, v);
		return data;
	};

	it('needs at least one readable title', () => {
		expect(
			parseSourceForm(form({ type: 'collection', name: 'Apple TV', collection: '# nothing\n' }), ['collection'])
		).toEqual({
			ok: false,
			error: 'Add at least one title, one per line.'
		});
		const ok = parseSourceForm(form({ type: 'collection', name: 'Apple TV', collection: 'Harbor Lights (2021)\r\n' }), [
			'collection'
		]);
		expect(ok).toEqual({
			ok: true,
			value: {
				type: 'collection',
				name: 'Apple TV',
				baseUrl: 'collection://local',
				token: '',
				collection: 'Harbor Lights (2021)'
			}
		});
	});
});

describe('collection posters', () => {
	it('fall back to the TMDB poster found by title search', async () => {
		const db = await memoryDb();
		const id = await createSource(db, { type: 'collection', name: 'Shelf', baseUrl: '', token: '' }, testKey);
		await setCollection(db, id, 'Synthetic Shelf Film (2020)');
		await syncSource(db, id, createCollectionAdapter((await getSourceConfig(db, id, testKey))!));
		expect((await browseWorks(db, {})).works[0].posterUrl).toBeNull();
		await refreshAvailability(db, {
			token: 't',
			region: 'US',
			fetchProviders: async () => ({}),
			searchTitle: async () => ({ id: '4242', posterPath: '/shelf.jpg' })
		});
		expect((await browseWorks(db, {})).works[0].posterUrl).toBe('/posters/tmdb/shelf.jpg');
	});
});

describe('poster backfill', () => {
	it('fetches posters for titles matched before posters were stored, once', async () => {
		const db = await memoryDb();
		const id = await createSource(db, { type: 'collection', name: 'Shelf', baseUrl: '', token: '' }, testKey);
		await setCollection(db, id, 'Synthetic Shelf Film (2020)');
		await syncSource(db, id, createCollectionAdapter((await getSourceConfig(db, id, testKey))!));
		const options = {
			token: 't',
			region: 'US',
			fetchProviders: async () => ({}),
			searchTitle: async () => ({ id: '4242', posterPath: null })
		};
		await refreshAvailability(db, {
			...options,
			fetchPosterPath: async () => {
				throw new Error('offline');
			}
		});
		expect((await browseWorks(db, {})).works[0].posterUrl).toBeNull();
		const posterPath = vi.fn(async () => '/late.jpg');
		await refreshAvailability(db, { ...options, fetchPosterPath: posterPath });
		await refreshAvailability(db, { ...options, fetchPosterPath: posterPath });
		expect(posterPath).toHaveBeenCalledTimes(1);
		expect((await browseWorks(db, {})).works[0].posterUrl).toBe('/posters/tmdb/late.jpg');
	});
});
