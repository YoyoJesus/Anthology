<script lang="ts">
	import AuthForm from '#lib/components/AuthForm.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head><title>Set up · Anthology</title></svelte:head>

{#if data.requireEnv}
	<div class="mx-auto mt-[12vh] w-full max-w-sm">
		<p class="font-serif text-3xl tracking-tight">Anthology</p>
		<h1 class="mt-6 text-lg font-medium">Set an admin password</h1>
		<p class="mt-2 text-sm text-muted">
			Add <code>ADMIN_PASSWORD</code> to the project's environment variables and redeploy. On a public URL, first-run setup
			is turned off so nobody else can claim the app.
		</p>
	</div>
{:else}
	<AuthForm title="Create the admin password" submit="Continue" error={form?.error}>
		<p class="text-sm text-muted">
			This password protects the whole app. You can also set it with the <code>ADMIN_PASSWORD</code> environment variable.
		</p>
		<label class="grid gap-1.5">
			<span class="label">Password</span>
			<input type="password" name="password" autocomplete="new-password" minlength={data.minLength} required />
		</label>
		<label class="grid gap-1.5">
			<span class="label">Confirm password</span>
			<input type="password" name="confirm" autocomplete="new-password" minlength={data.minLength} required />
		</label>
	</AuthForm>
{/if}
