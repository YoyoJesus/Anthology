import { describe, expect, it } from 'vitest';
import { createMockAdapter } from '../src/lib/server/adapters/mock';
import type { SourceAdapter } from '../src/lib/server/adapters/types';
import { loadPoster } from '../src/lib/server/posters';

const adapter = createMockAdapter({ id: 1, type: 'mock', name: 'Sample', baseUrl: 'mock://local', token: 'alpha' });

describe('loadPoster', () => {
	it('passes images through', async () => {
		const poster = await loadPoster(adapter, 'The Glass Orchard|2019');
		expect(poster.contentType).toBe('image/svg+xml');
		expect(poster.body.byteLength).toBeGreaterThan(0);
	});

	it('refuses responses that are not images', async () => {
		const html: SourceAdapter = {
			...adapter,
			fetchPoster: async () => new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } })
		};
		await expect(loadPoster(html, 'x')).rejects.toThrow('Unsupported');
	});
});
