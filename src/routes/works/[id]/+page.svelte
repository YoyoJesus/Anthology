<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import Icon from '#lib/components/Icon.svelte';
	import { GENRES } from '#lib/genres.ts';
	import Poster from '#lib/components/Poster.svelte';
	import SourceTag from '#lib/components/SourceTag.svelte';
	import { serviceSearchUrl } from '#lib/service-links.ts';
	import { STREAMING_SERVICES } from '#lib/types.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const work = $derived(data.work);
	const info = $derived(data.info);
	const genreNames = $derived(work.genres.map((id) => GENRES.find((g) => g.id === id)?.name ?? id));

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

	const providerLabels: Record<string, string> = {
		tmdb: 'TMDB',
		imdb: 'IMDb',
		tvdb: 'TVDB',
		musicbrainz: 'MusicBrainz',
		igdb: 'IGDB'
	};
	const ids = $derived.by(() => {
		const merged = new Map<string, string>();
		for (const item of work.items) for (const [k, v] of Object.entries(item.externalIds)) if (v) merged.set(k, v);
		return [...merged];
	});
</script>

<svelte:head><title>{work.title} · Anthology</title></svelte:head>

<a href="/" class="btn btn-quiet -ml-2" onclick={back}><Icon name="arrow-left" />Library</a>

<div class="mt-4 grid gap-8 sm:grid-cols-[minmax(0,14rem)_1fr]">
	<Poster src={work.posterUrl} title={work.title} class="w-40 sm:w-full" />

	<div class="min-w-0">
		<h1 class="font-serif text-4xl leading-tight tracking-tight">{work.title}</h1>
		<p class="mt-1 flex flex-wrap items-center gap-x-2 text-muted">
			{#if work.rating}
				<span class="inline-flex items-center gap-1 text-ink">
					<Icon name="star" class="size-4 text-accent" />{work.rating.toFixed(1)}
					<span class="text-xs text-faint">({work.votes.toLocaleString()} votes)</span>
				</span>
				·
			{/if}
			{work.year ?? 'Unknown year'} · {work.kind === 'show' ? 'Show' : 'Movie'}
			{#if info?.runtime}· {info.runtime} min{work.kind === 'show' ? ' per episode' : ''}{/if}
		</p>
		{#if genreNames.length}
			<p class="mt-1 text-sm text-muted">{genreNames.join(', ')}</p>
		{/if}
		{#if info?.overview}
			<p class="mt-4 max-w-2xl leading-relaxed">{info.overview}</p>
		{/if}
		{#if info?.directors.length}
			<p class="mt-4 text-sm">
				<span class="text-muted">{work.kind === 'show' ? 'Created by' : 'Directed by'}</span>
				{#each info.directors as name, i (name)}{i ? ', ' : ' '}<a
						href={personHref(name)}
						class="text-accent hover:underline"
					>
						{name}
					</a>{/each}
			</p>
		{/if}
		{#if info?.cast.length}
			<p class="mt-1 text-sm">
				<span class="text-muted">Starring</span>
				{#each info.cast as name, i (name)}{i ? ', ' : ' '}<a
						href={personHref(name)}
						class="text-accent hover:underline"
					>
						{name}
					</a>{/each}
			</p>
		{/if}
		{#if work.rating || info}
			<p class="mt-2 text-xs text-faint">Details and ratings from TMDB.</p>
		{/if}

		<h2 class="label mt-8">Available on</h2>
		<ul class="mt-2 divide-y divide-line border-y border-line">
			{#each work.items as item (item.id)}
				<li class="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
					<div class="min-w-0 flex-1">
						<SourceTag name={item.sourceName} type={item.sourceType} />
						<p class="mt-0.5 truncate text-sm">
							{item.libraryName}
							{#if item.title !== work.title}<span class="text-faint"> · listed as “{item.title}”</span>{/if}
						</p>
					</div>
					{#if item.linkUrl}
						<a href={item.linkUrl} target="_blank" rel="noopener noreferrer" class="btn">
							Open in {item.sourceType === 'plex'
								? 'Plex'
								: item.sourceType === 'jellyfin'
									? 'Jellyfin'
									: item.sourceName}
							<Icon name="external-link" />
						</a>
					{:else}
						<span class="text-sm text-muted">In your collection</span>
					{/if}
				</li>
			{/each}
		</ul>

		{#if work.streaming.length}
			<h2 class="label mt-8">Streaming on</h2>
			<div class="mt-2 flex flex-wrap gap-2">
				{#each work.streaming as id (id)}
					<a href={serviceSearchUrl(id, work.title)} target="_blank" rel="noopener noreferrer" class="btn">
						{STREAMING_SERVICES.find((s) => s.id === id)?.name ?? id}
						<Icon name="external-link" />
					</a>
				{/each}
			</div>
			<p class="mt-1 text-xs text-faint">Opens the service's search for this title.</p>
			{#if data.watchLink}
				<a
					href={data.watchLink}
					target="_blank"
					rel="noopener noreferrer"
					class="mt-1 inline-flex items-center gap-1 text-sm text-accent hover:underline"
				>
					Where to watch <Icon name="external-link" />
				</a>
			{/if}
			<p class="mt-1 text-xs text-faint">Streaming data from JustWatch via TMDB.</p>
		{/if}

		{#if ids.length}
			<h2 class="label mt-8">External IDs</h2>
			<dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
				{#each ids as [provider, value] (provider)}
					<dt class="text-muted">{providerLabels[provider] ?? provider}</dt>
					<dd class="font-mono text-xs leading-5">{value}</dd>
				{/each}
			</dl>
		{/if}
	</div>
</div>
