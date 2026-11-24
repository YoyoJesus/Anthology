import { describe, expect, it } from 'vitest';
import { readConfig } from '../src/lib/server/config.ts';

describe('readConfig database', () => {
	it('reads the Turso variable names', () => {
		const config = readConfig({ TURSO_DATABASE_URL: 'libsql://example.turso.io', TURSO_AUTH_TOKEN: 'synthetic-token' });
		expect(config.databaseUrl).toBe('libsql://example.turso.io');
		expect(config.databaseAuthToken).toBe('synthetic-token');
	});

	it('still accepts the older DATABASE_ names', () => {
		const config = readConfig({ DATABASE_URL: 'libsql://older.turso.io', DATABASE_AUTH_TOKEN: 'older-token' });
		expect(config.databaseUrl).toBe('libsql://older.turso.io');
		expect(config.databaseAuthToken).toBe('older-token');
	});

	it('falls back to a local file', () => {
		const config = readConfig({ DATA_DIR: '/tmp/anthology-test' });
		expect(config.databaseUrl).toBe('file:/tmp/anthology-test/anthology.db');
		expect(config.databaseAuthToken).toBeUndefined();
	});
});

describe('databaseLabel', () => {
	it('names the host without the token, or a local file', async () => {
		const { databaseLabel } = await import('../src/lib/server/db');
		expect(databaseLabel('libsql://anthology-example.turso.io')).toBe('Turso (anthology-example.turso.io)');
		expect(databaseLabel('file:/data/anthology.db')).toBe('Local file');
	});
});
