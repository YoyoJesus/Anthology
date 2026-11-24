import { serviceName, type StreamingServiceId } from './streaming-services.ts';

export { serviceSearchUrl } from './streaming-services.ts';

/** Services a title is on that are not already shown as one of its sources, so each service appears once. */
export function servicesNotListed(
	streaming: readonly StreamingServiceId[],
	sources: readonly { sourceType: string; sourceName: string }[]
): StreamingServiceId[] {
	const listed = new Set(sources.filter((s) => s.sourceType === 'streaming').map((s) => s.sourceName));
	return streaming.filter((id) => !listed.has(serviceName(id)));
}
