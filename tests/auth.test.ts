import { describe, expect, it } from 'vitest';
import {
	SESSION_TTL_MS,
	checkPassword,
	clearFailures,
	createSession,
	deleteSession,
	isRateLimited,
	isSetupComplete,
	recordFailure,
	setAdminPassword,
	validateSession
} from '../src/lib/server/auth';
import { memoryDb } from './helpers';

describe('admin password', () => {
	it('requires setup until a password exists', async () => {
		const db = await memoryDb();
		expect(await isSetupComplete(db, undefined)).toBe(false);
		await setAdminPassword(db, 'longenough');
		expect(await isSetupComplete(db, undefined)).toBe(true);
		expect(await checkPassword(db, 'longenough', undefined)).toBe(true);
		expect(await checkPassword(db, 'nope', undefined)).toBe(false);
	});

	it('prefers ADMIN_PASSWORD when set', async () => {
		const db = await memoryDb();
		expect(await isSetupComplete(db, 'from-env')).toBe(true);
		expect(await checkPassword(db, 'from-env', 'from-env')).toBe(true);
		expect(await checkPassword(db, 'from-env!', 'from-env')).toBe(false);
	});
});

describe('sessions', () => {
	it('validates until expiry or logout', async () => {
		const db = await memoryDb();
		const now = Date.now();
		const { token } = await createSession(db, now);
		expect(await validateSession(db, token, now)).toBe(true);
		expect(await validateSession(db, token, now + SESSION_TTL_MS + 1)).toBe(false);
		expect(await validateSession(db, 'forged', now)).toBe(false);
		expect(await validateSession(db, undefined, now)).toBe(false);
		await deleteSession(db, token);
		expect(await validateSession(db, token, now)).toBe(false);
	});
});

describe('login rate limit', () => {
	it('blocks after repeated failures, expires and resets', async () => {
		const db = await memoryDb();
		const client = 'test-client';
		for (let i = 0; i < 9; i++) await recordFailure(db, client, 1000);
		expect(await isRateLimited(db, client, 1000)).toBe(false);
		await recordFailure(db, client, 1000);
		expect(await isRateLimited(db, client, 1000)).toBe(true);
		expect(await isRateLimited(db, client, 1000 + 16 * 60 * 1000)).toBe(false);
		await recordFailure(db, client, 1000 + 16 * 60 * 1000);
		expect(await isRateLimited(db, client, 1000 + 16 * 60 * 1000)).toBe(false);
		await clearFailures(db, client);
		expect(await isRateLimited(db, client, 1000)).toBe(false);
	});
});
