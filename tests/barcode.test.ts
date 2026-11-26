import { describe, expect, it } from 'vitest';
import { addToCollection } from '../src/lib/server/adapters/collection';
import { cleanProductTitle, lookUpBarcode, normalizeBarcode } from '../src/lib/server/barcode';
import { searchTitles } from '../src/lib/server/tmdb';

describe('normalizeBarcode', () => {
	it('accepts UPC-A and EAN-13 with a valid check digit, ignoring spaces and dashes', () => {
		expect(normalizeBarcode('0 36000 29145 2')).toBe('036000291452');
		expect(normalizeBarcode('4006381333931')).toBe('4006381333931');
		expect(normalizeBarcode('12345670')).toBe('12345670');
	});

	it('rejects a wrong check digit, letters and other lengths', () => {
		expect(normalizeBarcode('036000291453')).toBeNull();
		expect(normalizeBarcode('03600029145X')).toBeNull();
		expect(normalizeBarcode('12345')).toBeNull();
		expect(normalizeBarcode('')).toBeNull();
	});
});

describe('cleanProductTitle', () => {
	it('strips packaging words and reads the year and format', () => {
		expect(cleanProductTitle('The Glass Orchard (DVD, 2019) Widescreen')).toEqual({
			title: 'The Glass Orchard',
			year: 2019,
			kind: 'movie',
			format: 'DVD'
		});
		expect(cleanProductTitle('Northbound [Blu-ray] Special Edition 2-Disc')).toMatchObject({
			title: 'Northbound',
			year: null,
			format: 'Blu-ray'
		});
		expect(cleanProductTitle('Brand New Sealed Harbor Lights 4K Ultra HD + Blu-ray + Digital')).toMatchObject({
			title: 'Harbor Lights',
			format: '4K'
		});
	});

	it('treats season sets as shows and keeps words like New inside a title', () => {
		expect(cleanProductTitle('Low Tide Club: Season One (DVD)')).toMatchObject({
			title: 'Low Tide Club',
			kind: 'show'
		});
		expect(cleanProductTitle('Low Tide Club - The Complete Series')).toMatchObject({
			title: 'Low Tide Club',
			kind: 'show'
		});
		expect(cleanProductTitle('The Saga: New Dawn DVD')).toMatchObject({ title: 'The Saga: New Dawn', kind: 'movie' });
	});

	it('returns null when nothing but packaging is left', () => {
		expect(cleanProductTitle('DVD (Widescreen)')).toBeNull();
	});
});

describe('addToCollection', () => {
	it('appends a line and reports duplicates', () => {
		const first = addToCollection('Northbound\n', { title: 'Low Tide Club', year: 2018, kind: 'show' });
		expect(first).toEqual({ status: 'added', body: 'Northbound\nTV: Low Tide Club (2018)' });
		expect(addToCollection('northbound', { title: 'Northbound', year: null, kind: 'movie' })).toEqual({
			status: 'duplicate'
		});
		expect(addToCollection('', { title: 'Northbound', year: 2001, kind: 'movie' })).toEqual({
			status: 'added',
			body: 'Northbound (2001)'
		});
	});

	it('refuses a title that would read back as something else', () => {
		expect(addToCollection('', { title: '#Comment Title', year: null, kind: 'movie' })).toEqual({ status: 'invalid' });
		expect(addToCollection('', { title: '', year: null, kind: 'movie' })).toEqual({ status: 'invalid' });
	});
});

function jsonFetch(status: number, body: unknown): typeof fetch {
	return async () => new Response(JSON.stringify(body), { status });
}

describe('lookUpBarcode', () => {
	it('returns the first product title, or null when the barcode is unknown', async () => {
		expect(
			await lookUpBarcode(
				'036000291452',
				jsonFetch(200, { code: 'OK', items: [{ title: '' }, { title: 'Northbound DVD' }] })
			)
		).toBe('Northbound DVD');
		expect(await lookUpBarcode('036000291452', jsonFetch(404, { code: 'NOT_FOUND' }))).toBeNull();
		expect(await lookUpBarcode('036000291452', jsonFetch(200, { code: 'OK', items: [] }))).toBeNull();
	});

	it('explains rate limits', async () => {
		await expect(lookUpBarcode('036000291452', jsonFetch(429, { code: 'TOO_FAST' }))).rejects.toThrow(/Wait/);
		await expect(lookUpBarcode('036000291452', jsonFetch(429, { code: 'EXCEED_LIMIT' }))).rejects.toThrow(/100/);
	});
});

describe('searchTitles', () => {
	it('keeps movies and shows, preferring the expected year and kind', async () => {
		const results = await searchTitles(
			'Northbound',
			{ year: 2001, kind: 'movie' },
			'token',
			jsonFetch(200, {
				results: [
					{ id: 1, media_type: 'tv', name: 'Northbound', first_air_date: '2001-03-01' },
					{ id: 2, media_type: 'person', name: 'Northbound Person' },
					{ id: 3, media_type: 'movie', title: 'Northbound', release_date: '1985-01-01', poster_path: '/a.jpg' },
					{ id: 4, media_type: 'movie', title: 'Northbound', release_date: '2001-06-01', poster_path: '../x' }
				]
			})
		);
		expect(results.map((r) => r.tmdbId)).toEqual(['4', '1', '3']);
		expect(results[0]).toEqual({ tmdbId: '4', kind: 'movie', title: 'Northbound', year: 2001, poster: null });
		expect(results[2].poster).toBe('/a.jpg');
	});
});
