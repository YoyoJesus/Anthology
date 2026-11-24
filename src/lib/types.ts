export const SOURCE_TYPES = [
	'plex',
	'jellyfin',
	'navidrome',
	'kodi',
	'roms',
	'collection',
	'streaming',
	'mock'
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const MEDIA_KINDS = ['movie', 'show', 'season', 'episode', 'album', 'track', 'artist', 'game'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export type ExternalIds = Partial<Record<'tmdb' | 'imdb' | 'tvdb' | 'musicbrainz' | 'igdb', string>>;

export interface SourceSummary {
	id: number;
	type: SourceType;
	name: string;
	baseUrl: string;
	enabled: boolean;
	lastSyncAt: string | null;
	lastSyncError: string | null;
	libraryCount: number;
	itemCount: number;
}

export interface WorkSource {
	sourceId: number;
	sourceName: string;
	sourceType: SourceType;
}

export interface WorkCard {
	id: number;
	title: string;
	year: number | null;
	kind: MediaKind;
	/** Same-origin poster URL, or null to show the title instead. */
	posterUrl: string | null;
	/** TMDB audience rating out of 10. */
	rating: number | null;
	sources: WorkSource[];
	streaming: StreamingServiceId[];
}

export interface WorkItem {
	id: number;
	title: string;
	year: number | null;
	linkUrl: string;
	sourceId: number;
	sourceName: string;
	sourceType: SourceType;
	libraryName: string;
	externalIds: ExternalIds;
}

export const STREAMING_SERVICES = [
	{ id: 'netflix', name: 'Netflix' },
	{ id: 'prime', name: 'Prime Video' },
	{ id: 'hulu', name: 'Hulu' },
	{ id: 'disney', name: 'Disney+' },
	{ id: 'appletv', name: 'Apple TV+' }
] as const;
export type StreamingServiceId = (typeof STREAMING_SERVICES)[number]['id'];
