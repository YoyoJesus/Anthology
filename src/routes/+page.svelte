<script lang="ts">
	import Poster from '#lib/components/Poster.svelte';
	import SourceTag from '#lib/components/SourceTag.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const serviceNames = $derived(new Map(data.streamingServices.map((service) => [service.id as string, service.name])));

	const kinds = [
		{ value: '', label: 'All' },
		{ value: 'movie', label: 'Movies' },
		{ value: 'show', label: 'Shows' }
	];

	function href(changes: Record<string, string | number>): string {
		const params = new URLSearchParams();
		const merged = { ...data.filters, page: '', ...changes };
		for (const [key, value] of Object.entries(merged)) if (value !== '' && value !== 1) params.set(key, String(value));
		const query = params.toString();
		return query ? `/?${query}` : '/';
	}
</script>

<svelte:head><title>{data.filters.q ? `${data.filters.q} · ` : ''}Anthology</title></svelte:head>

<div class="flex flex-wrap items-end justify-between gap-4">
	<div>
		<h1 class="font-serif text-3xl tracking-tight">
			{data.filters.q ? `Results for “${data.filters.q}”` : 'Library'}
		</h1>
		<p class="mt-1 text-sm text-muted">{data.total} {data.total === 1 ? 'title' : 'titles'}</p>
	</div>

	<div class="flex flex-wrap items-center gap-3">
		<nav class="flex rounded-md border border-line p-0.5 text-sm" aria-label="Media kind">
			{#each kinds as kind (kind.value)}
				<a
					href={href({ kind: kind.value })}
					class="rounded px-3 py-1.5 {data.filters.kind === kind.value
						? 'bg-raised text-ink'
						: 'text-muted hover:text-ink'}"
					aria-current={data.filters.kind === kind.value ? 'true' : undefined}
				>
					{kind.label}
				</a>
			{/each}
		</nav>
		{#if data.sources.length > 1 || data.streamingServices.length}
			<form method="get" action="/" class="flex flex-wrap gap-3">
				{#if data.filters.q}<input type="hidden" name="q" value={data.filters.q} />{/if}
				{#if data.filters.kind}<input type="hidden" name="kind" value={data.filters.kind} />{/if}
				{#if data.sources.length > 1}
					<label>
						<span class="sr-only">Source</span>
						<select name="source" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
							<option value="" selected={data.filters.source === ''}>All sources</option>
							{#each data.sources as source (source.id)}
								<option value={source.id} selected={data.filters.source === source.id}>{source.name}</option>
							{/each}
						</select>
					</label>
				{:else if data.filters.source}
					<input type="hidden" name="source" value={data.filters.source} />
				{/if}
				{#if data.streamingServices.length}
					<label>
						<span class="sr-only">Streaming</span>
						<select name="streaming" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
							<option value="" selected={data.filters.streaming === ''}>Any availability</option>
							<option value="any" selected={data.filters.streaming === 'any'}>On my services</option>
							{#each data.streamingServices as service (service.id)}
								<option value={service.id} selected={data.filters.streaming === service.id}>On {service.name}</option>
							{/each}
						</select>
					</label>
				{/if}
				<noscript><button class="btn">Apply</button></noscript>
			</form>
		{/if}
	</div>
</div>

{#if data.works.length}
	<ul class="mt-6 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
		{#each data.works as work (work.id)}
			<li>
				<a href="/works/{work.id}" class="group block">
					<Poster itemId={work.posterItemId} title={work.title} class="ring-accent transition group-hover:ring-2" />
					<p class="mt-2 truncate text-sm font-medium" title={work.title}>{work.title}</p>
					<p class="text-xs text-faint">{work.year ?? 'Unknown year'} · {work.kind === 'show' ? 'Show' : 'Movie'}</p>
					<div class="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
						{#each work.sources as source (source.sourceId)}
							<SourceTag name={source.sourceName} type={source.sourceType} />
						{/each}
					</div>
					{#if work.streaming.length}
						<p class="mt-0.5 truncate text-xs text-faint">
							{work.streaming.map((id) => serviceNames.get(id) ?? id).join(' · ')}
						</p>
					{/if}
				</a>
			</li>
		{/each}
	</ul>

	{#if data.pageCount > 1}
		<nav class="mt-10 flex items-center justify-center gap-4 text-sm" aria-label="Pagination">
			{#if data.page > 1}<a class="btn" href={href({ page: data.page - 1 })}>Previous</a>{/if}
			<span class="text-muted">Page {data.page} of {data.pageCount}</span>
			{#if data.page < data.pageCount}<a class="btn" href={href({ page: data.page + 1 })}>Next</a>{/if}
		</nav>
	{/if}
{:else}
	<div class="mt-16 max-w-md">
		{#if !data.sources.length}
			<p class="text-lg">No sources yet.</p>
			<p class="mt-1 text-muted">Add a Plex or Jellyfin server and run a sync to fill the library.</p>
			<a href="/settings" class="btn btn-primary mt-4">Add a source</a>
		{:else if data.filters.q}
			<p class="text-lg">Nothing matches “{data.filters.q}”.</p>
			<a href={href({ q: '' })} class="mt-2 inline-block text-sm text-accent hover:underline">Clear search</a>
		{:else if data.sources.every((s) => s.itemCount === 0)}
			<p class="text-lg">Nothing synced yet.</p>
			<p class="mt-1 text-muted">Run a sync from Settings to pull in your libraries.</p>
			<a href="/settings" class="btn mt-4">Open settings</a>
		{:else}
			<p class="text-lg">No titles match these filters.</p>
			<a href="/" class="mt-2 inline-block text-sm text-accent hover:underline">Reset filters</a>
		{/if}
	</div>
{/if}
