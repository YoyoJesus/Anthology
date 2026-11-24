import { redirect } from '@sveltejs/kit';
import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { building } from '$app/env';
import { SESSION_COOKIE, isSetupComplete, validateSession } from '#lib/server/auth.ts';
import { getDb } from '#lib/server/db.ts';
import { startScheduler } from '#lib/server/jobs.ts';

export const init: ServerInit = () => {
	if (!building) startScheduler();
};

const PUBLIC_PATHS = ['/login', '/setup'];

export const handle: Handle = async ({ event, resolve }) => {
	const db = getDb();
	const path = event.url.pathname;
	event.locals.authenticated = validateSession(db, event.cookies.get(SESSION_COOKIE));

	if (!isSetupComplete(db)) {
		if (path !== '/setup') redirect(303, '/setup');
	} else if (!event.locals.authenticated && !PUBLIC_PATHS.includes(path)) {
		redirect(303, `/login?next=${encodeURIComponent(path + event.url.search)}`);
	}

	const response = await resolve(event);
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'same-origin');
	return response;
};
