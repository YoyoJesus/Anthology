import path from 'node:path';

function positiveNumber(value: string | undefined, fallback: number): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface Config {
	databaseUrl: string;
	databaseAuthToken: string | undefined;
	dataDir: string;
	adminPassword: string | undefined;
	secretKey: string | undefined;
	cronSecret: string | undefined;
	syncIntervalMinutes: number;
	enableMockSources: boolean;
	tmdbToken: string | undefined;
	streamingRegion: string;
	onVercel: boolean;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
	const dataDir = path.resolve(env.DATA_DIR || './data');
	return {
		databaseUrl: env.TURSO_DATABASE_URL || env.DATABASE_URL || `file:${path.join(dataDir, 'anthology.db')}`,
		databaseAuthToken: env.TURSO_AUTH_TOKEN || env.DATABASE_AUTH_TOKEN || undefined,
		dataDir,
		adminPassword: env.ADMIN_PASSWORD || undefined,
		secretKey: env.SECRET_KEY || undefined,
		cronSecret: env.CRON_SECRET || undefined,
		syncIntervalMinutes: positiveNumber(env.SYNC_INTERVAL_MINUTES, 360),
		enableMockSources: env.ENABLE_MOCK_SOURCES === 'true' || env.NODE_ENV !== 'production',
		tmdbToken: env.TMDB_READ_TOKEN || undefined,
		streamingRegion: /^[A-Za-z]{2}$/.test(env.STREAMING_REGION ?? '') ? env.STREAMING_REGION!.toUpperCase() : 'US',
		onVercel: Boolean(env.VERCEL)
	};
}

export const config = readConfig();
