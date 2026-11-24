import { describe, expect, it } from 'vitest';
import { serviceSearchUrl, servicesNotListed } from '../src/lib/service-links';

describe('serviceSearchUrl', () => {
	it('encodes the title into each service search', () => {
		expect(serviceSearchUrl('appletv', 'Ferris & Finch')).toBe('https://tv.apple.com/search?term=Ferris%20%26%20Finch');
		expect(serviceSearchUrl('prime', 'Harbor Lights')).toBe(
			'https://www.primevideo.com/search/?phrase=Harbor%20Lights'
		);
	});
});

describe('servicesNotListed', () => {
	it('drops services already shown as a source', () => {
		const sources = [
			{ sourceType: 'streaming', sourceName: 'Netflix' },
			{ sourceType: 'collection', sourceName: 'Hulu' }
		];
		expect(servicesNotListed(['netflix', 'hulu'], sources)).toEqual(['hulu']);
	});
});
