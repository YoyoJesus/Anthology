import type { ExternalIds, MediaKind } from '#lib/types.ts';
import { joinUrl, sourceFetch, sourceJson, yearOf } from './http';
import type { Library, RawItem, SourceAdapter, SourceConfig } from './types';

const PAGE_SIZE = 200;

export interface PlexDirectory {
	key: string;
	title: string;
	type: string;
}

export interface PlexMetadata {
	ratingKey: string;
	title: string;
	type: string;
	year?: number;
	thumb?: string;
	addedAt?: number;
	updatedAt?: number;
	Guid?: { id: string }[];
}

interface PlexContainer<T> {
	MediaContainer: T;
}

const LIBRARY_KINDS: Record<string, MediaKind> = { movie: 'movie', show: 'show' };

export function plexLibraryKind(type: string): MediaKind | null {
	return LIBRARY_KINDS[type] ?? null;
}

export function parsePlexGuids(guids: { id: string }[] | undefined): ExternalIds {
	const ids: ExternalIds = {};
	for (const { id } of guids ?? []) {
		const match = /^(imdb|tmdb|tvdb):\/\/(.+)$/.exec(id);
		if (match) ids[match[1] as 'imdb' | 'tmdb' | 'tvdb'] = match[2];
	}
	return ids;
}

function epochToIso(value: number | undefined): string | null {
	return value ? new Date(value * 1000).toISOString() : null;
}

export function mapPlexMetadata(meta: PlexMetadata, kind: MediaKind): RawItem {
	return {
		remoteId: String(meta.ratingKey),
		title: meta.title,
		year: yearOf(meta.year),
		kind,
		externalIds: parsePlexGuids(meta.Guid),
		posterRef: meta.thumb ?? null,
		addedAt: epochToIso(meta.addedAt),
		updatedAt: epochToIso(meta.updatedAt)
	};
}

export function plexDeepLink(baseUrl: string, machineId: string, ratingKey: string): string {
	const key = encodeURIComponent(`/library/metadata/${ratingKey}`);
	return joinUrl(baseUrl, `/web/index.html#!/server/${machineId}/details?key=${key}`);
}

export function createPlexAdapter(source: SourceConfig): SourceAdapter {
	const headers = {
		'X-Plex-Token': source.token,
		'X-Plex-Product': 'Anthology',
		'X-Plex-Client-Identifier': `anthology-${source.id}`
	};
	let machineId: string | undefined;

	async function identify(): Promise<string> {
		if (!machineId) {
			const res = await sourceJson<PlexContainer<{ machineIdentifier: string }>>(
				joinUrl(source.baseUrl, '/identity'),
				headers
			);
			machineId = res.MediaContainer.machineIdentifier;
		}
		return machineId;
	}

	return {
		id: String(source.id),
		type: 'plex',
		async testConnection() {
			await identify();
			await sourceJson(joinUrl(source.baseUrl, '/library/sections'), headers);
			return true;
		},
		async listLibraries() {
			await identify();
			const res = await sourceJson<PlexContainer<{ Directory?: PlexDirectory[] }>>(
				joinUrl(source.baseUrl, '/library/sections'),
				headers
			);
			const libraries: Library[] = [];
			for (const dir of res.MediaContainer.Directory ?? []) {
				const kind = plexLibraryKind(dir.type);
				if (kind) libraries.push({ remoteId: dir.key, name: dir.title, kind });
			}
			return libraries;
		},
		async *fetchItems(library) {
			for (let start = 0; ; start += PAGE_SIZE) {
				const url = joinUrl(source.baseUrl, `/library/sections/${encodeURIComponent(library.remoteId)}/all`);
				const res = await sourceJson<PlexContainer<{ Metadata?: PlexMetadata[]; totalSize?: number; size: number }>>(
					`${url}?includeGuids=1`,
					{ ...headers, 'X-Plex-Container-Start': String(start), 'X-Plex-Container-Size': String(PAGE_SIZE) }
				);
				const page = res.MediaContainer.Metadata ?? [];
				for (const meta of page) yield mapPlexMetadata(meta, library.kind);
				const total = res.MediaContainer.totalSize ?? start + page.length;
				if (page.length < PAGE_SIZE || start + page.length >= total) return;
			}
		},
		buildLink(item) {
			return plexDeepLink(source.baseUrl, machineId ?? '', item.remoteId);
		},
		fetchPoster(posterRef) {
			return sourceFetch(joinUrl(source.baseUrl, posterRef), headers);
		}
	};
}
