import { fail, redirect } from '@sveltejs/kit';
import {
	SESSION_COOKIE,
	checkPassword,
	clearFailures,
	createSession,
	isRateLimited,
	recordFailure
} from '#lib/server/auth.ts';
import { getDb } from '#lib/server/db.ts';
import type { Actions, PageServerLoad } from './$types';

function safeNext(value: string | null): string {
	return value && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.authenticated) redirect(303, safeNext(url.searchParams.get('next')));
};

export const actions: Actions = {
	default: async ({ request, cookies, url, getClientAddress }) => {
		const client = getClientAddress();
		if (isRateLimited(client)) return fail(429, { error: 'Too many attempts. Try again in a few minutes.' });

		const password = String((await request.formData()).get('password') ?? '');
		const db = getDb();
		if (!checkPassword(db, password)) {
			recordFailure(client);
			return fail(400, { error: 'That password is not correct.' });
		}
		clearFailures(client);
		const { token, expires } = createSession(db);
		cookies.set(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', expires });
		redirect(303, safeNext(url.searchParams.get('next')));
	}
};
