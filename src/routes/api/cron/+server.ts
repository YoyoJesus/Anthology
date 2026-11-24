import { error, json } from '@sveltejs/kit';
import { timingSafeEqual } from 'node:crypto';
import { config } from '#lib/server/config.ts';
import { runScheduledJobs } from '#lib/server/jobs.ts';
import type { RequestHandler } from './$types';

function authorized(header: string | null, secret: string): boolean {
	const expected = Buffer.from(`Bearer ${secret}`);
	const actual = Buffer.from(header ?? '');
	return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export const GET: RequestHandler = async ({ request }) => {
	if (!config.cronSecret) error(503, 'CRON_SECRET is not set');
	if (!authorized(request.headers.get('authorization'), config.cronSecret)) error(401, 'Unauthorized');
	return json(await runScheduledJobs(50_000));
};
