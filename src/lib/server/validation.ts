import type { SourceType } from '#lib/types.ts';
import { parseCollection } from './adapters/collection';
import type { NewSource } from './sources';

export type SourceFormResult = { ok: true; value: NewSource } | { ok: false; error: string };

const NEEDS_TOKEN: SourceType[] = ['plex', 'jellyfin', 'navidrome'];

export function normalizeBaseUrl(input: string): string | null {
	let url: URL;
	try {
		url = new URL(input.trim());
	} catch {
		return null;
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
	if (url.username || url.password || url.search || url.hash) return null;
	return url.toString().replace(/\/+$/, '');
}

export function parseSourceForm(form: FormData, allowed: SourceType[]): SourceFormResult {
	const type = String(form.get('type') ?? '') as SourceType;
	const name = String(form.get('name') ?? '').trim();
	const token = String(form.get('token') ?? '').trim();
	const rawUrl = String(form.get('baseUrl') ?? '').trim();

	if (!allowed.includes(type)) return { ok: false, error: 'Choose a supported source type.' };
	if (!name || name.length > 60) return { ok: false, error: 'Give the source a name of up to 60 characters.' };

	if (type === 'collection') {
		const collection = parseCollectionText(form.get('collection'));
		if (!collection.ok) return collection;
		return { ok: true, value: { type, name, baseUrl: 'collection://local', token: '', collection: collection.value } };
	}

	const baseUrl = type === 'mock' ? rawUrl || 'mock://local' : normalizeBaseUrl(rawUrl);
	if (!baseUrl) return { ok: false, error: 'Enter the server address as an http:// or https:// URL.' };
	if (NEEDS_TOKEN.includes(type) && !token) {
		return { ok: false, error: type === 'plex' ? 'Enter your Plex token.' : 'Enter an API key.' };
	}
	return { ok: true, value: { type, name, baseUrl, token } };
}

const MAX_COLLECTION_CHARS = 300_000;

export function parseCollectionText(
	value: FormDataEntryValue | null
): { ok: true; value: string } | { ok: false; error: string } {
	const text = typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : '';
	if (text.length > MAX_COLLECTION_CHARS)
		return { ok: false, error: 'That list is too long. Split it into two collections.' };
	if (!parseCollection(text).entries.length) return { ok: false, error: 'Add at least one title, one per line.' };
	return { ok: true, value: text };
}
