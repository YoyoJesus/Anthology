import type { InStatement, InValue } from '@libsql/client';
import type { GenreId } from '#lib/genres.ts';

export interface WorkMetadata {
	workId: number;
	rating: number | null;
	votes: number;
	genres: readonly GenreId[];
}

/** Rows per statement. SQLite allows 32,766 parameters, and fewer statements means fewer round trips to Turso. */
const ROWS_PER_STATEMENT = 300;

function multiRow(prefix: string, suffix: string, rows: InValue[][]): InStatement[] {
	const statements: InStatement[] = [];
	for (let i = 0; i < rows.length; i += ROWS_PER_STATEMENT) {
		const part = rows.slice(i, i + ROWS_PER_STATEMENT);
		const placeholders = part.map((row) => `(${row.map(() => '?').join(', ')})`).join(', ');
		statements.push({ sql: `${prefix} VALUES ${placeholders} ${suffix}`, args: part.flat() });
	}
	return statements;
}

/** Ratings and genres for many works. Unchanged ratings are not rewritten, to keep database writes down. */
export function metadataStatements(rows: WorkMetadata[]): InStatement[] {
	const latest = new Map<number, WorkMetadata>();
	for (const row of rows) latest.set(row.workId, row);
	const ratings: InValue[][] = [];
	const genres: InValue[][] = [];
	for (const row of latest.values()) {
		ratings.push([row.workId, row.rating, row.votes]);
		for (const genre of row.genres) genres.push([row.workId, genre]);
	}
	return [
		...multiRow(
			'INSERT INTO work_ratings (work_id, rating, votes)',
			`ON CONFLICT(work_id) DO UPDATE SET rating = excluded.rating, votes = excluded.votes
			WHERE work_ratings.rating IS NOT excluded.rating OR work_ratings.votes IS NOT excluded.votes`,
			ratings
		),
		...multiRow('INSERT OR IGNORE INTO work_genres (work_id, genre)', '', genres)
	];
}
