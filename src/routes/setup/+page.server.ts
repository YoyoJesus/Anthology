import { fail, redirect } from '@sveltejs/kit';
import {
	MIN_PASSWORD_LENGTH,
	SESSION_COOKIE,
	createSession,
	isSetupComplete,
	setAdminPassword
} from '#lib/server/auth.ts';
import { getDb } from '#lib/server/db.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	if (isSetupComplete(getDb())) redirect(303, '/login');
	return { minLength: MIN_PASSWORD_LENGTH };
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const db = getDb();
		if (isSetupComplete(db)) redirect(303, '/login');
		const data = await request.formData();
		const password = String(data.get('password') ?? '');
		if (password.length < MIN_PASSWORD_LENGTH) {
			return fail(400, { error: `Use at least ${MIN_PASSWORD_LENGTH} characters.` });
		}
		if (password !== String(data.get('confirm') ?? '')) return fail(400, { error: 'The passwords do not match.' });

		setAdminPassword(db, password);
		const { token, expires } = createSession(db);
		cookies.set(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', expires });
		redirect(303, '/settings');
	}
};
