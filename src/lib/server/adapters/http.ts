const TIMEOUT_MS = 15_000;

export class SourceHttpError extends Error {
	constructor(
		message: string,
		public status?: number
	) {
		super(message);
	}
}

export function joinUrl(baseUrl: string, path: string): string {
	return baseUrl.replace(/\/+$/, '') + (path.startsWith('/') ? path : `/${path}`);
}

export async function sourceFetch(url: string, headers: Record<string, string>): Promise<Response> {
	let res: Response;
	try {
		res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' });
	} catch (err) {
		const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timed out' : 'could not connect';
		throw new SourceHttpError(`Request to ${new URL(url).host} ${reason}`);
	}
	if (res.status === 401 || res.status === 403)
		throw new SourceHttpError('Source rejected the credentials', res.status);
	if (!res.ok) throw new SourceHttpError(`Source responded with HTTP ${res.status}`, res.status);
	return res;
}

export async function sourceJson<T>(url: string, headers: Record<string, string>): Promise<T> {
	const res = await sourceFetch(url, { Accept: 'application/json', ...headers });
	return (await res.json()) as T;
}

export function yearOf(value: number | string | null | undefined): number | null {
	const n = Number(value);
	return Number.isInteger(n) && n > 1800 && n < 3000 ? n : null;
}
