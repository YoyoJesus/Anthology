import type { SourceType } from '#lib/types.ts';
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

	const baseUrl = type === 'mock' ? rawUrl || 'mock://local' : normalizeBaseUrl(rawUrl);
	if (!baseUrl) return { ok: false, error: 'Enter the server address as an http:// or https:// URL.' };
	if (NEEDS_TOKEN.includes(type) && !token) {
		return { ok: false, error: type === 'plex' ? 'Enter your Plex token.' : 'Enter an API key.' };
	}
	return { ok: true, value: { type, name, baseUrl, token } };
}
