import { describe, expect, it } from 'vitest';
import { idsConflict, matchKey, normalizeTitle, parseIds } from '../src/lib/server/matcher';
import { toFtsQuery } from '../src/lib/server/works';

describe('normalizeTitle', () => {
	it('ignores case, punctuation, accents, leading articles and ampersands', () => {
		expect(normalizeTitle('The Café: Part II!')).toBe('cafe part ii');
		expect(normalizeTitle('Ferris & Finch')).toBe(normalizeTitle('Ferris and Finch'));
		expect(normalizeTitle('  A   Quiet  Place ')).toBe('quiet place');
	});
});

describe('matchKey', () => {
	it('separates kinds and years', () => {
		expect(matchKey('movie', 'Second Draft', 2012)).not.toBe(matchKey('movie', 'Second Draft', 2025));
		expect(matchKey('movie', 'Northbound', 2016)).not.toBe(matchKey('show', 'Northbound', 2016));
		expect(matchKey('movie', 'Untitled', null)).toBe('movie|untitled|');
	});
});

describe('idsConflict', () => {
	it('only conflicts when the same provider disagrees', () => {
		expect(idsConflict({ tmdb: '1' }, { tmdb: '2' })).toBe(true);
		expect(idsConflict({ tmdb: '1' }, { imdb: 'tt1' })).toBe(false);
		expect(idsConflict({}, { tmdb: '1' })).toBe(false);
	});
});

describe('parseIds', () => {
	it('drops unknown providers and bad JSON', () => {
		expect(parseIds('{"tmdb":"5","foo":"x","imdb":7}')).toEqual({ tmdb: '5' });
		expect(parseIds('not json')).toEqual({});
		expect(parseIds(null)).toEqual({});
	});
});

describe('toFtsQuery', () => {
	it('quotes terms as prefixes and strips FTS syntax', () => {
		expect(toFtsQuery('glass orch')).toBe('"glass"* "orch"*');
		expect(toFtsQuery('NEAR(") OR *')).toBe('"NEAR"* "OR"*');
		expect(toFtsQuery('  ***  ')).toBeNull();
	});
});
