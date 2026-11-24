<script lang="ts">
	import AuthForm from '#lib/components/AuthForm.svelte';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
</script>

<svelte:head><title>Sign in · Anthology</title></svelte:head>

<AuthForm title="Sign in" submit="Sign in" error={form?.error}>
	<label class="grid gap-1.5">
		<span class="label">Password</span>
		<!-- svelte-ignore a11y_autofocus -->
		<input type="password" name="password" autocomplete="current-password" required autofocus />
	</label>
</AuthForm>
