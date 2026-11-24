import type { SourceAdapter } from './adapters/types';

const POSTER_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']);
const MAX_POSTER_BYTES = 10 * 1024 * 1024;

/** Fetch artwork through the source's adapter so credentials stay on the server. Only images are passed on. */
export async function loadPoster(
	adapter: SourceAdapter,
	posterRef: string
): Promise<{ body: ArrayBuffer; contentType: string }> {
	const res = await adapter.fetchPoster(posterRef);
	const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
	if (!POSTER_TYPES.has(contentType)) throw new Error(`Unsupported poster type "${contentType}"`);
	const body = await res.arrayBuffer();
	if (body.byteLength > MAX_POSTER_BYTES) throw new Error('Poster is too large');
	return { body, contentType };
}
