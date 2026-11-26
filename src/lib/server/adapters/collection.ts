import type { MediaKind } from '#lib/types.ts';
import { normalizeTitle } from '../matcher';
import type { RawItem, SourceAdapter, SourceConfig } from './types';

export const MAX_COLLECTION_LINES = 5000;
const MAX_TITLE_LENGTH = 200;

export interface CollectionEntry {
	title: string;
	year: number | null;
	kind: MediaKind;
}

export interface ParsedCollection {
	entries: CollectionEntry[];
	skipped: number[];
}

/**
 * One title per line: `Title (Year)`, or just `Title`. Prefix `TV:` for a show.
 * Blank lines and lines starting with `#` are ignored. Duplicates are dropped.
 */
export function parseCollection(text: string): ParsedCollection {
	const entries: CollectionEntry[] = [];
	const skipped: number[] = [];
	const seen = new Set<string>();
	const lines = text.split(/\r?\n/).slice(0, MAX_COLLECTION_LINES);

	lines.forEach((raw, index) => {
		let line = raw.trim();
		if (!line || line.startsWith('#')) return;
		let kind: MediaKind = 'movie';
		const tv = /^tv\s*:\s*/i.exec(line);
		if (tv) {
			kind = 'show';
			line = line.slice(tv[0].length);
		}
		let year: number | null = null;
		const withYear = /^(.*?)\s*\((\d{4})\)$/.exec(line);
		if (withYear) {
			const n = Number(withYear[2]);
			if (n > 1800 && n < 3000) {
				year = n;
				line = withYear[1].trim();
			}
		}
		if (!line || line.length > MAX_TITLE_LENGTH || !normalizeTitle(line)) {
			skipped.push(index + 1);
			return;
		}
		const key = entryKey({ title: line, year, kind });
		if (seen.has(key)) return;
		seen.add(key);
		entries.push({ title: line, year, kind });
	});
	return { entries, skipped };
}

function entryKey(entry: CollectionEntry): string {
	return `${entry.kind}|${normalizeTitle(entry.title)}|${entry.year ?? ''}`;
}

export type AddResult = { status: 'added'; body: string } | { status: 'duplicate' | 'invalid' | 'full' };

/** Appends one title to a collection list, unless it is already there or would not read back as the same title. */
export function addToCollection(body: string, entry: CollectionEntry): AddResult {
	const line = `${entry.kind === 'show' ? 'TV: ' : ''}${entry.title.trim()}${entry.year ? ` (${entry.year})` : ''}`;
	const parsed = parseCollection(line).entries;
	if (parsed.length !== 1 || entryKey(parsed[0]) !== entryKey(entry)) return { status: 'invalid' };
	if (parseCollection(body).entries.some((e) => entryKey(e) === entryKey(entry))) return { status: 'duplicate' };
	const trimmed = body.replace(/\s+$/, '');
	if (trimmed.split('\n').length >= MAX_COLLECTION_LINES) return { status: 'full' };
	return { status: 'added', body: trimmed ? `${trimmed}\n${line}` : line };
}

function remoteId(entry: CollectionEntry): string {
	return `${entry.kind}:${normalizeTitle(entry.title).replace(/ /g, '-')}:${entry.year ?? ''}`;
}

export function createCollectionAdapter(source: SourceConfig): SourceAdapter {
	const { entries } = parseCollection(source.collection ?? '');

	return {
		id: String(source.id),
		type: 'collection',
		async testConnection() {
			return true;
		},
		async listLibraries() {
			const libraries = [];
			if (entries.some((e) => e.kind === 'movie'))
				libraries.push({ remoteId: 'movies', name: 'Movies', kind: 'movie' as const });
			if (entries.some((e) => e.kind === 'show'))
				libraries.push({ remoteId: 'shows', name: 'TV Shows', kind: 'show' as const });
			return libraries;
		},
		async *fetchItems(library) {
			for (const entry of entries) {
				if (entry.kind !== library.kind) continue;
				const item: RawItem = {
					remoteId: remoteId(entry),
					title: entry.title,
					year: entry.year,
					kind: entry.kind,
					externalIds: {},
					posterRef: null,
					addedAt: null,
					updatedAt: null
				};
				yield item;
			}
		},
		buildLink() {
			return '';
		},
		async fetchPoster() {
			throw new Error('Collections have no artwork');
		}
	};
}
