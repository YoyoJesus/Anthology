import { createAdapter } from './adapters';
import { config } from './config';
import { getDb } from './db';
import { PosterCache } from './posters';
import { enabledSourceIds, getSourceConfig } from './sources';
import { syncSource, type SyncResult } from './sync';

const running = new Set<number>();

export function isSyncing(sourceId: number): boolean {
	return running.has(sourceId);
}

export async function runSync(sourceId: number): Promise<SyncResult> {
	if (running.has(sourceId)) throw new Error('A sync for this source is already running');
	const db = getDb();
	const source = getSourceConfig(db, sourceId);
	if (!source) throw new Error('Source not found');
	running.add(sourceId);
	try {
		const adapter = createAdapter(source);
		const result = await syncSource(db, sourceId, adapter);
		const posters = new PosterCache(db);
		posters.pruneOrphans();
		posters.prefetch(sourceId, adapter).catch((err) => console.error('Poster prefetch failed', err));
		return result;
	} finally {
		running.delete(sourceId);
	}
}

let timer: ReturnType<typeof setInterval> | undefined;

export function startScheduler(): void {
	if (timer) return;
	const intervalMs = config.syncIntervalMinutes * 60 * 1000;
	const tick = () => {
		const now = Date.now();
		for (const { id, lastSyncAt } of enabledSourceIds(getDb())) {
			const last = lastSyncAt ? Date.parse(`${lastSyncAt}Z`) : 0;
			if (now - last >= intervalMs && !running.has(id)) {
				runSync(id).catch((err) => console.error(`Scheduled sync of source ${id} failed:`, err.message));
			}
		}
	};
	timer = setInterval(tick, 60 * 1000);
	timer.unref();
	setTimeout(tick, 5_000).unref();
}
