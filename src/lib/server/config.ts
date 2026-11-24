import path from 'node:path';

function positiveNumber(value: string | undefined, fallback: number): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface Config {
	dataDir: string;
	adminPassword: string | undefined;
	secretKey: string | undefined;
	posterCacheMaxBytes: number;
	syncIntervalMinutes: number;
	enableMockSources: boolean;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
	return {
		dataDir: path.resolve(env.DATA_DIR || './data'),
		adminPassword: env.ADMIN_PASSWORD || undefined,
		secretKey: env.SECRET_KEY || undefined,
		posterCacheMaxBytes: positiveNumber(env.POSTER_CACHE_MAX_MB, 500) * 1024 * 1024,
		syncIntervalMinutes: positiveNumber(env.SYNC_INTERVAL_MINUTES, 360),
		enableMockSources: env.ENABLE_MOCK_SOURCES === 'true' || env.NODE_ENV !== 'production'
	};
}

export const config = readConfig();
