<script lang="ts">
	let { itemId, title, class: className = '' }: { itemId: number | null; title: string; class?: string } = $props();
	let failed = $state(false);
</script>

<div class="relative aspect-[2/3] overflow-hidden rounded-sm bg-raised {className}">
	{#if itemId && !failed}
		<img src="/posters/{itemId}" alt="" loading="lazy" class="size-full object-cover" onerror={() => (failed = true)} />
	{:else}
		<div class="flex size-full items-end p-3">
			<span class="font-serif text-lg leading-tight text-muted">{title}</span>
		</div>
	{/if}
</div>
