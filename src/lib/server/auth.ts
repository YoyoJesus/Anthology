import { timingSafeEqual } from 'node:crypto';
import { config } from './config';
import { hashPassword, randomToken, sha256, verifyPassword } from './crypto';
import { getSetting, setSetting, type DB } from './db';

export const SESSION_COOKIE = 'anthology_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MIN_PASSWORD_LENGTH = 8;

export function isSetupComplete(db: DB, envPassword = config.adminPassword): boolean {
	return Boolean(envPassword) || getSetting(db, 'admin_password_hash') !== undefined;
}

export function setAdminPassword(db: DB, password: string): void {
	setSetting(db, 'admin_password_hash', hashPassword(password));
}

export function checkPassword(db: DB, password: string, envPassword = config.adminPassword): boolean {
	if (envPassword) {
		return timingSafeEqual(Buffer.from(sha256(password)), Buffer.from(sha256(envPassword)));
	}
	const stored = getSetting(db, 'admin_password_hash');
	return stored ? verifyPassword(password, stored) : false;
}

export function createSession(db: DB, now = Date.now()): { token: string; expires: Date } {
	const token = randomToken();
	const expires = new Date(now + SESSION_TTL_MS);
	db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
	db.prepare('INSERT INTO sessions (token_hash, expires_at) VALUES (?, ?)').run(sha256(token), expires.getTime());
	return { token, expires };
}

export function validateSession(db: DB, token: string | undefined, now = Date.now()): boolean {
	if (!token) return false;
	const row = db.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').get(sha256(token)) as
		{ expires_at: number } | undefined;
	return Boolean(row && row.expires_at > now);
}

export function deleteSession(db: DB, token: string): void {
	db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const failures = new Map<string, { count: number; since: number }>();

export function isRateLimited(key: string, now = Date.now()): boolean {
	const entry = failures.get(key);
	return Boolean(entry && now - entry.since < WINDOW_MS && entry.count >= MAX_FAILURES);
}

export function recordFailure(key: string, now = Date.now()): void {
	const entry = failures.get(key);
	if (!entry || now - entry.since >= WINDOW_MS) failures.set(key, { count: 1, since: now });
	else entry.count += 1;
}

export function clearFailures(key: string): void {
	failures.delete(key);
}
