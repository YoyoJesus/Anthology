import { describe, expect, it } from 'vitest';
import { syncSource } from '../src/lib/server/sync';
import { browseWorks, getWork } from '../src/lib/server/works';
import { deleteSource, listSources } from '../src/lib/server/sources';
import type { SourceAdapter } from '../src/lib/server/adapters/types';
import { addMockSource, memoryDb } from './helpers';

async function twoSources() {
	const db = memoryDb();
	const alpha = addMockSource(db, 'Alpha', 'alpha');
	const beta = addMockSource(db, 'Beta', 'beta');
	await syncSource(db, alpha.id, alpha.adapter);
	await syncSource(db, beta.id, beta.adapter);
	return { db, alpha, beta };
}

function findWork(db: ReturnType<typeof memoryDb>, title: string, year?: number) {
	return browseWorks(db, { q: title, limit: 100 }).works.filter(
		(w) => w.title.startsWith(title) && (!year || w.year === year)
	);
}

describe('syncSource with two overlapping sources', () => {
	it('merges shared titles into one work with both sources', async () => {
		const { db } = await twoSources();
		const [orchard] = findWork(db, 'The Glass Orchard');
		expect(orchard.sources.map((s) => s.sourceName)).toEqual(['Alpha', 'Beta']);
		expect(getWork(db, orchard.id)?.items).toHaveLength(2);
	});

	it('matches by normalized title and year when there are no IDs', async () => {
		const { db } = await twoSources();
		const northbound = findWork(db, 'Northbound');
		expect(northbound).toHaveLength(1);
		expect(northbound[0].sources).toHaveLength(2);
	});

	it('keeps same-titled works from different years apart', async () => {
		const { db } = await twoSources();
		const drafts = findWork(db, 'Second Draft');
		expect(drafts.map((w) => w.year).sort()).toEqual([2012, 2025]);
		expect(drafts.every((w) => w.sources.length === 1)).toBe(true);
	});

	it('filters by kind and source', async () => {
		const { db, beta } = await twoSources();
		const shows = browseWorks(db, { kind: 'show' }).works;
		expect(shows.length).toBeGreaterThan(0);
		expect(shows.every((w) => w.kind === 'show')).toBe(true);
		const betaOnly = browseWorks(db, { sourceId: beta.id }).works;
		expect(betaOnly.every((w) => w.sources.some((s) => s.sourceId === beta.id))).toBe(true);
	});

	it('removes works when their only source is deleted', async () => {
		const { db, alpha } = await twoSources();
		expect(findWork(db, 'Copper Valley')).toHaveLength(1);
		deleteSource(db, alpha.id);
		expect(findWork(db, 'Copper Valley')).toHaveLength(0);
		expect(findWork(db, 'The Glass Orchard')[0].sources).toHaveLength(1);
	});
});

describe('resync', () => {
	it('drops items that disappeared from the source', async () => {
		const db = memoryDb();
		const { id, adapter } = addMockSource(db, 'Alpha', 'alpha');
		await syncSource(db, id, adapter);
		const shrunk: SourceAdapter = {
			...adapter,
			async *fetchItems(library) {
				for await (const item of adapter.fetchItems(library)) if (item.title !== 'Static Bloom') yield item;
			}
		};
		await syncSource(db, id, shrunk);
		expect(findWork(db, 'Static Bloom')).toHaveLength(0);
		expect(findWork(db, 'Copper Valley')).toHaveLength(1);
	});

	it('records the error and keeps existing data when a source fails', async () => {
		const db = memoryDb();
		const { id, adapter } = addMockSource(db, 'Alpha', 'alpha');
		await syncSource(db, id, adapter);
		const before = browseWorks(db, {}).total;
		const broken: SourceAdapter = {
			...adapter,
			listLibraries: () => Promise.reject(new Error('Source rejected the credentials'))
		};
		await expect(syncSource(db, id, broken)).rejects.toThrow('credentials');
		expect(listSources(db)[0].lastSyncError).toBe('Source rejected the credentials');
		expect(browseWorks(db, {}).total).toBe(before);
	});
});
