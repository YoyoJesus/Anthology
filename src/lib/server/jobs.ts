import { createAdapter } from './adapters';
import { config } from './config';
import { acquireLock, getDb, isLocked, releaseLock } from './db';
import { enabledSourceIds, getSourceConfig } from './sources';
import { refreshAvailability, type RefreshResult } from './streaming';
import { syncSource, type SyncResult } from './sync';

const SYNC_LOCK = 'sync';
const AVAILABILITY_LOCK = 'availability';
const LOCK_TTL_MS = 5 * 60 * 1000;

export async function isSyncing(): Promise<boolean> {
	return isLocked(await getDb(), SYNC_LOCK);
}

export async function isRefreshingAvailability(): Promise<boolean> {
	return isLocked(await getDb(), AVAILABILITY_LOCK);
}

/** One sync at a time across all instances, since new work IDs are assigned during the sync. */
export async function runSync(sourceId: number): Promise<SyncResult> {
	const db = await getDb();
	const source = await getSourceConfig(db, sourceId);
	if (!source) throw new Error('Source not found');
	if (!(await acquireLock(db, SYNC_LOCK, LOCK_TTL_MS))) throw new Error('Another sync is running. Try again shortly.');
	try {
		return await syncSource(db, sourceId, createAdapter(source));
	} finally {
		await releaseLock(db, SYNC_LOCK);
	}
}

/** Returns null when no TMDB token is configured or another refresh is running. */
export async function runAvailabilityRefresh(deadline?: number, force = false): Promise<RefreshResult | null> {
	if (!config.tmdbToken) return null;
	const db = await getDb();
	if (!(await acquireLock(db, AVAILABILITY_LOCK, LOCK_TTL_MS))) return null;
	try {
		return await refreshAvailability(db, { token: config.tmdbToken, region: config.streamingRegion, force, deadline });
	} finally {
		await releaseLock(db, AVAILABILITY_LOCK);
	}
}

export interface ScheduledRun {
	synced: number[];
	failed: { id: number; error: string }[];
	availability: RefreshResult | null;
}

/** Sync stale sources, then refresh availability, stopping new work once the time budget is spent. */
export async function runScheduledJobs(budgetMs: number, now = Date.now()): Promise<ScheduledRun> {
	const deadline = now + budgetMs;
	const intervalMs = config.syncIntervalMinutes * 60 * 1000;
	const result: ScheduledRun = { synced: [], failed: [], availability: null };
	for (const { id, lastSyncAt } of await enabledSourceIds(await getDb())) {
		if (Date.now() >= deadline) break;
		const last = lastSyncAt ? Date.parse(`${lastSyncAt.replace(' ', 'T')}Z`) : 0;
		if (now - last < intervalMs) continue;
		try {
			await runSync(id);
			result.synced.push(id);
		} catch (err) {
			result.failed.push({ id, error: err instanceof Error ? err.message : 'Sync failed' });
		}
	}
	if (Date.now() < deadline) result.availability = await runAvailabilityRefresh(deadline);
	return result;
}

let timer: ReturnType<typeof setInterval> | undefined;

/** For long-running hosts (Docker). Vercel uses the cron route instead. */
export function startScheduler(): void {
	if (timer) return;
	const tick = () => runScheduledJobs(10 * 60 * 1000).catch((err) => console.error('Scheduled jobs failed:', err));
	timer = setInterval(tick, 15 * 60 * 1000);
	timer.unref();
	setTimeout(tick, 5_000).unref();
}
