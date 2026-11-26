/** Disc barcodes: validation, product name cleanup and the UPCitemdb lookup. */
const UPCITEMDB_LOOKUP = 'https://api.upcitemdb.com/prod/trial/lookup';

/** Digits only, 8 (EAN-8 or UPC-E), 12 (UPC-A) or 13 (EAN-13). UPC-A and EAN-13 check digits are verified. */
export function normalizeBarcode(input: string): string | null {
	const code = input.replace(/[\s-]/g, '');
	if (!/^(\d{8}|\d{12}|\d{13})$/.test(code)) return null;
	if (code.length === 8) return code;
	const digits = [...code].map(Number);
	const check = digits.pop()!;
	const sum = digits.reverse().reduce((total, d, i) => total + d * (i % 2 === 0 ? 3 : 1), 0);
	return (10 - (sum % 10)) % 10 === check ? code : null;
}

export type DiscFormat = 'DVD' | 'Blu-ray' | '4K';

export interface ProductTitle {
	title: string;
	year: number | null;
	kind: 'movie' | 'show';
	format: DiscFormat | null;
}

const PACKAGING = [
	/\b4k\b/gi,
	/\bultra\s*hd\b/gi,
	/\buhd\b/gi,
	/\bblu-?\s?ray\b/gi,
	/\bdvd\b/gi,
	/\bdigital(\s+(copy|code|hd))?\b/gi,
	/\b(wide|full)\s*screen\b/gi,
	/\b(special|collector'?s|limited|deluxe|anniversary|extended|ultimate|director'?s|unrated|theatrical)(\s+(edition|cut))?\b/gi,
	/\b(edition|steelbook|combo\s+pack|box\s*set|slipcover)\b/gi,
	/\b\d+[-\s]?(disc|discs)\b/gi,
	/\b(two|three|four)[-\s]disc\b/gi,
	/\bregion\s*\w+\b/gi,
	/\bntsc\b/gi,
	/\bbrand\s+new\b|^\s*new\b|\bsealed\b/gi,
	/\bwith\s+bonus\b/gi
];

const SEASON =
	/\b(the\s+)?(complete\s+(\w+\s+)?(series|seasons?)|(season|seasons|series)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)|tv\s+series)\b.*$/i;

/** "The Matrix (DVD, 1999) Widescreen" becomes The Matrix, 1999, DVD. */
export function cleanProductTitle(name: string): ProductTitle | null {
	let format: DiscFormat | null = null;
	if (/\b(4k|ultra\s*hd|uhd)\b/i.test(name)) format = '4K';
	else if (/\bblu-?\s?ray\b/i.test(name)) format = 'Blu-ray';
	else if (/\bdvd\b/i.test(name)) format = 'DVD';

	const years = [...name.matchAll(/\b(19\d{2}|20\d{2})\b/g)].map((m) => Number(m[1]));
	const year = years.length ? years[0] : null;

	let title = name.replace(/[([{][^)\]}]*[)\]}]/g, ' ');
	const kind = SEASON.test(title) ? 'show' : 'movie';
	if (kind === 'show') title = title.replace(SEASON, ' ');
	for (const pattern of PACKAGING) title = title.replace(pattern, ' ');
	if (year !== null) title = title.replace(new RegExp(`\\b${year}\\b`, 'g'), ' ');
	title = title
		.replace(/\s+/g, ' ')
		.replace(/^[\s\-–:,+/&]+|[\s\-–:,+/&]+$/g, '')
		.trim();
	if (!/[\p{L}\p{N}]/u.test(title)) return null;
	return { title, year, kind, format };
}

interface UpcItemDbResponse {
	code?: string;
	items?: { title?: string }[];
}

/** The product name for a barcode, or null when UPCitemdb has no record of it. */
export async function lookUpBarcode(code: string, fetchFn: typeof fetch = globalThis.fetch): Promise<string | null> {
	const res = await fetchFn(`${UPCITEMDB_LOOKUP}?${new URLSearchParams({ upc: code })}`, {
		headers: { Accept: 'application/json' },
		signal: AbortSignal.timeout(10_000)
	});
	if (res.status === 404) return null;
	const body = (await res.json().catch(() => ({}))) as UpcItemDbResponse;
	if (res.status === 429) {
		throw new Error(
			body.code === 'EXCEED_LIMIT'
				? 'The free barcode lookup allows 100 scans a day. Search by title instead.'
				: 'Scanning too fast for the free barcode lookup. Wait 10 seconds and try again.'
		);
	}
	if (res.status === 400) return null;
	if (!res.ok) throw new Error(`The barcode lookup responded with HTTP ${res.status}`);
	return body.items?.find((item) => item.title?.trim())?.title?.trim() ?? null;
}
