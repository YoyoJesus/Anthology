import { describe, expect, it } from 'vitest';
import type { DB } from '../src/lib/server/db';
import { acquireLock, releaseLock } from '../src/lib/server/db';
import { syncSource } from '../src/lib/server/sync';
import { browseWorks, getWork } from '../src/lib/server/works';
import { deleteSource, listSources } from '../src/lib/server/sources';
import type { SourceAdapter } from '../src/lib/server/adapters/types';
import { addMockSource, memoryDb } from './helpers';

async function twoSources() {
	const db = await memoryDb();
	const alpha = await addMockSource(db, 'Alpha', 'alpha');
	const beta = await addMockSource(db, 'Beta', 'beta');
	await syncSource(db, alpha.id, alpha.adapter);
	await syncSource(db, beta.id, beta.adapter);
	return { db, alpha, beta };
}

async function findWork(db: DB, title: string, year?: number) {
	return (await browseWorks(db, { q: title, limit: 100 })).works.filter(
		(w) => w.title.startsWith(title) && (!year || w.year === year)
	);
}

describe('syncSource with two overlapping sources', () => {
	it('merges shared titles into one work with both sources', async () => {
		const { db } = await twoSources();
		const [orchard] = await findWork(db, 'The Glass Orchard');
		expect(orchard.sources.map((s) => s.sourceName)).toEqual(['Alpha', 'Beta']);
		expect((await getWork(db, orchard.id))?.items).toHaveLength(2);
	});

	it('matches by normalized title and year when there are no IDs', async () => {
		const { db } = await twoSources();
		const northbound = await findWork(db, 'Northbound');
		expect(northbound).toHaveLength(1);
		expect(northbound[0].sources).toHaveLength(2);
	});

	it('keeps same-titled works from different years apart', async () => {
		const { db } = await twoSources();
		const drafts = await findWork(db, 'Second Draft');
		expect(drafts.map((w) => w.year).sort()).toEqual([2012, 2025]);
		expect(drafts.every((w) => w.sources.length === 1)).toBe(true);
	});

	it('is stable when the same source syncs again', async () => {
		const { db, alpha } = await twoSources();
		const before = (await browseWorks(db, {})).total;
		await syncSource(db, alpha.id, alpha.adapter);
		expect((await browseWorks(db, {})).total).toBe(before);
		expect((await findWork(db, 'The Glass Orchard'))[0].sources).toHaveLength(2);
	});

	it('filters by kind and source', async () => {
		const { db, beta } = await twoSources();
		const shows = (await browseWorks(db, { kind: 'show' })).works;
		expect(shows.length).toBeGreaterThan(0);
		expect(shows.every((w) => w.kind === 'show')).toBe(true);
		const betaOnly = (await browseWorks(db, { sourceId: beta.id })).works;
		expect(betaOnly.every((w) => w.sources.some((s) => s.sourceId === beta.id))).toBe(true);
	});

	it('removes works when their only source is deleted', async () => {
		const { db, alpha } = await twoSources();
		expect(await findWork(db, 'Copper Valley')).toHaveLength(1);
		await deleteSource(db, alpha.id);
		expect(await findWork(db, 'Copper Valley')).toHaveLength(0);
		expect((await findWork(db, 'The Glass Orchard'))[0].sources).toHaveLength(1);
	});
});

describe('resync', () => {
	it('drops items that disappeared from the source', async () => {
		const db = await memoryDb();
		const { id, adapter } = await addMockSource(db, 'Alpha', 'alpha');
		await syncSource(db, id, adapter);
		const shrunk: SourceAdapter = {
			...adapter,
			async *fetchItems(library) {
				for await (const item of adapter.fetchItems(library)) if (item.title !== 'Static Bloom') yield item;
			}
		};
		await syncSource(db, id, shrunk);
		expect(await findWork(db, 'Static Bloom')).toHaveLength(0);
		expect(await findWork(db, 'Copper Valley')).toHaveLength(1);
	});

	it('records the error and keeps existing data when a source fails', async () => {
		const db = await memoryDb();
		const { id, adapter } = await addMockSource(db, 'Alpha', 'alpha');
		await syncSource(db, id, adapter);
		const before = (await browseWorks(db, {})).total;
		const broken: SourceAdapter = {
			...adapter,
			listLibraries: () => Promise.reject(new Error('Source rejected the credentials'))
		};
		await expect(syncSource(db, id, broken)).rejects.toThrow('credentials');
		expect((await listSources(db))[0].lastSyncError).toBe('Source rejected the credentials');
		expect((await browseWorks(db, {})).total).toBe(before);
	});
});

describe('locks', () => {
	it('lets one holder in until released or expired', async () => {
		const db = await memoryDb();
		expect(await acquireLock(db, 'sync', 1000, 0)).toBe(true);
		expect(await acquireLock(db, 'sync', 1000, 500)).toBe(false);
		expect(await acquireLock(db, 'sync', 1000, 1500)).toBe(true);
		await releaseLock(db, 'sync');
		expect(await acquireLock(db, 'sync', 1000, 1600)).toBe(true);
	});
});
