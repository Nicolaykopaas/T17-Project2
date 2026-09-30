import { createWriteStream, mkdirSync } from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { createGzip } from 'node:zlib';
import { config } from '../src/config.js';
import { BASICS_HEADER, RATINGS_HEADER } from './import-core.js';

/**
 * Genererer syntetiske filer i NØYAKTIG IMDb-format, fordi datasets.imdbws.com ikke er
 * tilgjengelig i alle miljøer. Samme importkode brukes for ekte og syntetiske data.
 * Deterministisk: samme seed gir byte-identiske filer.
 */

// mulberry32: liten, rask PRNG med god nok fordeling for testdata.
export function createRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)] as T,
    /** Standard normalfordeling (Box-Muller). */
    gauss: () => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next()),
  };
}
type Rng = ReturnType<typeof createRng>;

const GENRES = [
  'Action',
  'Adventure',
  'Animation',
  'Biography',
  'Comedy',
  'Crime',
  'Documentary',
  'Drama',
  'Family',
  'Fantasy',
  'History',
  'Horror',
  'Music',
  'Musical',
  'Mystery',
  'Romance',
  'Sci-Fi',
  'Sport',
  'Thriller',
  'War',
  'Western',
] as const;

// Vektet: Drama og Comedy er langt vanligere enn Western og Sport, som i ekte data.
const GENRE_WEIGHTS: Record<string, number> = {
  Drama: 30,
  Comedy: 22,
  Action: 12,
  Documentary: 10,
  Thriller: 9,
  Romance: 9,
  Crime: 8,
  Horror: 8,
  Adventure: 7,
  Mystery: 5,
  'Sci-Fi': 4,
  Fantasy: 4,
  Family: 4,
  Animation: 4,
  Biography: 3,
  History: 3,
  Music: 3,
  War: 2,
  Musical: 2,
  Western: 2,
  Sport: 2,
};
const WEIGHTED_GENRES = GENRES.flatMap((g) => Array<string>(GENRE_WEIGHTS[g] ?? 1).fill(g));

const ADJECTIVES = [
  'Dark',
  'Silent',
  'Last',
  'Lost',
  'Golden',
  'Broken',
  'Hidden',
  'Eternal',
  'Crimson',
  'Wild',
  'Frozen',
  'Burning',
  'Secret',
  'Final',
  'Endless',
  'Forgotten',
  'Savage',
  'Gentle',
  'Electric',
  'Midnight',
  'Distant',
  'Hollow',
  'Bitter',
  'Scarlet',
  'Iron',
  'Velvet',
  'Restless',
  'Sacred',
  'Fallen',
  'Brave',
  'Cold',
  'Blind',
  'Rising',
  'Infinite',
  'Quiet',
  'Neon',
];
const NOUNS = [
  'Knight',
  'City',
  'River',
  'Garden',
  'Empire',
  'Storm',
  'Mirror',
  'Highway',
  'Harvest',
  'Ghost',
  'Kingdom',
  'Island',
  'Letter',
  'Promise',
  'Shadow',
  'Horizon',
  'Witness',
  'Voyage',
  'Symphony',
  'Circus',
  'Detective',
  'Bridge',
  'Season',
  'Desert',
  'Lighthouse',
  'Warrior',
  'Dream',
  'Harbor',
  'Frontier',
  'Assassin',
  'Orchard',
  'Machine',
  'Summer',
  'Winter',
  'Tower',
  'Legacy',
  'Rebellion',
  'Cathedral',
  'Diary',
  'Fortune',
];
const PLACES = [
  'Paris',
  'Oslo',
  'Tokyo',
  'Cairo',
  'Lisbon',
  'Havana',
  'Bergen',
  'Vienna',
  'Casablanca',
  'Montréal',
  'São Paulo',
  'Zürich',
  'København',
  'Kraków',
  'Málaga',
  'Reykjavík',
  'Bogotá',
];
const PEOPLE = [
  'Anna',
  'Marco',
  'Élodie',
  'Søren',
  'Ingrid',
  'Zoë',
  'Nikolai',
  'Amélie',
  'Renée',
  'Lars',
  'Chloé',
  'José',
  'Mateo',
  'Freya',
  'Björn',
];
const SUBTITLES = [
  'The Beginning',
  'Redemption',
  'Origins',
  'Reckoning',
  'A New Dawn',
  'Part II',
  'Homecoming',
  'The Final Chapter',
  'Vengeance',
  'Awakening',
];
// Utenlandske originaltitler, med aksenter og spesialtegn for å teste tegnsett og søk.
const FOREIGN = [
  'Le Café des Rêves',
  'Ça commence ici',
  'Über den Wolken',
  'El Niño perdido',
  'Der letzte Zug',
  'La Vie en Rose',
  'Ångström',
  'Il ragazzo dell’Est',
  'Hôtel du Nord',
  'Où es-tu, Élise ?',
];

function makeTitle(rng: Rng): string {
  const r = rng.next();
  const adj = rng.pick(ADJECTIVES);
  const noun = rng.pick(NOUNS);
  if (r < 0.2) return `The ${adj} ${noun}`;
  if (r < 0.32) return `${adj} ${noun}`;
  if (r < 0.42) return `${noun} of ${rng.pick(NOUNS)}s`;
  if (r < 0.5) return `${rng.pick(PEOPLE)}'s ${noun}`;
  if (r < 0.58) return `The ${adj} ${noun}: ${rng.pick(SUBTITLES)}`;
  if (r < 0.64) return `Return to ${rng.pick(PLACES)}`;
  if (r < 0.7) return `A ${noun} in ${rng.pick(PLACES)}`;
  if (r < 0.75) return `${rng.pick(PEOPLE)} & ${rng.pick(PEOPLE)}`;
  if (r < 0.79) return `Café ${rng.pick(PLACES)}`;
  if (r < 0.82) return `${rng.pick(PEOPLE)}: ${adj} ${noun}`;
  if (r < 0.85) return `${adj} ${noun} ${rng.int(2, 5)}`;
  if (r < 0.88) return `Don't Look ${rng.pick(['Back', 'Up', 'Down'])}, ${rng.pick(PEOPLE)}`;
  if (r < 0.91) return `Night ${rng.pick(['in', 'at', 'over'])} ${rng.pick(PLACES)}`;
  return `${adj} ${noun}s`;
}

function makeGenres(rng: Rng): string {
  const n = rng.pick([1, 1, 2, 2, 2, 3, 3]);
  const set = new Set<string>();
  while (set.size < n) set.add(rng.pick(WEIGHTED_GENRES));
  return [...set].join(',');
}

interface BasicsRow {
  tconst: string;
  titleType: string;
  primaryTitle: string;
  originalTitle: string;
  isAdult: string;
  startYear: string;
  endYear: string;
  runtimeMinutes: string;
  genres: string;
}
interface RatingRow {
  tconst: string;
  averageRating: string;
  numVotes: string;
}
interface Entry {
  basics: BasicsRow;
  rating: RatingRow | null;
}

const N = '\\N';

// Kjente titler så søk og E2E-tester har noe gjenkjennelig å lete etter.
const FAMOUS: [string, string, string, string, string, string, string, number, number][] = [
  // tconst, type, tittel, år, sluttår, minutter, sjangre, rating, stemmer
  ['tt0111161', 'movie', 'The Shawshank Redemption', '1994', N, '142', 'Drama', 9.3, 2900000],
  ['tt0068646', 'movie', 'The Godfather', '1972', N, '175', 'Crime,Drama', 9.2, 2000000],
  ['tt0468569', 'movie', 'The Dark Knight', '2008', N, '152', 'Action,Crime,Drama', 9.0, 2900000],
  [
    'tt0903747',
    'tvSeries',
    'Breaking Bad',
    '2008',
    '2013',
    '49',
    'Crime,Drama,Thriller',
    9.5,
    2200000,
  ],
  ['tt0133093', 'movie', 'The Matrix', '1999', N, '136', 'Action,Sci-Fi', 8.7, 2100000],
  ['tt0110912', 'movie', 'Pulp Fiction', '1994', N, '154', 'Crime,Drama', 8.9, 2200000],
  ['tt0211915', 'movie', 'Amélie', '2001', N, '122', 'Comedy,Romance', 8.3, 800000],
  [
    'tt0944947',
    'tvSeries',
    'Game of Thrones',
    '2011',
    '2019',
    '57',
    'Action,Adventure,Drama',
    9.2,
    2400000,
  ],
  [
    'tt0167260',
    'movie',
    'The Lord of the Rings: The Return of the King',
    '2003',
    N,
    '201',
    'Action,Adventure,Drama',
    9.0,
    1900000,
  ],
  ['tt5491994', 'tvMiniSeries', 'Planet Earth II', '2016', N, '50', 'Documentary', 9.5, 150000],
  [
    'tt0095327',
    'movie',
    'Grave of the Fireflies',
    '1988',
    N,
    '89',
    'Animation,Drama,War',
    8.5,
    300000,
  ],
  ['tt0109830', 'movie', 'Forrest Gump', '1994', N, '142', 'Drama,Romance', 8.8, 2300000],
  ['tt0407887', 'movie', 'The Departed', '2006', N, '151', 'Crime,Drama,Thriller', 8.5, 1400000],
  ['tt0364569', 'movie', 'Oldboy', '2003', N, '120', 'Action,Drama,Mystery', 8.3, 600000],
];

function pad(n: number): string {
  return String(n).padStart(7, '0');
}

export function generateEntries(size: number, seed = 2810): Entry[] {
  const rng = createRng(seed);
  const entries: Entry[] = [];
  const usedIds = new Set(FAMOUS.map((f) => f[0]));

  for (const [tconst, type, title, start, end, runtime, genres, rating, votes] of FAMOUS) {
    entries.push({
      basics: {
        tconst,
        titleType: type,
        primaryTitle: title,
        originalTitle: title,
        isAdult: '0',
        startYear: start,
        endYear: end,
        runtimeMinutes: runtime,
        genres,
      },
      rating: { tconst, averageRating: rating.toFixed(1), numVotes: String(votes) },
    });
  }

  let idNum = 1;
  const nextId = () => {
    idNum += rng.int(1, 40);
    let id = `tt${pad(idNum)}`;
    while (usedIds.has(id)) id = `tt${pad(++idNum)}`;
    return id;
  };

  const keep = size - FAMOUS.length;
  const addRow = (kind: 'keep' | 'noise') => {
    let type: string;
    let votes: number;
    if (kind === 'keep') {
      const r = rng.next();
      type = r < 0.78 ? 'movie' : r < 0.96 ? 'tvSeries' : 'tvMiniSeries';
      // Log-normal fordeling: mange obskure titler nær 100 stemmer, noen få med millioner.
      votes = Math.min(2_500_000, 100 + Math.floor(Math.exp(rng.gauss() * 1.7 + 5.2)));
    } else {
      const r = rng.next();
      // Typer og tilfeller importen skal filtrere bort.
      type =
        r < 0.4
          ? 'tvEpisode'
          : r < 0.55
            ? 'short'
            : r < 0.65
              ? 'video'
              : r < 0.72
                ? 'videoGame'
                : r < 0.8
                  ? 'tvSpecial'
                  : r < 0.9
                    ? 'tvMovie'
                    : rng.pick(['movie', 'tvSeries']);
      // Bare «movie/tvSeries» av støy-radene er filtrert bort på stemmer.
      votes = type === 'movie' || type === 'tvSeries' ? rng.int(5, 99) : rng.int(5, 5000);
    }
    const tconst = nextId();
    const primary = makeTitle(rng);
    const foreign = rng.next() < 0.1;
    const year = Math.min(2025, Math.max(1920, Math.round(2000 + rng.gauss() * 22)));
    const isSeries = type === 'tvSeries' || type === 'tvMiniSeries';
    const ended = isSeries && rng.next() < 0.6;
    const missingYear = rng.next() < 0.01;
    const rating = Math.min(9.9, Math.max(1.0, 6.3 + rng.gauss() * 1.1));
    entries.push({
      basics: {
        tconst,
        titleType: type,
        primaryTitle: primary,
        originalTitle: foreign ? rng.pick(FOREIGN) : primary,
        isAdult: rng.next() < 0.01 ? '1' : '0',
        startYear: missingYear ? N : String(year),
        endYear: ended && !missingYear ? String(Math.min(2025, year + rng.int(1, 12))) : N,
        runtimeMinutes:
          rng.next() < 0.03 ? N : String(isSeries ? rng.int(20, 60) : rng.int(70, 180)),
        genres: rng.next() < 0.02 ? N : makeGenres(rng),
      },
      rating: { tconst, averageRating: rating.toFixed(1), numVotes: String(votes) },
    });
  };

  for (let i = 0; i < keep; i++) addRow('keep');
  // ~ 35 % støy oppå: episoder, kortfilmer, spill og titler med for få stemmer.
  for (let i = 0; i < Math.round(size * 0.35); i++) addRow('noise');

  // Kanttilfeller: tittel uten rating i ratings-fila, og rating uten tittel i basics.
  entries.push({
    basics: {
      tconst: nextId(),
      titleType: 'movie',
      primaryTitle: 'Uten Rating',
      originalTitle: 'Uten Rating',
      isAdult: '0',
      startYear: '2020',
      endYear: N,
      runtimeMinutes: N,
      genres: N,
    },
    rating: null,
  });

  entries.sort((a, b) => (a.basics.tconst < b.basics.tconst ? -1 : 1));
  return entries;
}

async function writeGz(file: string, header: string[], lines: Iterable<string[]>) {
  const gzip = createGzip();
  const out = createWriteStream(file);
  gzip.pipe(out);
  const write = async (parts: string[]) => {
    // Respekterer backpressure så store filer ikke bygger opp i minnet.
    if (!gzip.write(parts.join('\t') + '\n')) await once(gzip, 'drain');
  };
  await write(header);
  for (const l of lines) await write(l);
  gzip.end();
  await once(out, 'finish');
}

export async function generateFixture(dir: string, size: number, seed = 2810): Promise<void> {
  mkdirSync(dir, { recursive: true });
  const entries = generateEntries(size, seed);
  await writeGz(
    path.join(dir, 'title.basics.tsv.gz'),
    BASICS_HEADER,
    entries.map((e) => BASICS_HEADER.map((h) => e.basics[h as keyof BasicsRow])),
  );
  const rated = entries.filter((e) => e.rating !== null);
  // Rating uten matchende tittel (finnes i ekte data, f.eks. for fjernede titler).
  const orphan: RatingRow = { tconst: 'tt9999999', averageRating: '7.0', numVotes: '1000' };
  const ratingRows = [...rated.map((e) => e.rating as RatingRow), orphan].sort((a, b) =>
    a.tconst < b.tconst ? -1 : 1,
  );
  await writeGz(
    path.join(dir, 'title.ratings.tsv.gz'),
    RATINGS_HEADER,
    ratingRows.map((r) => RATINGS_HEADER.map((h) => r[h as keyof RatingRow])),
  );
}

async function main() {
  const size = Number(process.env.FIXTURE_SIZE ?? process.argv[2] ?? 120_000);
  if (!Number.isInteger(size) || size < 20) throw new Error('FIXTURE_SIZE må være heltall ≥ 20.');
  console.log(`Genererer ca. ${size} titler i ${config.imdbDataDir} ...`);
  await generateFixture(config.imdbDataDir, size);
  console.log('Ferdig: title.basics.tsv.gz og title.ratings.tsv.gz');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
