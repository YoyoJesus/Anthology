import { describe, expect, it } from 'vitest';
import { createCollectionAdapter, parseCollection } from '../src/lib/server/adapters/collection';
import { createSource, getSourceConfig } from '../src/lib/server/sources';
import { syncSource } from '../src/lib/server/sync';
import { parseSourceForm } from '../src/lib/server/validation';
import { browseWorks } from '../src/lib/server/works';
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
	const db = memoryDb();
	const mock = addMockSource(db, 'Server', 'alpha');
	await syncSource(db, mock.id, mock.adapter);
	const id = createSource(
		db,
		{ type: 'collection', name: 'Apple TV', baseUrl: 'collection://local', token: '', collection: list },
		testKey
	);
	const config = getSourceConfig(db, id, testKey)!;
	await syncSource(db, id, createCollectionAdapter(config));
	return { db, id };
}

function sourcesOf(db: ReturnType<typeof memoryDb>, title: string) {
	return browseWorks(db, { q: title })
		.works.filter((w) => w.title === title)
		.map((w) => ({ year: w.year, sources: w.sources.map((s) => s.sourceName) }));
}

describe('collection sources', () => {
	it('stores the list and merges entries into existing works', async () => {
		const { db, id } = await libraryWithCollection(
			'The Glass Orchard (2019)\nNorthbound\nTV: Low Tide Club (2018)\nA Film Only I Own (2001)'
		);
		expect(getSourceConfig(db, id, testKey)?.collection).toContain('Northbound');
		expect(sourcesOf(db, 'The Glass Orchard')).toEqual([{ year: 2019, sources: ['Apple TV', 'Server'] }]);
		expect(sourcesOf(db, 'Northbound')).toEqual([{ year: 2016, sources: ['Apple TV', 'Server'] }]);
		expect(sourcesOf(db, 'Low Tide Club')).toEqual([{ year: 2018, sources: ['Apple TV', 'Server'] }]);
		expect(sourcesOf(db, 'A Film Only I Own')).toEqual([{ year: 2001, sources: ['Apple TV'] }]);
	});

	it('does not guess when a yearless title matches more than one work', async () => {
		const db = memoryDb();
		const a = addMockSource(db, 'A', 'alpha');
		const b = addMockSource(db, 'B', 'beta');
		await syncSource(db, a.id, a.adapter);
		await syncSource(db, b.id, b.adapter);
		const id = createSource(
			db,
			{ type: 'collection', name: 'Apple TV', baseUrl: 'collection://local', token: '', collection: 'Second Draft' },
			testKey
		);
		await syncSource(db, id, createCollectionAdapter(getSourceConfig(db, id, testKey)!));
		expect(sourcesOf(db, 'Second Draft')).toHaveLength(3);
	});

	it('gives a yearless work the year of a later match', async () => {
		const db = memoryDb();
		const id = createSource(
			db,
			{ type: 'collection', name: 'Apple TV', baseUrl: 'collection://local', token: '', collection: 'Copper Valley' },
			testKey
		);
		await syncSource(db, id, createCollectionAdapter(getSourceConfig(db, id, testKey)!));
		const mock = addMockSource(db, 'Server', 'alpha');
		await syncSource(db, mock.id, mock.adapter);
		expect(sourcesOf(db, 'Copper Valley')).toEqual([{ year: 2015, sources: ['Apple TV', 'Server'] }]);
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
