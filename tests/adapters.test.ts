import { afterEach, describe, expect, it, vi } from 'vitest';
import { createJellyfinAdapter, mapJellyfinItem, jellyfinLibraryKind } from '../src/lib/server/adapters/jellyfin';
import { createPlexAdapter, mapPlexMetadata, parsePlexGuids, plexDeepLink } from '../src/lib/server/adapters/plex';
import type { RawItem } from '../src/lib/server/adapters/types';

const source = { id: 7, name: 'Test', baseUrl: 'http://media.test:8096/', token: 'secret-token' };

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function collect(iter: AsyncIterable<RawItem>): Promise<RawItem[]> {
	const out: RawItem[] = [];
	for await (const item of iter) out.push(item);
	return out;
}

afterEach(() => vi.unstubAllGlobals());

describe('Plex', () => {
	it('parses GUIDs and metadata', () => {
		expect(parsePlexGuids([{ id: 'imdb://tt0001' }, { id: 'tmdb://42' }, { id: 'plex://movie/abc' }])).toEqual({
			imdb: 'tt0001',
			tmdb: '42'
		});
		const item = mapPlexMetadata({ ratingKey: '55', title: 'Example', type: 'movie', year: 2001, addedAt: 0 }, 'movie');
		expect(item).toMatchObject({ remoteId: '55', year: 2001, posterRef: null, addedAt: null });
	});

	it('builds a web deep link', () => {
		expect(plexDeepLink('http://plex.test:32400/', 'abc', '55')).toBe(
			'http://plex.test:32400/web/index.html#!/server/abc/details?key=%2Flibrary%2Fmetadata%2F55'
		);
	});

	it('lists movie and show libraries and pages through items', async () => {
		const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
			const headers = init.headers as Record<string, string>;
			expect(headers['X-Plex-Token']).toBe('secret-token');
			if (url.endsWith('/identity')) return json({ MediaContainer: { machineIdentifier: 'm1' } });
			if (url.endsWith('/library/sections'))
				return json({
					MediaContainer: {
						Directory: [
							{ key: '1', title: 'Movies', type: 'movie' },
							{ key: '2', title: 'Photos', type: 'photo' }
						]
					}
				});
			const start = Number(headers['X-Plex-Container-Start']);
			const total = 250;
			const size = Math.min(200, total - start);
			const Metadata = Array.from({ length: size }, (_, i) => ({
				ratingKey: String(start + i),
				title: `T${start + i}`,
				type: 'movie'
			}));
			return json({ MediaContainer: { Metadata, size, totalSize: total } });
		});
		vi.stubGlobal('fetch', fetchMock);
		const adapter = createPlexAdapter({ ...source, type: 'plex' });
		const libraries = await adapter.listLibraries();
		expect(libraries).toEqual([{ remoteId: '1', name: 'Movies', kind: 'movie' }]);
		const items = await collect(adapter.fetchItems(libraries[0]));
		expect(items).toHaveLength(250);
		expect(adapter.buildLink(items[0])).toContain('/server/m1/');
	});

	it('reports rejected credentials without leaking the token', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => json({}, 401))
		);
		const adapter = createPlexAdapter({ ...source, type: 'plex' });
		const err = await adapter.testConnection().catch((e: Error) => e);
		expect(err).toBeInstanceOf(Error);
		expect((err as Error).message).toBe('Source rejected the credentials');
		expect((err as Error).message).not.toContain('secret-token');
	});
});

describe('Jellyfin', () => {
	it('maps library kinds and provider IDs', () => {
		expect(jellyfinLibraryKind('movies')).toBe('movie');
		expect(jellyfinLibraryKind('music')).toBeNull();
		const item = mapJellyfinItem(
			{
				Id: 'abc',
				Name: 'Example',
				Type: 'Series',
				ProductionYear: 2010,
				ProviderIds: { Tvdb: '9', Imdb: '', Foo: '1' },
				ImageTags: { Primary: 'x' }
			},
			'show'
		);
		expect(item.externalIds).toEqual({ tvdb: '9' });
		expect(item.posterRef).toBe('/Items/abc/Images/Primary?maxHeight=600');
	});

	it('syncs libraries, pages items and links back to the server', async () => {
		const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
			expect((init.headers as Record<string, string>).Authorization).toContain('Token="secret-token"');
			if (url.endsWith('/System/Info')) return json({ Id: 'srv1' });
			if (url.endsWith('/Library/VirtualFolders'))
				return json([
					{ Name: 'Shows', ItemId: 'lib1', CollectionType: 'tvshows' },
					{ Name: 'Music', ItemId: 'lib2', CollectionType: 'music' }
				]);
			const params = new URL(url).searchParams;
			expect(params.get('IncludeItemTypes')).toBe('Series');
			return json({ Items: [{ Id: 's1', Name: 'Show One', Type: 'Series' }], TotalRecordCount: 1 });
		});
		vi.stubGlobal('fetch', fetchMock);
		const adapter = createJellyfinAdapter({ ...source, type: 'jellyfin' });
		const libraries = await adapter.listLibraries();
		expect(libraries).toEqual([{ remoteId: 'lib1', name: 'Shows', kind: 'show' }]);
		const items = await collect(adapter.fetchItems(libraries[0]));
		expect(adapter.buildLink(items[0])).toBe('http://media.test:8096/web/#/details?id=s1&serverId=srv1');
	});
});
