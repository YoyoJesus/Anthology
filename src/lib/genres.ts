/** One genre list for movies and shows. TMDB numbers movie and TV genres separately, and some TV genres are combined. */
export const GENRES = [
	{ id: 'action', name: 'Action', tmdb: [28, 10759] },
	{ id: 'adventure', name: 'Adventure', tmdb: [12, 10759] },
	{ id: 'animation', name: 'Animation', tmdb: [16] },
	{ id: 'comedy', name: 'Comedy', tmdb: [35] },
	{ id: 'crime', name: 'Crime', tmdb: [80] },
	{ id: 'documentary', name: 'Documentary', tmdb: [99] },
	{ id: 'drama', name: 'Drama', tmdb: [18] },
	{ id: 'family', name: 'Family', tmdb: [10751] },
	{ id: 'kids', name: 'Kids', tmdb: [10762] },
	{ id: 'fantasy', name: 'Fantasy', tmdb: [14, 10765] },
	{ id: 'history', name: 'History', tmdb: [36] },
	{ id: 'horror', name: 'Horror', tmdb: [27] },
	{ id: 'music', name: 'Music', tmdb: [10402] },
	{ id: 'mystery', name: 'Mystery', tmdb: [9648] },
	{ id: 'reality', name: 'Reality', tmdb: [10764] },
	{ id: 'romance', name: 'Romance', tmdb: [10749] },
	{ id: 'scifi', name: 'Science fiction', tmdb: [878, 10765] },
	{ id: 'thriller', name: 'Thriller', tmdb: [53] },
	{ id: 'war', name: 'War', tmdb: [10752, 10768] },
	{ id: 'western', name: 'Western', tmdb: [37] }
] as const;

export type GenreId = (typeof GENRES)[number]['id'];

export function isGenreId(value: string): value is GenreId {
	return GENRES.some((genre) => genre.id === value);
}

export function genresFromTmdb(ids: readonly number[] | undefined): GenreId[] {
	if (!ids?.length) return [];
	return GENRES.filter((genre) => genre.tmdb.some((id) => ids.includes(id))).map((genre) => genre.id);
}
