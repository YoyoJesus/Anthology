import { describe, expect, it } from 'vitest';
import { decrypt, deriveKey, encrypt, hashPassword, verifyPassword } from '../src/lib/server/crypto';

describe('credential encryption', () => {
	const key = deriveKey('unit-test-secret');

	it('round-trips a token', () => {
		const payload = encrypt('token-123', key);
		expect(payload).not.toContain('token-123');
		expect(decrypt(payload, key)).toBe('token-123');
	});

	it('rejects a different key or tampered payload', () => {
		const payload = encrypt('token-123', key);
		expect(() => decrypt(payload, deriveKey('other-secret'))).toThrow();
		const parts = payload.split('.');
		parts[3] = Buffer.from('tampered').toString('base64');
		expect(() => decrypt(parts.join('.'), key)).toThrow();
		expect(() => decrypt('garbage', key)).toThrow('Unrecognized');
	});
});

describe('password hashing', () => {
	it('verifies the right password only', () => {
		const stored = hashPassword('correct horse');
		expect(verifyPassword('correct horse', stored)).toBe(true);
		expect(verifyPassword('wrong', stored)).toBe(false);
		expect(verifyPassword('correct horse', 'not-a-hash')).toBe(false);
	});
});
