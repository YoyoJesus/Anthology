import type { SourceType } from '#lib/types.ts';
import { createJellyfinAdapter } from './jellyfin';
import { createMockAdapter } from './mock';
import { createPlexAdapter } from './plex';
import type { SourceAdapter, SourceConfig } from './types';

const FACTORIES: Partial<Record<SourceType, (source: SourceConfig) => SourceAdapter>> = {
	plex: createPlexAdapter,
	jellyfin: createJellyfinAdapter,
	mock: createMockAdapter
};

export function supportedSourceTypes(includeMock: boolean): SourceType[] {
	return (Object.keys(FACTORIES) as SourceType[]).filter((type) => includeMock || type !== 'mock');
}

export function createAdapter(source: SourceConfig): SourceAdapter {
	const factory = FACTORIES[source.type];
	if (!factory) throw new Error(`No adapter for source type "${source.type}" yet`);
	return factory(source);
}
