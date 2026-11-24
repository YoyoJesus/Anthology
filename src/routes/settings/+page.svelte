<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import { onMount } from 'svelte';
	import Icon from '#lib/components/Icon.svelte';
	import SourceTag from '#lib/components/SourceTag.svelte';
	import { STREAMING_SERVICES, type SourceType } from '#lib/types.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const typeLabels: Record<SourceType, string> = {
		plex: 'Plex',
		jellyfin: 'Jellyfin',
		navidrome: 'Navidrome',
		kodi: 'Kodi',
		roms: 'Game ROMs',
		mock: 'Sample data'
	};

	let type = $state<SourceType>('jellyfin');
	let busy = $state<string | null>(null);
	let mounted = $state(false);
	onMount(() => (mounted = true));

	const placeholders: Partial<Record<SourceType, string>> = {
		plex: 'http://192.168.1.10:32400',
		jellyfin: 'http://192.168.1.10:8096'
	};

	function formatSync(value: string | null): string {
		if (!value) return 'Never synced';
		const date = new Date(`${value.replace(' ', 'T')}Z`);
		if (!mounted) return `Synced ${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
		return `Synced ${date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
	}

	function track(key: string): SubmitFunction {
		return ({ action }) => {
			busy = key;
			return async ({ update }) => {
				await update({ reset: !action.search.includes('testNew') });
				busy = null;
			};
		};
	}

	const addResult = $derived(form && 'add' in form ? form.add : undefined);
	const rowResult = $derived(form && 'row' in form ? form.row : undefined);
	const streamingResult = $derived(form && 'streaming' in form ? form.streaming : undefined);
</script>

<svelte:head><title>Settings · Anthology</title></svelte:head>

<h1 class="font-serif text-3xl tracking-tight">Settings</h1>

<section class="mt-8" aria-labelledby="sources-heading">
	<h2 id="sources-heading" class="text-lg font-medium">Sources</h2>

	{#if data.sources.length}
		<ul class="mt-3 divide-y divide-line border-y border-line">
			{#each data.sources as source (source.id)}
				<li class="grid gap-3 py-4 md:grid-cols-[1fr_auto] md:items-center">
					<div class="min-w-0">
						<div class="flex flex-wrap items-baseline gap-x-3">
							<span class="font-medium {source.enabled ? '' : 'text-muted'}">{source.name}</span>
							<SourceTag name={typeLabels[source.type]} type={source.type} />
							{#if !source.enabled}<span class="text-xs text-faint">Paused</span>{/if}
						</div>
						<p class="mt-0.5 truncate font-mono text-xs text-faint">{source.baseUrl}</p>
						<p class="mt-1 text-sm text-muted">
							{source.itemCount}
							{source.itemCount === 1 ? 'item' : 'items'} in {source.libraryCount}
							{source.libraryCount === 1 ? 'library' : 'libraries'} · {formatSync(source.lastSyncAt)}
						</p>
						{#if rowResult?.id === source.id && 'notice' in rowResult}
							<p class="mt-1 flex items-center gap-1.5 text-sm text-ok">
								<Icon name="circle-check" />{rowResult.notice}
							</p>
						{:else if rowResult?.id === source.id && 'error' in rowResult}
							<p class="mt-1 flex items-center gap-1.5 text-sm text-danger" role="alert">
								<Icon name="circle-alert" />{rowResult.error}
							</p>
						{:else if source.lastSyncError}
							<p class="mt-1 flex items-center gap-1.5 text-sm text-danger">
								<Icon name="circle-alert" />Last sync failed: {source.lastSyncError}
							</p>
						{/if}
					</div>

					<div class="flex flex-wrap items-center gap-2">
						<form method="post" action="?/sync" use:enhance={track(`sync-${source.id}`)}>
							<input type="hidden" name="id" value={source.id} />
							<button class="btn btn-primary" disabled={busy !== null || source.syncing}>
								<Icon
									name="refresh-cw"
									class="size-4 {busy === `sync-${source.id}` ? 'animate-spin motion-reduce:animate-none' : ''}"
								/>
								{busy === `sync-${source.id}` || source.syncing ? 'Syncing' : 'Sync now'}
							</button>
						</form>
						<form method="post" action="?/test" use:enhance={track(`test-${source.id}`)}>
							<input type="hidden" name="id" value={source.id} />
							<button class="btn" disabled={busy !== null}><Icon name="plug-zap" />Test</button>
						</form>
						<form method="post" action="?/toggle" use:enhance={track(`toggle-${source.id}`)}>
							<input type="hidden" name="id" value={source.id} />
							<input type="hidden" name="enabled" value={String(!source.enabled)} />
							<button
								class="btn"
								disabled={busy !== null}
								title={source.enabled ? 'Pause scheduled syncs' : 'Resume scheduled syncs'}
							>
								<Icon name="power" />{source.enabled ? 'Pause' : 'Resume'}
							</button>
						</form>
						<form
							method="post"
							action="?/remove"
							use:enhance={({ cancel }) => {
								if (!confirm(`Remove ${source.name}? Its items leave the library.`)) return cancel();
								busy = `remove-${source.id}`;
								return async ({ update }) => {
									await update();
									busy = null;
								};
							}}
						>
							<input type="hidden" name="id" value={source.id} />
							<button class="btn btn-quiet hover:text-danger" disabled={busy !== null} title="Remove source">
								<Icon name="trash-2" /><span class="sr-only">Remove {source.name}</span>
							</button>
						</form>
					</div>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="mt-2 text-muted">No sources yet. Add your first server below.</p>
	{/if}
</section>

<section class="mt-12 max-w-xl" aria-labelledby="add-heading">
	<h2 id="add-heading" class="text-lg font-medium">Add a source</h2>
	<form method="post" action="?/add" class="mt-4 grid gap-4" use:enhance={track('add')}>
		<label class="grid gap-1.5">
			<span class="label">Type</span>
			<select name="type" bind:value={type}>
				{#each data.types as option (option)}
					<option value={option}>{typeLabels[option]}</option>
				{/each}
			</select>
		</label>
		<label class="grid gap-1.5">
			<span class="label">Name</span>
			<input name="name" required maxlength="60" placeholder="Living room {typeLabels[type]}" />
		</label>
		{#if type !== 'mock'}
			<label class="grid gap-1.5">
				<span class="label">Server URL</span>
				<input name="baseUrl" type="url" required placeholder={placeholders[type]} />
			</label>
		{/if}
		<label class="grid gap-1.5">
			<span class="label">{type === 'plex' ? 'Plex token' : type === 'mock' ? 'Dataset' : 'API key'}</span>
			{#if type === 'mock'}
				<select name="token">
					<option value="alpha">Alpha</option>
					<option value="beta">Beta</option>
				</select>
			{:else}
				<input name="token" type="password" required autocomplete="off" spellcheck="false" />
			{/if}
			<span class="text-xs text-faint">
				{#if type === 'plex'}
					In Plex Web, open any item, choose Get Info, then View XML. The token is the X-Plex-Token value in the address
					bar.
				{:else if type === 'jellyfin'}
					Create one in the Jellyfin dashboard under API Keys.
				{:else}
					Two overlapping sample libraries for trying out matching without a real server.
				{/if}
			</span>
		</label>

		{#if addResult && 'error' in addResult}
			<p class="flex items-center gap-1.5 text-sm text-danger" role="alert">
				<Icon name="circle-alert" />{addResult.error}
			</p>
		{:else if addResult && 'tested' in addResult}
			<p class="flex items-center gap-1.5 text-sm text-ok">
				<Icon name="circle-check" />Connected to {addResult.name}.
			</p>
		{/if}

		<div class="flex gap-2">
			<button class="btn btn-primary" disabled={busy !== null}><Icon name="plus" />Add source</button>
			<button class="btn" formaction="?/testNew" disabled={busy !== null}>
				<Icon name="plug-zap" />Test connection
			</button>
		</div>
	</form>
</section>

<section class="mt-12 max-w-xl" aria-labelledby="streaming-heading">
	<h2 id="streaming-heading" class="text-lg font-medium">Streaming services</h2>
	<p class="mt-1 text-sm text-muted">
		Tick the services you subscribe to. Titles in your library that one of them streams in region {data.streaming
			.region}
		are marked, and you can filter by them.
	</p>

	<form method="post" action="?/saveStreaming" class="mt-4" use:enhance={track('streaming')}>
		<fieldset class="grid gap-2 sm:grid-cols-2">
			<legend class="sr-only">Services</legend>
			{#each STREAMING_SERVICES as service (service.id)}
				<label class="flex items-center gap-2 text-sm">
					<input
						type="checkbox"
						name="service"
						value={service.id}
						checked={data.streaming.enabled.includes(service.id)}
						class="size-4 accent-accent"
					/>
					{service.name}
				</label>
			{/each}
		</fieldset>

		{#if streamingResult && 'error' in streamingResult}
			<p class="mt-3 flex items-center gap-1.5 text-sm text-danger" role="alert">
				<Icon name="circle-alert" />{streamingResult.error}
			</p>
		{:else if streamingResult && 'notice' in streamingResult}
			<p class="mt-3 flex items-center gap-1.5 text-sm text-ok"><Icon name="circle-check" />{streamingResult.notice}</p>
		{/if}

		<div class="mt-4 flex flex-wrap items-center gap-2">
			<button class="btn btn-primary" disabled={busy !== null}>Save services</button>
			{#if data.streaming.configured}
				<button class="btn" formaction="?/refreshStreaming" disabled={busy !== null || data.streaming.refreshing}>
					<Icon
						name="refresh-cw"
						class="size-4 {busy === 'streaming' ? 'animate-spin motion-reduce:animate-none' : ''}"
					/>
					Check availability
				</button>
			{/if}
		</div>
	</form>

	<p class="mt-4 text-sm text-muted">
		{#if data.streaming.configured}
			{data.streaming.checked}
			{data.streaming.checked === 1 ? 'title' : 'titles'} checked. Availability refreshes after each sync and is rechecked
			weekly. Only titles with a TMDB ID can be looked up.
		{:else}
			Set <code>TMDB_READ_TOKEN</code> to a TMDB API read access token to turn on lookups.
		{/if}
	</p>
	<p class="mt-2 text-xs text-faint">
		Streaming data from JustWatch via TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.
	</p>
</section>
