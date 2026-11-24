import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PosterCache, selectEvictions } from '../src/lib/server/posters';
import { syncSource } from '../src/lib/server/sync';
import type { SourceAdapter } from '../src/lib/server/adapters/types';
import { addMockSource, memoryDb } from './helpers';

const dirs: string[] = [];
function tempDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anthology-posters-'));
	dirs.push(dir);
	return dir;
}
afterEach(() => {
	for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('selectEvictions', () => {
	it('drops least recently used entries until under the cap', () => {
		const entries = [
			{ itemId: 1, file: 'a', bytes: 40, lastAccess: 3 },
			{ itemId: 2, file: 'b', bytes: 40, lastAccess: 1 },
			{ itemId: 3, file: 'c', bytes: 40, lastAccess: 2 }
		];
		expect(selectEvictions(entries, 100).map((e) => e.itemId)).toEqual([2]);
		expect(selectEvictions(entries, 200)).toEqual([]);
		expect(selectEvictions(entries, 0)).toHaveLength(3);
	});
});

describe('PosterCache', () => {
	it('prefetches posters and keeps the cache under its size cap', async () => {
		const db = memoryDb();
		const { id, adapter } = addMockSource(db, 'Alpha', 'alpha');
		await syncSource(db, id, adapter);
		const dir = tempDir();
		const cache = new PosterCache(db, dir, 3000);
		await cache.prefetch(id, adapter);
		const total = fs.readdirSync(dir).reduce((sum, f) => sum + fs.statSync(path.join(dir, f)).size, 0);
		expect(total).toBeLessThanOrEqual(3000);
		expect(fs.readdirSync(dir).length).toBeGreaterThan(0);
	});

	it('refuses non-image responses', async () => {
		const db = memoryDb();
		const { adapter } = addMockSource(db, 'Alpha', 'alpha');
		const htmlAdapter: SourceAdapter = {
			...adapter,
			fetchPoster: async () => new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } })
		};
		await expect(new PosterCache(db, tempDir()).fetch(1, 'x', htmlAdapter)).rejects.toThrow('Unsupported');
	});
});
