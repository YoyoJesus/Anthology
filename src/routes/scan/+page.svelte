<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import Icon from '#lib/components/Icon.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	interface Detector {
		detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
	}
	type DetectorClass = new (options: { formats: string[] }) => Detector;

	const FORMATS = ['ean_13', 'upc_a', 'ean_8', 'upc_e'];
	/** The same barcode is ignored for this long, so holding a disc in view does not look it up twice. */
	const REPEAT_MS = 8_000;

	let collectionId = $state<number | null>(null);
	const selected = $derived(collectionId ?? data.collections[0]?.id ?? null);
	let busy = $state<string | null>(null);
	let barcode = $state('');
	let query = $state('');
	let log = $state<{ label: string; notice: string }[]>([]);

	let video = $state<HTMLVideoElement>();
	let lookupForm = $state<HTMLFormElement>();
	let cameraOn = $state(false);
	let cameraError = $state<string | null>(null);
	let support = $state<'checking' | 'ok' | 'insecure' | 'unsupported'>('checking');

	$effect(() => {
		const Detector = (window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
		if (!window.isSecureContext) support = 'insecure';
		else if (!Detector || !navigator.mediaDevices?.getUserMedia) support = 'unsupported';
		else support = 'ok';
	});

	$effect(() => {
		if (!cameraOn || !video) return;
		const Detector = (window as unknown as { BarcodeDetector: DetectorClass }).BarcodeDetector;
		const detector = new Detector({ formats: FORMATS });
		const el = video;
		let stream: MediaStream | undefined;
		let stopped = false;
		let last = { code: '', at: 0 };
		let timer: ReturnType<typeof setInterval> | undefined;

		navigator.mediaDevices
			.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
			.then((s) => {
				if (stopped) return s.getTracks().forEach((t) => t.stop());
				stream = s;
				el.srcObject = s;
				return el.play();
			})
			.then(() => {
				timer = setInterval(async () => {
					if (busy || el.readyState < 2) return;
					const found = await detector.detect(el).catch(() => []);
					const code = found[0]?.rawValue;
					if (!code || (code === last.code && Date.now() - last.at < REPEAT_MS)) return;
					last = { code, at: Date.now() };
					navigator.vibrate?.(60);
					barcode = code;
					queueMicrotask(() => lookupForm?.requestSubmit());
				}, 300);
			})
			.catch(() => {
				cameraError = 'Could not open the camera. Check that this site is allowed to use it.';
				cameraOn = false;
			});

		return () => {
			stopped = true;
			clearInterval(timer);
			stream?.getTracks().forEach((t) => t.stop());
			el.srcObject = null;
		};
	});

	function track(key: string): SubmitFunction {
		return () => {
			busy = key;
			return async ({ update }) => {
				await update({ reset: false });
				busy = null;
				if (form && 'lookup' in form && form.lookup) query = form.lookup.query;
				if (form && 'added' in form && form.added) {
					log = [form.added, ...log];
					barcode = '';
				}
			};
		};
	}

	const lookup = $derived(form && 'lookup' in form ? form.lookup : undefined);
	const addError = $derived(form && 'add' in form ? form.add?.error : undefined);
	const candidates = $derived(lookup && 'candidates' in lookup ? lookup.candidates : []);
	const lookupError = $derived(lookup && 'error' in lookup ? lookup.error : undefined);
</script>

<svelte:head><title>Scan discs · Anthology</title></svelte:head>

<div class="mx-auto max-w-lg">
	<h1 class="font-serif text-3xl tracking-tight">Scan discs</h1>
	<p class="mt-1 text-sm text-muted">
		Scan the barcode on a DVD or Blu-ray to add it to a collection. Barcodes are looked up on UPCitemdb{data.tmdbConfigured
			? ', titles on TMDB'
			: ''}.
	</p>

	{#if !data.collections.length}
		<form method="post" action="?/createCollection" use:enhance={track('create')} class="mt-6 flex gap-2">
			<label class="flex-1">
				<span class="label">New collection</span>
				<input name="name" value="Discs" class="mt-1 w-full" />
			</label>
			<button class="btn btn-primary self-end" disabled={busy !== null}>
				<Icon name="plus" />
				Create
			</button>
		</form>
	{:else}
		{#if data.collections.length > 1}
			<label class="mt-6 block">
				<span class="label">Add to</span>
				<select class="mt-1 w-full" value={selected} onchange={(e) => (collectionId = Number(e.currentTarget.value))}>
					{#each data.collections as c (c.id)}
						<option value={c.id}>{c.name} ({c.itemCount})</option>
					{/each}
				</select>
			</label>
		{:else}
			<p class="mt-6 text-sm text-muted">
				Adding to <span class="text-ink">{data.collections[0].name}</span>
				({data.collections[0].itemCount}
				{data.collections[0].itemCount === 1 ? 'title' : 'titles'}).
			</p>
		{/if}

		<section class="mt-4" aria-label="Camera">
			{#if support === 'insecure'}
				<p class="flex items-start gap-2 text-sm text-danger">
					<Icon name="circle-alert" class="mt-0.5 shrink-0" />
					The camera only works over HTTPS. Open Anthology at its https:// address, or type the barcode below.
				</p>
			{:else if support === 'unsupported'}
				<p class="flex items-start gap-2 text-sm text-danger">
					<Icon name="circle-alert" class="mt-0.5 shrink-0" />
					This browser cannot read barcodes. Use Chrome on Android, or type the barcode below.
				</p>
			{:else if support === 'ok'}
				<div class="relative aspect-[4/3] overflow-hidden rounded-md border border-line bg-raised">
					{#if cameraOn}
						<!-- svelte-ignore a11y_media_has_caption -->
						<video bind:this={video} playsinline muted class="size-full object-cover"></video>
						<div class="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-accent/70"></div>
						{#if busy === 'lookup'}
							<p class="absolute inset-x-0 bottom-0 bg-paper/80 px-3 py-2 text-sm">Looking up {barcode}</p>
						{/if}
					{:else}
						<button
							type="button"
							class="flex size-full flex-col items-center justify-center gap-2 text-muted hover:text-ink"
							onclick={() => {
								cameraError = null;
								cameraOn = true;
							}}
						>
							<Icon name="camera" class="size-8" />
							<span class="text-sm font-medium">Start camera</span>
						</button>
					{/if}
				</div>
				{#if cameraOn}
					<button type="button" class="btn btn-quiet mt-2" onclick={() => (cameraOn = false)}>
						<Icon name="camera-off" />
						Stop camera
					</button>
				{/if}
				{#if cameraError}<p class="mt-2 text-sm text-danger" role="alert">{cameraError}</p>{/if}
			{/if}
		</section>

		<form bind:this={lookupForm} method="post" action="?/lookup" use:enhance={track('lookup')} class="mt-4 flex gap-2">
			<label class="flex-1">
				<span class="sr-only">Barcode</span>
				<input
					name="barcode"
					bind:value={barcode}
					inputmode="numeric"
					autocomplete="off"
					placeholder="Barcode"
					class="w-full"
				/>
			</label>
			<button class="btn" disabled={busy !== null || !barcode.trim()}>
				<Icon name="scan-barcode" />
				Look up
			</button>
		</form>

		<form method="post" action="?/search" use:enhance={track('search')} class="mt-2 flex gap-2">
			<label class="flex-1">
				<span class="sr-only">Title</span>
				<input name="q" bind:value={query} autocomplete="off" placeholder="Or search by title" class="w-full" />
			</label>
			<button class="btn" disabled={busy !== null || !query.trim()}>
				<Icon name="search" />
				Search
			</button>
		</form>

		{#if lookupError}
			<p class="mt-4 flex items-start gap-2 text-sm text-danger" role="alert">
				<Icon name="circle-alert" class="mt-0.5 shrink-0" />{lookupError}
			</p>
		{/if}
		{#if addError}
			<p class="mt-4 flex items-start gap-2 text-sm text-danger" role="alert">
				<Icon name="circle-alert" class="mt-0.5 shrink-0" />{addError}
			</p>
		{/if}

		{#if candidates.length}
			<section class="mt-6" aria-labelledby="matches-heading">
				<h2 id="matches-heading" class="label">Matches</h2>
				{#if lookup && 'product' in lookup && lookup.product}
					<p class="mt-1 text-sm text-muted">
						Read as "{lookup.product}"{lookup.format ? ` (${lookup.format})` : ''}.
					</p>
				{/if}
				<ul class="mt-3 divide-y divide-line border-y border-line">
					{#each candidates as c (c.kind + c.tmdbId + c.title)}
						<li class="flex items-center gap-3 py-2">
							<div class="aspect-[2/3] w-12 shrink-0 overflow-hidden rounded bg-raised">
								{#if c.poster}
									<img src="/posters/tmdb{c.poster}" alt="" loading="lazy" class="size-full object-cover" />
								{:else}
									<div class="flex size-full items-center justify-center text-faint">
										<Icon name={c.kind === 'show' ? 'tv' : 'film'} />
									</div>
								{/if}
							</div>
							<div class="min-w-0 flex-1">
								<p class="truncate font-medium">{c.title}</p>
								<p class="text-sm text-muted">{c.year ?? 'Year unknown'} · {c.kind === 'show' ? 'TV' : 'Movie'}</p>
							</div>
							<form method="post" action="?/add" use:enhance={track('add')}>
								<input type="hidden" name="collection" value={selected} />
								<input type="hidden" name="title" value={c.title} />
								<input type="hidden" name="year" value={c.year ?? ''} />
								<input type="hidden" name="kind" value={c.kind} />
								<button class="btn btn-primary" disabled={busy !== null}>
									<Icon name="plus" />
									Add
								</button>
							</form>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if log.length}
			<section class="mt-6" aria-labelledby="log-heading">
				<h2 id="log-heading" class="label">This session</h2>
				<ul class="mt-2 space-y-1 text-sm">
					{#each log as entry, i (i)}
						<li class="flex items-start gap-2">
							<Icon name="circle-check" class="mt-0.5 shrink-0 text-ok" />
							<span><span class="text-ink">{entry.label}</span> <span class="text-muted">{entry.notice}</span></span>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	{/if}
</div>
