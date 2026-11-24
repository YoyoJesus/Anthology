import { fail, redirect } from '@sveltejs/kit';
import {
	MIN_PASSWORD_LENGTH,
	SESSION_COOKIE,
	createSession,
	isSetupComplete,
	setAdminPassword
} from '#lib/server/auth.ts';
import { config } from '#lib/server/config.ts';
import { getDb } from '#lib/server/db.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	if (await isSetupComplete(await getDb())) redirect(303, '/login');
	return { minLength: MIN_PASSWORD_LENGTH, requireEnv: config.onVercel };
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const db = await getDb();
		if (await isSetupComplete(db)) redirect(303, '/login');
		// A public deployment must not let the first visitor pick the password.
		if (config.onVercel) return fail(403, { error: 'Set ADMIN_PASSWORD in the Vercel project settings.' });
		const data = await request.formData();
		const password = String(data.get('password') ?? '');
		if (password.length < MIN_PASSWORD_LENGTH) {
			return fail(400, { error: `Use at least ${MIN_PASSWORD_LENGTH} characters.` });
		}
		if (password !== String(data.get('confirm') ?? '')) return fail(400, { error: 'The passwords do not match.' });

		await setAdminPassword(db, password);
		const { token, expires } = await createSession(db);
		cookies.set(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', expires });
		redirect(303, '/settings');
	}
};
