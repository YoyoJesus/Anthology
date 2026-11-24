import type { ExternalIds, MediaKind } from '#lib/types.ts';
import type { Library, RawItem, SourceAdapter, SourceConfig } from './types';

interface MockEntry {
	title: string;
	year: number;
	kind: MediaKind;
	ids?: ExternalIds;
}

/** Invented titles and IDs so the matcher and UI can be exercised without a real server. */
const SHARED: MockEntry[] = [
	{ title: 'The Glass Orchard', year: 2019, kind: 'movie', ids: { tmdb: '900001', imdb: 'tt9900001' } },
	{ title: 'Harbor Lights', year: 2021, kind: 'movie', ids: { tmdb: '900002' } },
	{ title: 'Northbound', year: 2016, kind: 'movie' },
	{ title: 'Paper Satellites', year: 2023, kind: 'movie', ids: { imdb: 'tt9900004' } },
	{ title: 'Low Tide Club', year: 2018, kind: 'show', ids: { tvdb: '800001' } },
	{ title: 'The Lantern Office', year: 2020, kind: 'show' }
];

const DATASETS: Record<string, MockEntry[]> = {
	alpha: [
		...SHARED,
		{ title: 'Copper Valley', year: 2015, kind: 'movie', ids: { tmdb: '900010' } },
		{ title: 'Midnight Cartography', year: 2022, kind: 'movie' },
		{ title: 'Static Bloom', year: 2017, kind: 'movie', ids: { tmdb: '900012' } },
		{ title: 'Ferris & Finch', year: 2024, kind: 'show', ids: { tvdb: '800010' } },
		{ title: 'Second Draft', year: 2012, kind: 'movie' }
	],
	beta: [
		...SHARED.map((entry) => (entry.title === 'Northbound' ? { ...entry, title: 'Northbound!' } : entry)),
		{ title: 'Quiet Engines', year: 2020, kind: 'movie', ids: { tmdb: '900020' } },
		{ title: 'Second Draft', year: 2025, kind: 'movie' },
		{ title: 'The Weather Room', year: 2019, kind: 'show', ids: { tvdb: '800020' } },
		{ title: 'Saltwater Kings', year: 2014, kind: 'movie' }
	]
};

export const MOCK_DATASETS = Object.keys(DATASETS);

function slug(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

function hue(text: string): number {
	let h = 0;
	for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 360;
	return h;
}

function escapeXml(text: string): string {
	return text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function mockPosterSvg(title: string, year: number): string {
	const h = hue(title);
	const words = title.split(' ');
	const lines = words.reduce<string[]>((acc, word) => {
		const last = acc[acc.length - 1];
		if (last && (last + ' ' + word).length <= 12) acc[acc.length - 1] = `${last} ${word}`;
		else acc.push(word);
		return acc;
	}, []);
	const text = lines
		.map((line, i) => `<text x="24" y="${300 + i * 34}" font-size="30" font-weight="700">${escapeXml(line)}</text>`)
		.join('');
	return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${h} 45% 38%)"/><stop offset="1" stop-color="hsl(${(h + 40) % 360} 50% 16%)"/></linearGradient></defs><rect width="300" height="450" fill="url(#g)"/><circle cx="220" cy="110" r="64" fill="hsl(${(h + 180) % 360} 60% 70%)" opacity="0.35"/><g fill="#fff" font-family="Georgia, serif">${text}<text x="24" y="${300 + lines.length * 34 + 8}" font-size="18" opacity="0.75">${year}</text></g></svg>`;
}

export function createMockAdapter(source: SourceConfig): SourceAdapter {
	const dataset = DATASETS[source.token.trim().toLowerCase()] ?? DATASETS.alpha;

	return {
		id: String(source.id),
		type: 'mock',
		async testConnection() {
			return true;
		},
		async listLibraries() {
			return [
				{ remoteId: 'movies', name: 'Movies', kind: 'movie' },
				{ remoteId: 'shows', name: 'TV Shows', kind: 'show' }
			];
		},
		async *fetchItems(library: Library) {
			for (const entry of dataset) {
				if (entry.kind !== library.kind) continue;
				const item: RawItem = {
					remoteId: `${slug(entry.title)}-${entry.year}`,
					title: entry.title,
					year: entry.year,
					kind: entry.kind,
					externalIds: entry.ids ?? {},
					posterRef: `${entry.title}|${entry.year}`,
					addedAt: null,
					updatedAt: null
				};
				yield item;
			}
		},
		buildLink(item) {
			return `https://mock.invalid/${source.id}/${item.remoteId}`;
		},
		async fetchPoster(posterRef) {
			const [title, year] = posterRef.split('|');
			return new Response(mockPosterSvg(title, Number(year)), { headers: { 'Content-Type': 'image/svg+xml' } });
		}
	};
}
