import { timingSafeEqual } from 'node:crypto';
import { config } from './config';
import { hashPassword, randomToken, sha256, verifyPassword } from './crypto';
import { get, getSetting, run, setSetting, type DB } from './db';

export const SESSION_COOKIE = 'anthology_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MIN_PASSWORD_LENGTH = 8;

export async function isSetupComplete(db: DB, envPassword = config.adminPassword): Promise<boolean> {
	return Boolean(envPassword) || (await getSetting(db, 'admin_password_hash')) !== undefined;
}

export async function setAdminPassword(db: DB, password: string): Promise<void> {
	await setSetting(db, 'admin_password_hash', hashPassword(password));
}

export async function checkPassword(db: DB, password: string, envPassword = config.adminPassword): Promise<boolean> {
	if (envPassword) {
		return timingSafeEqual(Buffer.from(sha256(password)), Buffer.from(sha256(envPassword)));
	}
	const stored = await getSetting(db, 'admin_password_hash');
	return stored ? verifyPassword(password, stored) : false;
}

export async function createSession(db: DB, now = Date.now()): Promise<{ token: string; expires: Date }> {
	const token = randomToken();
	const expires = new Date(now + SESSION_TTL_MS);
	await db.batch(
		[
			{ sql: 'DELETE FROM sessions WHERE expires_at < ?', args: [now] },
			{ sql: 'INSERT INTO sessions (token_hash, expires_at) VALUES (?, ?)', args: [sha256(token), expires.getTime()] }
		],
		'write'
	);
	return { token, expires };
}

export async function validateSession(db: DB, token: string | undefined, now = Date.now()): Promise<boolean> {
	if (!token) return false;
	const row = await get<{ expires_at: number }>(db, 'SELECT expires_at FROM sessions WHERE token_hash = ?', [
		sha256(token)
	]);
	return Boolean(row && Number(row.expires_at) > now);
}

export async function deleteSession(db: DB, token: string): Promise<void> {
	await run(db, 'DELETE FROM sessions WHERE token_hash = ?', [sha256(token)]);
}

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;

/** Failures are kept in the database so the limit holds across serverless instances. */
export async function isRateLimited(db: DB, client: string, now = Date.now()): Promise<boolean> {
	const row = await get<{ count: number; since: number }>(
		db,
		'SELECT count, since FROM login_failures WHERE client = ?',
		[client]
	);
	return Boolean(row && now - Number(row.since) < WINDOW_MS && Number(row.count) >= MAX_FAILURES);
}

export async function recordFailure(db: DB, client: string, now = Date.now()): Promise<void> {
	await run(
		db,
		`INSERT INTO login_failures (client, count, since) VALUES (?, 1, ?)
		ON CONFLICT(client) DO UPDATE SET
			count = CASE WHEN ? - login_failures.since >= ? THEN 1 ELSE login_failures.count + 1 END,
			since = CASE WHEN ? - login_failures.since >= ? THEN excluded.since ELSE login_failures.since END`,
		[client, now, now, WINDOW_MS, now, WINDOW_MS]
	);
}

export async function clearFailures(db: DB, client: string): Promise<void> {
	await run(db, 'DELETE FROM login_failures WHERE client = ?', [client]);
}
