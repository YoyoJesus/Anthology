<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import Icon from '#lib/components/Icon.svelte';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();
	const onSettings = $derived(page.url.pathname.startsWith('/settings'));
	const onLibrary = $derived(page.url.pathname === '/');
	/** A new search keeps the library filters you already picked. */
	const KEPT_FILTERS = ['kind', 'genre', 'rating', 'sort', 'source', 'streaming'];
	const keptFilters = $derived(
		onLibrary
			? KEPT_FILTERS.flatMap((key) => {
					const value = page.url.searchParams.get(key);
					return value ? [[key, value] as const] : [];
				})
			: []
	);
	const searchBy = $derived(onLibrary && page.url.searchParams.get('by') === 'person' ? 'person' : '');
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Anthology</title>
</svelte:head>

{#if data.authenticated}
	<header class="border-b border-line">
		<div class="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
			<a href="/" class="font-serif text-xl tracking-tight">Anthology</a>
			<form action="/" method="get" class="ml-auto flex w-full max-w-sm items-center sm:ml-6" role="search">
				{#each keptFilters as [key, value] (key)}<input type="hidden" name={key} {value} />{/each}
				<label>
					<span class="sr-only">Search by</span>
					<select name="by" class="mr-2 text-sm" value={searchBy}>
						<option value="">Titles</option>
						<option value="person">People</option>
					</select>
				</label>
				<label class="relative w-full">
					<span class="sr-only">Search the library</span>
					<Icon name="search" class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
					<input
						type="search"
						name="q"
						value={onLibrary ? (page.url.searchParams.get('q') ?? '') : ''}
						placeholder="Search titles or people"
						class="w-full pl-9"
					/>
				</label>
			</form>
			<nav class="flex items-center gap-1">
				<a
					href="/settings"
					class="btn btn-quiet {onSettings ? 'text-ink' : ''}"
					aria-current={onSettings ? 'page' : undefined}
				>
					<Icon name="settings" />
					<span class="sr-only sm:not-sr-only">Settings</span>
				</a>
				<form method="post" action="/logout">
					<button class="btn btn-quiet" title="Sign out">
						<Icon name="log-out" />
						<span class="sr-only">Sign out</span>
					</button>
				</form>
			</nav>
		</div>
	</header>
{/if}

<main class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	{@render children()}
</main>
