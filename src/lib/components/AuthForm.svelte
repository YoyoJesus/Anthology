<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	let { title, submit, error, children }: { title: string; submit: string; error?: string; children: Snippet } =
		$props();
</script>

<div class="mx-auto mt-[12vh] w-full max-w-sm">
	<p class="font-serif text-3xl tracking-tight">Anthology</p>
	<h1 class="mt-6 text-lg font-medium">{title}</h1>
	<form method="post" class="mt-4 grid gap-4">
		{@render children()}
		{#if error}
			<p class="flex items-center gap-2 text-sm text-danger" role="alert">
				<Icon name="circle-alert" />
				{error}
			</p>
		{/if}
		<button class="btn btn-primary justify-center">{submit}</button>
	</form>
</div>
