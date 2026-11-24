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
	it('requires setup until a password exists', () => {
		const db = memoryDb();
		expect(isSetupComplete(db, undefined)).toBe(false);
		setAdminPassword(db, 'longenough');
		expect(isSetupComplete(db, undefined)).toBe(true);
		expect(checkPassword(db, 'longenough', undefined)).toBe(true);
		expect(checkPassword(db, 'nope', undefined)).toBe(false);
	});

	it('prefers ADMIN_PASSWORD when set', () => {
		const db = memoryDb();
		expect(isSetupComplete(db, 'from-env')).toBe(true);
		expect(checkPassword(db, 'from-env', 'from-env')).toBe(true);
		expect(checkPassword(db, 'from-env!', 'from-env')).toBe(false);
	});
});

describe('sessions', () => {
	it('validates until expiry or logout', () => {
		const db = memoryDb();
		const now = Date.now();
		const { token } = createSession(db, now);
		expect(validateSession(db, token, now)).toBe(true);
		expect(validateSession(db, token, now + SESSION_TTL_MS + 1)).toBe(false);
		expect(validateSession(db, 'forged', now)).toBe(false);
		expect(validateSession(db, undefined, now)).toBe(false);
		deleteSession(db, token);
		expect(validateSession(db, token, now)).toBe(false);
	});
});

describe('login rate limit', () => {
	it('blocks after repeated failures and resets', () => {
		const key = 'test-client';
		for (let i = 0; i < 10; i++) recordFailure(key, 1000);
		expect(isRateLimited(key, 1000)).toBe(true);
		expect(isRateLimited(key, 1000 + 16 * 60 * 1000)).toBe(false);
		clearFailures(key);
		expect(isRateLimited(key, 1000)).toBe(false);
	});
});
