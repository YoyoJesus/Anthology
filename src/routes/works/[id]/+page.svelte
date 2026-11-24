<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import Icon from '#lib/components/Icon.svelte';
	import { GENRES } from '#lib/genres.ts';
	import Poster from '#lib/components/Poster.svelte';
	import SourceTag from '#lib/components/SourceTag.svelte';
	import { serviceSearchUrl, servicesNotListed } from '#lib/service-links.ts';
	import { serviceName as nameOf } from '#lib/streaming-services.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const work = $derived(data.work);
	const info = $derived(data.info);
	const extraServices = $derived(servicesNotListed(work.streaming, work.sources));
	const streams = $derived(work.items.some((item) => item.sourceType === 'streaming') || extraServices.length > 0);
	const genreNames = $derived(work.genres.map((id) => GENRES.find((g) => g.id === id)?.name ?? id));
	const kindLabel = $derived(work.kind === 'show' ? 'Show' : 'Movie');

	/** Coming from the library, "Library" steps back so filters, page and scroll position are kept. */
	let fromLibrary = $state(false);
	afterNavigate(({ from }) => {
		fromLibrary = from?.url.pathname === '/';
	});
	function back(event: MouseEvent) {
		if (!fromLibrary) return;
		event.preventDefault();
		history.back();
	}

	const personHref = (name: string) => `/?${new URLSearchParams({ q: name, by: 'person' })}`;
	const initials = (name: string) =>
		name
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0])
			.join('');
	const serviceName = nameOf;
	const openLabel = (item: (typeof work.items)[number]) =>
		item.sourceType === 'plex' ? 'Plex' : item.sourceType === 'jellyfin' ? 'Jellyfin' : item.sourceName;

	const providerLabels: Record<string, string> = {
		tmdb: 'TMDB',
		imdb: 'IMDb',
		tvdb: 'TVDB',
		musicbrainz: 'MusicBrainz',
		igdb: 'IGDB'
	};
	const ids = $derived.by(() => {
		const merged = new Map<string, string>();
		if (work.tmdbId) merged.set('tmdb', work.tmdbId);
		for (const item of work.items) for (const [k, v] of Object.entries(item.externalIds)) if (v) merged.set(k, v);
		return [...merged];
	});
</script>

<svelte:head><title>{work.title} · Anthology</title></svelte:head>

<a href="/" class="btn btn-quiet -ml-2" onclick={back}><Icon name="arrow-left" />Library</a>

<article class="mt-4 grid gap-8 md:grid-cols-[minmax(0,15rem)_1fr] md:gap-12">
	<div class="md:sticky md:top-6 md:self-start">
		<Poster src={work.posterUrl} title={work.title} class="w-40 shadow-lg shadow-black/40 md:w-full" />
	</div>

	<div class="min-w-0">
		<header>
			<h1 class="font-serif text-4xl leading-[1.1] tracking-tight text-balance sm:text-5xl">{work.title}</h1>
			<p class="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-muted">
				{#if work.rating}
					<span class="inline-flex items-center gap-1.5 text-ink">
						<Icon name="star" class="size-4 text-accent" />
						<span class="font-medium tabular-nums">{work.rating.toFixed(1)}</span>
						<span class="text-sm text-faint tabular-nums">{work.votes.toLocaleString()} votes</span>
					</span>
					<span aria-hidden="true" class="text-faint">·</span>
				{/if}
				<span class="tabular-nums">{work.year ?? 'Unknown year'}</span>
				<span aria-hidden="true" class="text-faint">·</span>
				<span>{kindLabel}</span>
				{#if info?.runtime}
					<span aria-hidden="true" class="text-faint">·</span>
					<span class="tabular-nums">{info.runtime} min{work.kind === 'show' ? ' per episode' : ''}</span>
				{/if}
			</p>
			{#if genreNames.length}
				<ul class="mt-3 flex flex-wrap gap-1.5" aria-label="Genres">
					{#each genreNames as genre (genre)}
						<li class="rounded-full border border-line px-2.5 py-0.5 text-xs text-muted">{genre}</li>
					{/each}
				</ul>
			{/if}
		</header>

		{#if info?.overview}
			<p class="mt-6 max-w-[65ch] text-[1.05rem] leading-relaxed text-ink/90">{info.overview}</p>
		{/if}
		{#if info?.directors.length}
			<p class="mt-4 text-sm text-muted">
				{work.kind === 'show' ? 'Created by' : 'Directed by'}
				{#each info.directors as name, i (name)}{i ? ', ' : ' '}<a
						href={personHref(name)}
						class="text-ink underline decoration-line underline-offset-4 hover:decoration-accent"
					>
						{name}
					</a>{/each}
			</p>
		{/if}

		<section class="mt-10" aria-labelledby="watch-heading">
			<h2 id="watch-heading" class="text-lg font-medium">Watch</h2>
			<ul class="mt-3 divide-y divide-line border-y border-line">
				{#each work.items as item (item.id)}
					<li class="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
						<div class="min-w-0 flex-1">
							<SourceTag name={item.sourceName} type={item.sourceType} />
							<p class="mt-0.5 truncate text-sm text-muted">
								{item.libraryName}
								{#if item.title !== work.title}<span class="text-faint"> · listed as “{item.title}”</span>{/if}
							</p>
						</div>
						{#if item.linkUrl}
							<a href={item.linkUrl} target="_blank" rel="noopener noreferrer" class="btn">
								Open in {openLabel(item)}
								<Icon name="external-link" />
							</a>
						{:else}
							<span class="text-sm text-muted">In your collection</span>
						{/if}
					</li>
				{/each}
				{#each extraServices as id (id)}
					<li class="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
						<div class="min-w-0 flex-1">
							<SourceTag name={serviceName(id)} type="streaming" />
							<p class="mt-0.5 text-sm text-muted">Streaming</p>
						</div>
						<a href={serviceSearchUrl(id, work.title)} target="_blank" rel="noopener noreferrer" class="btn">
							Open in {serviceName(id)}
							<Icon name="external-link" />
						</a>
					</li>
				{/each}
			</ul>
			{#if streams}
				<p class="mt-2 text-xs text-faint">
					Service links open the service's search for this title.
					{#if data.watchLink}
						<a
							href={data.watchLink}
							target="_blank"
							rel="noopener noreferrer"
							class="text-muted underline underline-offset-2 hover:text-ink"
						>
							More places to watch
						</a>
					{/if}
				</p>
			{/if}
		</section>

		{#if info?.cast.length}
			<section class="mt-12" aria-labelledby="cast-heading">
				<h2 id="cast-heading" class="text-lg font-medium">Cast</h2>
				<ul class="mt-4 grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-4 lg:grid-cols-6">
					{#each info.cast as person (person.name)}
						<li>
							<a href={personHref(person.name)} class="group block" title="Titles with {person.name}">
								<div
									class="aspect-[4/5] overflow-hidden rounded-sm bg-raised ring-accent transition group-hover:ring-2"
								>
									{#if person.photo}
										<img
											src="/posters/tmdb{person.photo}"
											alt=""
											loading="lazy"
											class="size-full object-cover object-top"
										/>
									{:else}
										<div class="flex size-full items-center justify-center font-serif text-2xl text-faint">
											{initials(person.name)}
										</div>
									{/if}
								</div>
								<p class="mt-2 text-sm leading-snug font-medium group-hover:text-accent">{person.name}</p>
								{#if person.character}
									<p class="mt-0.5 line-clamp-2 text-xs leading-snug text-muted">{person.character}</p>
								{/if}
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<footer class="mt-14 border-t border-line pt-4 text-xs text-faint">
			{#if ids.length}
				<dl class="flex flex-wrap gap-x-5 gap-y-1">
					{#each ids as [provider, value] (provider)}
						<div class="flex gap-1.5">
							<dt>{providerLabels[provider] ?? provider}</dt>
							<dd class="font-mono text-muted">{value}</dd>
						</div>
					{/each}
				</dl>
			{/if}
			{#if work.rating || info || streams}
				<p class="mt-2">
					Details and ratings from TMDB{streams ? '. Streaming data from JustWatch via TMDB' : ''}. This product uses
					the TMDB API but is not endorsed or certified by TMDB.
				</p>
			{/if}
		</footer>
	</div>
</article>
