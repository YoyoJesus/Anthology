<script lang="ts">
	import Icon from '#lib/components/Icon.svelte';
	import Poster from '#lib/components/Poster.svelte';
	import SourceTag from '#lib/components/SourceTag.svelte';
	import { STREAMING_SERVICES } from '#lib/types.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const work = $derived(data.work);

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

<a href="/" class="btn btn-quiet -ml-2"><Icon name="arrow-left" />Library</a>

<div class="mt-4 grid gap-8 sm:grid-cols-[minmax(0,14rem)_1fr]">
	<Poster src={work.posterUrl} title={work.title} class="w-40 sm:w-full" />

	<div class="min-w-0">
		<h1 class="font-serif text-4xl leading-tight tracking-tight">{work.title}</h1>
		<p class="mt-1 text-muted">{work.year ?? 'Unknown year'} · {work.kind === 'show' ? 'Show' : 'Movie'}</p>

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
			<p class="mt-2">
				{work.streaming.map((id) => STREAMING_SERVICES.find((s) => s.id === id)?.name ?? id).join(', ')}
			</p>
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
