<script lang="ts">
	let { src, title, class: className = '' }: { src: string | null; title: string; class?: string } = $props();
	let failed = $state(false);
</script>

<div class="relative aspect-[2/3] overflow-hidden rounded-sm bg-raised {className}">
	{#if src && !failed}
		<img {src} alt="" loading="lazy" class="size-full object-cover" onerror={() => (failed = true)} />
	{:else}
		<div class="flex size-full items-end p-3">
			<span class="font-serif text-lg leading-tight text-muted">{title}</span>
		</div>
	{/if}
</div>
