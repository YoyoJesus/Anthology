/**
 * Streaming services Anthology can import and link to. `match` is tested against TMDB provider names, lowercased.
 * It matches the service itself (including its ad-supported plans), never the same catalogue resold as an "Amazon
 * Channel", "Apple TV Channel" or "Roku Premium Channel", or a store selling rentals. Regional services list the
 * regions TMDB carries them in (checked against TMDB's provider lists for US, GB, CA, AU and DE); the rest show
 * everywhere.
 *
 * `search` opens the service's own search for a title. Services whose search page does not work from a link open
 * their home page instead. TMDB has no deep links to a title inside a service.
 */
export type ServiceGroup = 'subscription' | 'free' | 'live';

interface ServiceDefinition {
	id: string;
	name: string;
	group: ServiceGroup;
	match: RegExp;
	search: (query: string) => string;
	regions?: readonly string[];
}

const home = (url: string) => () => url;

export const SERVICE_DEFINITIONS = [
	// Subscriptions
	{
		id: 'netflix',
		name: 'Netflix',
		group: 'subscription',
		match: /^netflix\b/,
		search: (q) => `https://www.netflix.com/search?q=${q}`
	},
	{
		id: 'prime',
		name: 'Prime Video',
		group: 'subscription',
		match: /^amazon prime video( with ads)?$/,
		search: (q) => `https://www.primevideo.com/search/?phrase=${q}`
	},
	{
		id: 'disney',
		name: 'Disney+',
		group: 'subscription',
		match: /^disney( plus|\+)$/,
		search: (q) => `https://www.disneyplus.com/search?q=${q}`
	},
	{
		id: 'hulu',
		name: 'Hulu',
		group: 'subscription',
		match: /^hulu$/,
		search: (q) => `https://www.hulu.com/search?q=${q}`,
		regions: ['US']
	},
	{
		id: 'appletv',
		name: 'Apple TV+',
		group: 'subscription',
		match: /^apple tv( plus|\+)?$/,
		search: (q) => `https://tv.apple.com/search?term=${q}`
	},
	{
		id: 'max',
		name: 'HBO Max',
		group: 'subscription',
		match: /^(hbo )?max$/,
		search: (q) => `https://www.hbomax.com/search?q=${q}`
	},
	{
		id: 'paramount',
		name: 'Paramount+',
		group: 'subscription',
		match: /^paramount (plus|\+)( premium| essential| basic with ads)?$/,
		search: (q) => `https://www.paramountplus.com/search/?q=${q}`
	},
	{
		id: 'peacock',
		name: 'Peacock',
		group: 'subscription',
		match: /^peacock premium( plus)?$/,
		search: (q) => `https://www.peacocktv.com/watch/search?q=${q}`,
		regions: ['US']
	},
	{
		id: 'starz',
		name: 'Starz',
		group: 'subscription',
		match: /^starz$/,
		search: (q) => `https://www.starz.com/us/en/search?q=${q}`,
		regions: ['US']
	},
	{
		id: 'mgmplus',
		name: 'MGM+',
		group: 'subscription',
		match: /^mgm( plus|\+)$/,
		search: (q) => `https://www.mgmplus.com/search?q=${q}`,
		regions: ['US']
	},
	{
		id: 'amcplus',
		name: 'AMC+',
		group: 'subscription',
		match: /^amc\+$/,
		search: (q) => `https://www.amcplus.com/search?q=${q}`,
		regions: ['US', 'CA', 'AU']
	},
	{
		id: 'crunchyroll',
		name: 'Crunchyroll',
		group: 'subscription',
		match: /^crunchyroll$/,
		search: (q) => `https://www.crunchyroll.com/search?q=${q}`
	},
	{
		id: 'discoveryplus',
		name: 'Discovery+',
		group: 'subscription',
		match: /^discovery ?\+$/,
		search: home('https://www.discoveryplus.com/')
	},
	{
		id: 'espnplus',
		name: 'ESPN+',
		group: 'subscription',
		match: /^espn plus$/,
		search: home('https://plus.espn.com/'),
		regions: ['US']
	},
	{
		id: 'youtubepremium',
		name: 'YouTube Premium',
		group: 'subscription',
		match: /^youtube premium$/,
		search: (q) => `https://www.youtube.com/results?search_query=${q}`
	},
	{
		id: 'criterion',
		name: 'Criterion Channel',
		group: 'subscription',
		match: /^criterion channel$/,
		search: (q) => `https://www.criterionchannel.com/search?q=${q}`,
		regions: ['US', 'CA']
	},
	{
		id: 'mubi',
		name: 'MUBI',
		group: 'subscription',
		match: /^mubi$/,
		search: (q) => `https://mubi.com/en/search/films?query=${q}`
	},
	{
		id: 'shudder',
		name: 'Shudder',
		group: 'subscription',
		match: /^shudder$/,
		search: home('https://www.shudder.com/')
	},
	{
		id: 'britbox',
		name: 'BritBox',
		group: 'subscription',
		match: /^britbox$/,
		search: (q) => `https://www.britbox.com/us/search?q=${q}`
	},
	{
		id: 'acorn',
		name: 'Acorn TV',
		group: 'subscription',
		match: /^acorn ?tv$/,
		search: (q) => `https://acorn.tv/search?q=${q}`
	},
	{
		id: 'sundance',
		name: 'Sundance Now',
		group: 'subscription',
		match: /^sundance now$/,
		search: home('https://www.sundancenow.com/'),
		regions: ['US', 'CA']
	},
	{
		id: 'nowtv',
		name: 'NOW',
		group: 'subscription',
		match: /^now tv( cinema)?$/,
		search: home('https://www.nowtv.com/'),
		regions: ['GB']
	},
	{
		id: 'skygo',
		name: 'Sky Go',
		group: 'subscription',
		match: /^sky go$/,
		search: home('https://www.sky.com/watch/sky-go'),
		regions: ['GB', 'DE']
	},
	{
		id: 'crave',
		name: 'Crave',
		group: 'subscription',
		match: /^crave$/,
		search: home('https://www.crave.ca/'),
		regions: ['CA']
	},
	{
		id: 'stan',
		name: 'Stan',
		group: 'subscription',
		match: /^stan$/,
		search: home('https://www.stan.com.au/'),
		regions: ['AU']
	},
	{
		id: 'binge',
		name: 'BINGE',
		group: 'subscription',
		match: /^binge$/,
		search: home('https://binge.com.au/'),
		regions: ['AU']
	},
	{
		id: 'foxtelnow',
		name: 'Foxtel Now',
		group: 'subscription',
		match: /^foxtel now$/,
		search: home('https://www.foxtel.com.au/now/'),
		regions: ['AU']
	},
	{
		id: 'wow',
		name: 'WOW',
		group: 'subscription',
		match: /^wow$/,
		search: home('https://www.wowtv.de/'),
		regions: ['DE']
	},
	{
		id: 'rtlplus',
		name: 'RTL+',
		group: 'subscription',
		match: /^rtl\+$/,
		search: (q) => `https://plus.rtl.de/suche?q=${q}`,
		regions: ['DE']
	},
	{
		id: 'magentatv',
		name: 'MagentaTV',
		group: 'subscription',
		match: /^magenta ?tv\+?$/,
		search: home('https://www.magentatv.de/'),
		regions: ['DE']
	},
	// Free with ads, or free with a library card
	{
		id: 'primefree',
		name: 'Prime Video Free with Ads',
		group: 'free',
		match: /^amazon prime video free with ads$/,
		search: (q) => `https://www.primevideo.com/search/?phrase=${q}`
	},
	{ id: 'tubi', name: 'Tubi', group: 'free', match: /^tubi( tv)?$/, search: (q) => `https://tubitv.com/search/${q}` },
	{ id: 'pluto', name: 'Pluto TV', group: 'free', match: /^pluto tv$/, search: home('https://pluto.tv/') },
	{
		id: 'roku',
		name: 'The Roku Channel',
		group: 'free',
		match: /^the roku channel$/,
		search: (q) => `https://app.roku.com/search/${q}`,
		regions: ['US']
	},
	{ id: 'plex', name: 'Plex', group: 'free', match: /^plex$/, search: (q) => `https://watch.plex.tv/search?q=${q}` },
	{
		id: 'youtube',
		name: 'YouTube (free)',
		group: 'free',
		match: /^youtube( free)?$/,
		search: (q) => `https://www.youtube.com/results?search_query=${q}`
	},
	{
		id: 'kanopy',
		name: 'Kanopy',
		group: 'free',
		match: /^kanopy$/,
		search: (q) => `https://www.kanopy.com/en/search?query=${q}`,
		regions: ['US']
	},
	{
		id: 'hoopla',
		name: 'Hoopla',
		group: 'free',
		match: /^hoopla$/,
		search: (q) => `https://www.hoopladigital.com/search?q=${q}&type=direct`,
		regions: ['US', 'CA', 'AU']
	},
	{
		id: 'bbciplayer',
		name: 'BBC iPlayer',
		group: 'free',
		match: /^bbc iplayer$/,
		search: (q) => `https://www.bbc.co.uk/iplayer/search?q=${q}`,
		regions: ['GB']
	},
	{
		id: 'itvx',
		name: 'ITVX',
		group: 'free',
		match: /^itvx( premium)?$/,
		search: home('https://www.itv.com/'),
		regions: ['GB']
	},
	{
		id: 'channel4',
		name: 'Channel 4',
		group: 'free',
		match: /^channel 4( plus)?$/,
		search: home('https://www.channel4.com/'),
		regions: ['GB']
	},
	{
		id: 'cbcgem',
		name: 'CBC Gem',
		group: 'free',
		match: /^cbc gem$/,
		search: home('https://gem.cbc.ca/'),
		regions: ['CA']
	},
	{
		id: 'abciview',
		name: 'ABC iview',
		group: 'free',
		match: /^abc iview$/,
		search: home('https://iview.abc.net.au/'),
		regions: ['AU']
	},
	{
		id: 'sbs',
		name: 'SBS On Demand',
		group: 'free',
		match: /^sbs on demand$/,
		search: home('https://www.sbs.com.au/ondemand/'),
		regions: ['AU']
	},
	{
		id: '9now',
		name: '9Now',
		group: 'free',
		match: /^9now$/,
		search: home('https://www.9now.com.au/'),
		regions: ['AU']
	},
	{
		id: '7plus',
		name: '7plus',
		group: 'free',
		match: /^7plus$/,
		search: home('https://7plus.com.au/'),
		regions: ['AU']
	},
	{
		id: 'joyn',
		name: 'Joyn',
		group: 'free',
		match: /^joyn( plus)?$/,
		search: (q) => `https://www.joyn.de/suche?q=${q}`,
		regions: ['DE']
	},
	{
		id: 'ard',
		name: 'ARD Mediathek',
		group: 'free',
		match: /^ard (mediathek|plus)$/,
		search: home('https://www.ardmediathek.de/'),
		regions: ['DE']
	},
	{ id: 'zdf', name: 'ZDF', group: 'free', match: /^zdf$/, search: home('https://www.zdf.de/'), regions: ['DE'] },
	// Live TV services with on-demand libraries
	{
		id: 'youtubetv',
		name: 'YouTube TV',
		group: 'live',
		match: /^youtube tv$/,
		search: home('https://tv.youtube.com/'),
		regions: ['US']
	},
	{
		id: 'fubo',
		name: 'Fubo',
		group: 'live',
		match: /^fubotv$/,
		search: home('https://www.fubo.tv/'),
		regions: ['US', 'CA']
	},
	{
		id: 'sling',
		name: 'Sling TV',
		group: 'live',
		match: /^sling tv\b/,
		search: home('https://www.sling.com/'),
		regions: ['US']
	},
	{
		id: 'philo',
		name: 'Philo',
		group: 'live',
		match: /^philo$/,
		search: (q) => `https://www.philo.com/player/search?q=${q}`,
		regions: ['US']
	}
] as const satisfies readonly ServiceDefinition[];

export type StreamingServiceId = (typeof SERVICE_DEFINITIONS)[number]['id'];

export const STREAMING_SERVICES: readonly { id: StreamingServiceId; name: string; group: ServiceGroup }[] =
	SERVICE_DEFINITIONS.map(({ id, name, group }) => ({ id, name, group }));

export const SERVICE_GROUPS: readonly { id: ServiceGroup; name: string }[] = [
	{ id: 'subscription', name: 'Subscriptions' },
	{ id: 'free', name: 'Free' },
	{ id: 'live', name: 'Live TV' }
];

export function isServiceId(value: string): value is StreamingServiceId {
	return SERVICE_DEFINITIONS.some((s) => s.id === value);
}

export function serviceName(id: StreamingServiceId): string {
	return SERVICE_DEFINITIONS.find((s) => s.id === id)?.name ?? id;
}

/** Services worth offering in a region: everywhere-services, plus regional ones TMDB carries there. */
export function servicesForRegion(region: string): typeof STREAMING_SERVICES {
	return STREAMING_SERVICES.filter((service) => {
		const def = SERVICE_DEFINITIONS.find((s) => s.id === service.id) as ServiceDefinition | undefined;
		return !def?.regions || def.regions.includes(region);
	});
}

/** The service a TMDB provider name belongs to, if any. */
export function serviceForProvider(providerName: string): StreamingServiceId | null {
	const name = providerName.trim().toLowerCase();
	return SERVICE_DEFINITIONS.find((s) => s.match.test(name))?.id ?? null;
}

export function serviceSearchUrl(service: StreamingServiceId, title: string): string {
	const def = SERVICE_DEFINITIONS.find((s) => s.id === service);
	return def ? def.search(encodeURIComponent(title)) : '';
}
