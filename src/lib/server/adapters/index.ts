import type { SourceType } from '#lib/types.ts';
import { createCollectionAdapter } from './collection';
import { createJellyfinAdapter } from './jellyfin';
import { createMockAdapter } from './mock';
import { createPlexAdapter } from './plex';
import { createStreamingAdapter } from './streaming';
import type { SourceAdapter, SourceConfig } from './types';

const FACTORIES: Partial<Record<SourceType, (source: SourceConfig) => SourceAdapter>> = {
	plex: createPlexAdapter,
	jellyfin: createJellyfinAdapter,
	collection: createCollectionAdapter,
	streaming: createStreamingAdapter,
	mock: createMockAdapter
};

/** Types the user can add by hand. Streaming sources follow the services ticked in Settings. */
export function supportedSourceTypes(includeMock: boolean): SourceType[] {
	return (Object.keys(FACTORIES) as SourceType[]).filter(
		(type) => type !== 'streaming' && (includeMock || type !== 'mock')
	);
}

export function createAdapter(source: SourceConfig): SourceAdapter {
	const factory = FACTORIES[source.type];
	if (!factory) throw new Error(`No adapter for source type "${source.type}" yet`);
	return factory(source);
}
