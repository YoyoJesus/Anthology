import type { ExternalIds, MediaKind } from '#lib/types.ts';
import { joinUrl, sourceFetch, sourceJson, yearOf } from './http';
import type { Library, RawItem, SourceAdapter, SourceConfig } from './types';

const PAGE_SIZE = 200;

export interface JellyfinVirtualFolder {
	Name: string;
	ItemId: string;
	CollectionType?: string;
}

export interface JellyfinItem {
	Id: string;
	Name: string;
	Type: string;
	ServerId?: string;
	ProductionYear?: number;
	ProviderIds?: Record<string, string>;
	ImageTags?: Record<string, string>;
	DateCreated?: string;
	DateLastSaved?: string;
}

const LIBRARY_KINDS: Record<string, MediaKind> = { movies: 'movie', tvshows: 'show' };
const ITEM_TYPES: Partial<Record<MediaKind, string>> = { movie: 'Movie', show: 'Series' };

export function jellyfinLibraryKind(collectionType: string | undefined): MediaKind | null {
	return (collectionType && LIBRARY_KINDS[collectionType]) || null;
}

export function parseJellyfinProviderIds(ids: Record<string, string> | undefined): ExternalIds {
	const result: ExternalIds = {};
	for (const [key, value] of Object.entries(ids ?? {})) {
		const provider = key.toLowerCase();
		if (value && (provider === 'imdb' || provider === 'tmdb' || provider === 'tvdb')) result[provider] = value;
	}
	return result;
}

export function mapJellyfinItem(item: JellyfinItem, kind: MediaKind): RawItem {
	return {
		remoteId: item.Id,
		title: item.Name,
		year: yearOf(item.ProductionYear),
		kind,
		externalIds: parseJellyfinProviderIds(item.ProviderIds),
		posterRef: item.ImageTags?.Primary ? `/Items/${encodeURIComponent(item.Id)}/Images/Primary?maxHeight=600` : null,
		addedAt: item.DateCreated ?? null,
		updatedAt: item.DateLastSaved ?? null
	};
}

export function jellyfinDeepLink(baseUrl: string, serverId: string, itemId: string): string {
	return joinUrl(baseUrl, `/web/#/details?id=${encodeURIComponent(itemId)}&serverId=${encodeURIComponent(serverId)}`);
}

export function createJellyfinAdapter(source: SourceConfig): SourceAdapter {
	const headers = {
		Authorization: `MediaBrowser Client="Anthology", Device="Anthology", DeviceId="anthology-${source.id}", Version="0.1.0", Token="${source.token}"`
	};
	let serverId: string | undefined;

	async function identify(): Promise<string> {
		if (!serverId) {
			const info = await sourceJson<{ Id: string }>(joinUrl(source.baseUrl, '/System/Info'), headers);
			serverId = info.Id;
		}
		return serverId;
	}

	return {
		id: String(source.id),
		type: 'jellyfin',
		async testConnection() {
			await identify();
			return true;
		},
		async listLibraries() {
			await identify();
			const folders = await sourceJson<JellyfinVirtualFolder[]>(
				joinUrl(source.baseUrl, '/Library/VirtualFolders'),
				headers
			);
			const libraries: Library[] = [];
			for (const folder of folders) {
				const kind = jellyfinLibraryKind(folder.CollectionType);
				if (kind) libraries.push({ remoteId: folder.ItemId, name: folder.Name, kind });
			}
			return libraries;
		},
		async *fetchItems(library) {
			const itemType = ITEM_TYPES[library.kind];
			if (!itemType) return;
			for (let start = 0; ; start += PAGE_SIZE) {
				const params = new URLSearchParams({
					ParentId: library.remoteId,
					Recursive: 'true',
					IncludeItemTypes: itemType,
					Fields: 'ProviderIds,DateCreated,DateLastSaved',
					SortBy: 'SortName',
					StartIndex: String(start),
					Limit: String(PAGE_SIZE)
				});
				const res = await sourceJson<{ Items: JellyfinItem[]; TotalRecordCount: number }>(
					joinUrl(source.baseUrl, `/Items?${params}`),
					headers
				);
				for (const item of res.Items) yield mapJellyfinItem(item, library.kind);
				if (res.Items.length < PAGE_SIZE || start + res.Items.length >= res.TotalRecordCount) return;
			}
		},
		buildLink(item) {
			return jellyfinDeepLink(source.baseUrl, serverId ?? '', item.remoteId);
		},
		fetchPoster(posterRef) {
			return sourceFetch(joinUrl(source.baseUrl, posterRef), headers);
		}
	};
}
