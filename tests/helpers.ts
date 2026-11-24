import { openDb, type DB } from '../src/lib/server/db';
import { createMockAdapter } from '../src/lib/server/adapters/mock';
import { createSource } from '../src/lib/server/sources';
import { deriveKey } from '../src/lib/server/crypto';

export const testKey = deriveKey('test-secret');

export function memoryDb(): DB {
	return openDb(':memory:');
}

export function addMockSource(db: DB, name: string, dataset: string) {
	const id = createSource(db, { type: 'mock', name, baseUrl: 'mock://local', token: dataset }, testKey);
	return { id, adapter: createMockAdapter({ id, type: 'mock', name, baseUrl: 'mock://local', token: dataset }) };
}
