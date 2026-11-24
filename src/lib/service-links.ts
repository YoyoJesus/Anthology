import type { StreamingServiceId } from './types.ts';

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
