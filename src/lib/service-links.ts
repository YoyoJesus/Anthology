import { STREAMING_SERVICES, type StreamingServiceId } from './types.ts';

/** TMDB has no per-service deep links, so open the service's own search for the title. */
const SEARCH: Record<StreamingServiceId, (query: string) => string> = {
	netflix: (q) => `https://www.netflix.com/search?q=${q}`,
	prime: (q) => `https://www.primevideo.com/search/?phrase=${q}`,
	hulu: (q) => `https://www.hulu.com/search?q=${q}`,
	disney: (q) => `https://www.disneyplus.com/search?q=${q}`,
	appletv: (q) => `https://tv.apple.com/search?term=${q}`
};

export function serviceSearchUrl(service: StreamingServiceId, title: string): string {
	return SEARCH[service](encodeURIComponent(title));
}

/** Services a title is on that are not already shown as one of its sources, so each service appears once. */
export function servicesNotListed(
	streaming: readonly StreamingServiceId[],
	sources: readonly { sourceType: string; sourceName: string }[]
): StreamingServiceId[] {
	const listed = new Set(sources.filter((s) => s.sourceType === 'streaming').map((s) => s.sourceName));
	return streaming.filter((id) => !listed.has(STREAMING_SERVICES.find((s) => s.id === id)?.name ?? id));
}
