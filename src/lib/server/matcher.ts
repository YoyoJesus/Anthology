import type { ExternalIds, MediaKind } from '#lib/types.ts';

export function normalizeTitle(title: string): string {
	return title
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/&/g, ' and ')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
		.replace(/^(the|a|an) /, '')
		.replace(/\s+/g, ' ');
}

export function matchKey(kind: MediaKind, title: string, year: number | null): string {
	return `${kind}|${normalizeTitle(title)}|${year ?? ''}`;
}

/** True when both sides carry an ID from the same provider and the values differ. */
export function idsConflict(a: ExternalIds, b: ExternalIds): boolean {
	for (const provider of Object.keys(a) as (keyof ExternalIds)[]) {
		const other = b[provider];
		if (other && a[provider] && other !== a[provider]) return true;
	}
	return false;
}

export function parseIds(json: string | null | undefined): ExternalIds {
	if (!json) return {};
	try {
		const value: unknown = JSON.parse(json);
		if (!value || typeof value !== 'object') return {};
		const ids: ExternalIds = {};
		for (const [key, v] of Object.entries(value)) {
			if (typeof v === 'string' && ['tmdb', 'imdb', 'tvdb', 'musicbrainz', 'igdb'].includes(key)) {
				ids[key as keyof ExternalIds] = v;
			}
		}
		return ids;
	} catch {
		return {};
	}
}
