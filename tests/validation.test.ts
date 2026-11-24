import { describe, expect, it } from 'vitest';
import { normalizeBaseUrl, parseSourceForm } from '../src/lib/server/validation';

function form(values: Record<string, string>): FormData {
	const data = new FormData();
	for (const [key, value] of Object.entries(values)) data.set(key, value);
	return data;
}

describe('normalizeBaseUrl', () => {
	it('accepts http(s) and trims trailing slashes', () => {
		expect(normalizeBaseUrl(' http://192.168.1.10:8096/ ')).toBe('http://192.168.1.10:8096');
		expect(normalizeBaseUrl('https://media.example.test/jellyfin/')).toBe('https://media.example.test/jellyfin');
	});

	it('rejects other schemes, embedded credentials and junk', () => {
		expect(normalizeBaseUrl('file:///etc/passwd')).toBeNull();
		expect(normalizeBaseUrl('http://user:pass@host')).toBeNull();
		expect(normalizeBaseUrl('http://host/?token=x')).toBeNull();
		expect(normalizeBaseUrl('not a url')).toBeNull();
	});
});

describe('parseSourceForm', () => {
	const allowed = ['plex', 'jellyfin'] as const;

	it('returns a clean source', () => {
		const result = parseSourceForm(
			form({ type: 'jellyfin', name: ' Den ', baseUrl: 'http://jf.test:8096/', token: ' key ' }),
			[...allowed]
		);
		expect(result).toEqual({
			ok: true,
			value: { type: 'jellyfin', name: 'Den', baseUrl: 'http://jf.test:8096', token: 'key' }
		});
	});

	it('rejects unsupported types and missing tokens', () => {
		expect(parseSourceForm(form({ type: 'mock', name: 'x', baseUrl: '' }), [...allowed]).ok).toBe(false);
		const missing = parseSourceForm(form({ type: 'plex', name: 'x', baseUrl: 'http://p.test' }), [...allowed]);
		expect(missing).toEqual({ ok: false, error: 'Enter your Plex token.' });
	});
});
