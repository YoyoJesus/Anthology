import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';

export function deriveKey(secret: string): Buffer {
	return scryptSync(secret, 'anthology-credentials', 32);
}

export function encrypt(plaintext: string, key: Buffer): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv(ALGORITHM, key, iv);
	const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join('.');
}

export function decrypt(payload: string, key: Buffer): string {
	const [version, iv, tag, body] = payload.split('.');
	if (version !== 'v1' || !iv || !tag || body === undefined) throw new Error('Unrecognized credential format');
	const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
	decipher.setAuthTag(Buffer.from(tag, 'base64'));
	return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8');
}

export function hashPassword(password: string): string {
	const salt = randomBytes(16);
	const hash = scryptSync(password, salt, 64);
	return `scrypt.${salt.toString('base64')}.${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
	const [scheme, salt, hash] = stored.split('.');
	if (scheme !== 'scrypt' || !salt || !hash) return false;
	const expected = Buffer.from(hash, 'base64');
	const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length);
	return timingSafeEqual(actual, expected);
}

export function randomToken(): string {
	return randomBytes(32).toString('base64url');
}

export function sha256(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}
