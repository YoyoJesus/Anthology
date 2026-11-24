<script lang="ts">
	import Icon from '@iconify/svelte';
	import { icons, type IconName } from '#lib/icons.ts';

	let { name, class: className = 'size-4' }: { name: IconName; class?: string } = $props();
</script>

<Icon icon={icons[name]} class={className} aria-hidden="true" />
