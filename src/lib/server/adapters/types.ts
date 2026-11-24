import type { ExternalIds, MediaKind, SourceType } from '#lib/types.ts';

export interface Library {
	remoteId: string;
	name: string;
	kind: MediaKind;
}

export interface RawItem {
	remoteId: string;
	title: string;
	year: number | null;
	kind: MediaKind;
	externalIds: ExternalIds;
	posterRef: string | null;
	addedAt: string | null;
	updatedAt: string | null;
}

export interface SourceConfig {
	id: number;
	type: SourceType;
	name: string;
	baseUrl: string;
	token: string;
}

export interface SourceAdapter {
	id: string;
	type: SourceType;
	testConnection(): Promise<boolean>;
	listLibraries(): Promise<Library[]>;
	fetchItems(library: Library, since?: Date): AsyncIterable<RawItem>;
	/** Deep link to the item on its source server. Call after listLibraries(). */
	buildLink(item: RawItem): string;
	/** Fetch artwork for a posterRef, with whatever auth the source needs. */
	fetchPoster(posterRef: string): Promise<Response>;
}
