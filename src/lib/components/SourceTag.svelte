<script lang="ts">
	import type { SourceType } from '#lib/types.ts';

	let { name, type }: { name: string; type: SourceType } = $props();

	const dot: Record<SourceType, string> = {
		plex: 'bg-src-plex',
		jellyfin: 'bg-src-jellyfin',
		navidrome: 'bg-src-navidrome',
		kodi: 'bg-src-kodi',
		roms: 'bg-src-roms',
		collection: 'bg-src-collection',
		mock: 'bg-src-mock'
	};
</script>

<span class="inline-flex items-center gap-1.5 text-xs text-muted">
	<span class="size-1.5 shrink-0 rounded-full {dot[type]}"></span>
	<span class="truncate">{name}</span>
</span>
