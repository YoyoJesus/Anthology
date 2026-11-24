import { describe, expect, it } from 'vitest';
import { serviceForProvider, servicesForRegion } from '../src/lib/streaming-services';

describe('serviceForProvider', () => {
	it('matches each service, including its ad-supported plans', () => {
		expect(serviceForProvider('Netflix Standard with Ads')).toBe('netflix');
		expect(serviceForProvider('Amazon Prime Video with Ads')).toBe('prime');
		expect(serviceForProvider('Amazon Prime Video Free with Ads')).toBe('primefree');
		expect(serviceForProvider('HBO Max')).toBe('max');
		expect(serviceForProvider('Paramount Plus Essential')).toBe('paramount');
		expect(serviceForProvider('Peacock Premium Plus')).toBe('peacock');
		expect(serviceForProvider('Discovery +')).toBe('discoveryplus');
		expect(serviceForProvider('Sling TV Orange and Blue')).toBe('sling');
		expect(serviceForProvider('Tubi TV')).toBe('tubi');
		expect(serviceForProvider('BBC iPlayer')).toBe('bbciplayer');
	});

	it('ignores the same catalogues resold as channels, and stores', () => {
		for (const name of [
			'HBO Max Amazon Channel',
			'Paramount Plus Apple TV channel',
			'Paramount+ Roku Premium Channel',
			'AMC+ Amazon Channel',
			'Apple TV Store',
			'Amazon Video',
			'Paramount Pictures',
			'DisneyNOW',
			'AMC'
		])
			expect(serviceForProvider(name), name).toBeNull();
	});
});

describe('servicesForRegion', () => {
	it('offers regional services only in their region', () => {
		const us = servicesForRegion('US').map((s) => s.id);
		const gb = servicesForRegion('GB').map((s) => s.id);
		expect(us).toContain('hulu');
		expect(us).not.toContain('bbciplayer');
		expect(gb).toContain('bbciplayer');
		expect(gb).not.toContain('hulu');
		expect(gb).toContain('netflix');
	});
});
