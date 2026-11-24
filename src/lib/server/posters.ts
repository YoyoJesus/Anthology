import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
import type { DB } from './db';
import type { SourceAdapter } from './adapters/types';

const EXTENSIONS: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
	'image/gif': 'gif',
	'image/svg+xml': 'svg'
};
const MAX_POSTER_BYTES = 10 * 1024 * 1024;

export interface CacheEntry {
	itemId: number;
	file: string;
	bytes: number;
	lastAccess: number;
}

/** Least recently used entries to drop so the cache fits in maxBytes. */
export function selectEvictions(entries: CacheEntry[], maxBytes: number): CacheEntry[] {
	let total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
	const evict: CacheEntry[] = [];
	for (const entry of [...entries].sort((a, b) => a.lastAccess - b.lastAccess)) {
		if (total <= maxBytes) break;
		evict.push(entry);
		total -= entry.bytes;
	}
	return evict;
}

export class PosterCache {
	constructor(
		private db: DB,
		private dir = path.join(config.dataDir, 'cache', 'posters'),
		private maxBytes = config.posterCacheMaxBytes
	) {}

	get(itemId: number): { file: string; contentType: string } | null {
		const row = this.db.prepare('SELECT file, content_type FROM poster_cache WHERE item_id = ?').get(itemId) as
			{ file: string; content_type: string } | undefined;
		if (!row) return null;
		const file = path.join(this.dir, row.file);
		if (!fs.existsSync(file)) {
			this.db.prepare('DELETE FROM poster_cache WHERE item_id = ?').run(itemId);
			return null;
		}
		this.db.prepare('UPDATE poster_cache SET last_access = ? WHERE item_id = ?').run(Date.now(), itemId);
		return { file, contentType: row.content_type };
	}

	async fetch(
		itemId: number,
		posterRef: string,
		adapter: SourceAdapter
	): Promise<{ file: string; contentType: string }> {
		const res = await adapter.fetchPoster(posterRef);
		const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
		const ext = EXTENSIONS[contentType];
		if (!ext) throw new Error(`Unsupported poster type "${contentType}"`);
		const body = Buffer.from(await res.arrayBuffer());
		if (body.length > MAX_POSTER_BYTES) throw new Error('Poster is too large to cache');

		const name = `${itemId}.${ext}`;
		fs.mkdirSync(this.dir, { recursive: true });
		fs.writeFileSync(path.join(this.dir, name), body);
		this.db
			.prepare(
				`INSERT INTO poster_cache (item_id, file, content_type, bytes, last_access) VALUES (?, ?, ?, ?, ?)
				ON CONFLICT(item_id) DO UPDATE SET file = excluded.file, content_type = excluded.content_type,
				bytes = excluded.bytes, last_access = excluded.last_access`
			)
			.run(itemId, name, contentType, body.length, Date.now());
		this.enforceLimit();
		return { file: path.join(this.dir, name), contentType };
	}

	enforceLimit(): void {
		const entries = (
			this.db.prepare('SELECT item_id, file, bytes, last_access FROM poster_cache').all() as {
				item_id: number;
				file: string;
				bytes: number;
				last_access: number;
			}[]
		).map((row) => ({ itemId: row.item_id, file: row.file, bytes: row.bytes, lastAccess: row.last_access }));
		for (const entry of selectEvictions(entries, this.maxBytes)) this.remove(entry.itemId, entry.file);
	}

	pruneOrphans(): void {
		const rows = this.db
			.prepare('SELECT item_id, file FROM poster_cache WHERE item_id NOT IN (SELECT id FROM items)')
			.all() as { item_id: number; file: string }[];
		for (const row of rows) this.remove(row.item_id, row.file);
	}

	/** Download posters for a source's items that are not cached yet. Failures are skipped. */
	async prefetch(sourceId: number, adapter: SourceAdapter, concurrency = 4): Promise<void> {
		const queue = this.db
			.prepare(
				`SELECT i.id, i.poster_url FROM items i JOIN libraries l ON l.id = i.library_id
				WHERE l.source_id = ? AND i.poster_url IS NOT NULL AND i.id NOT IN (SELECT item_id FROM poster_cache)`
			)
			.all(sourceId) as { id: number; poster_url: string }[];
		const worker = async () => {
			for (let next = queue.shift(); next; next = queue.shift()) {
				await this.fetch(next.id, next.poster_url, adapter).catch(() => undefined);
			}
		};
		await Promise.all(Array.from({ length: concurrency }, worker));
	}

	private remove(itemId: number, file: string): void {
		fs.rmSync(path.join(this.dir, file), { force: true });
		this.db.prepare('DELETE FROM poster_cache WHERE item_id = ?').run(itemId);
	}
}
