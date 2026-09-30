import { describe, expect, it } from 'vitest';
import {
  buildTitleIndex,
  chooseFiles,
  extractImdbId,
  extractYear,
  isLawful,
  licenseLabel,
  licenseLink,
  linkItem,
  matchByTitle,
  normalizeTitle,
  parseDuration,
} from './import-archive.js';

describe('isLawful', () => {
  it('godtar Creative Commons og public domain-erklæringer', () => {
    expect(isLawful({ licenseurl: 'https://creativecommons.org/licenses/by/4.0/' })).toBe(true);
    expect(isLawful({ licenseurl: 'http://creativecommons.org/licenses/by-nc-nd/3.0/' })).toBe(
      true,
    );
    expect(isLawful({ licenseurl: 'creativecommons.org/licenses/by/2.0' })).toBe(true);
    expect(isLawful({ licenseurl: 'https://creativecommons.org/publicdomain/zero/1.0/' })).toBe(
      true,
    );
    expect(isLawful({ licenseurl: 'http://www.usa.gov/publicdomain/label/1.0/' })).toBe(true);
    expect(
      isLawful({ licenseurl: ['http://example.com/x', 'https://creativecommons.org/a'] }),
    ).toBe(true);
  });

  it('godtar kuraterte samlinger uten lisens-URL, som streng eller liste', () => {
    for (const c of ['feature_films', 'film_noir', 'silent_films']) {
      expect(isLawful({ collection: c })).toBe(true);
      expect(isLawful({ collection: ['movies', c] })).toBe(true);
    }
  });

  it('avviser alt annet', () => {
    expect(isLawful({})).toBe(false);
    expect(isLawful({ collection: 'classic_tv' })).toBe(false);
    expect(isLawful({ collection: ['movies', 'opensource_movies'] })).toBe(false);
    expect(isLawful({ licenseurl: 'http://example.com/all-rights-reserved' })).toBe(false);
    expect(isLawful({ licenseurl: '' })).toBe(false);
    expect(isLawful({ licenseurl: null, collection: null })).toBe(false);
  });

  it('lar seg ikke lure av en annen vert som nevner creativecommons.org', () => {
    expect(
      isLawful({ licenseurl: 'http://evil.example/creativecommons.org/licenses/by/4.0' }),
    ).toBe(false);
    expect(isLawful({ licenseurl: 'http://creativecommons.org.evil.example/x' })).toBe(false);
  });
});

describe('licenseLabel / licenseLink', () => {
  it('mapper lisens-URL til kort tekst', () => {
    const l = (licenseurl: string) => licenseLabel({ licenseurl });
    expect(l('https://creativecommons.org/licenses/by/4.0/')).toBe('CC BY 4.0');
    expect(l('http://creativecommons.org/licenses/by-sa/3.0/de/')).toBe('CC BY-SA 3.0');
    expect(l('https://creativecommons.org/licenses/by-nc-nd/2.5/')).toBe('CC BY-NC-ND 2.5');
    expect(l('https://creativecommons.org/publicdomain/zero/1.0/')).toBe('CC0');
    expect(l('https://creativecommons.org/publicdomain/mark/1.0/')).toBe('Public Domain');
    expect(l('http://www.usa.gov/publicdomain/label/1.0/')).toBe('Public Domain');
    expect(l('https://creativecommons.org/weird')).toBe('Creative Commons');
  });

  it('kuratert samling uten lisens-URL er Public Domain', () => {
    expect(licenseLabel({ collection: 'feature_films' })).toBe('Public Domain');
    expect(licenseLink({ collection: 'feature_films' })).toBeNull();
  });

  it('gir lisenslenken videre', () => {
    expect(licenseLink({ licenseurl: 'https://creativecommons.org/licenses/by/4.0/' })).toBe(
      'https://creativecommons.org/licenses/by/4.0/',
    );
  });
});

describe('normalizeTitle', () => {
  it('fjerner aksenter, tegnsetting, store bokstaver og ledende the/a', () => {
    expect(normalizeTitle('Amélie')).toBe('amelie');
    expect(normalizeTitle('The Godfather')).toBe('godfather');
    expect(normalizeTitle('A Trip to the Moon')).toBe('trip to the moon');
    expect(normalizeTitle("Don't Look Up!")).toBe('don t look up');
    expect(normalizeTitle('  Pulp   Fiction:  ')).toBe('pulp fiction');
    expect(normalizeTitle('Æon Flux')).toBe('æon flux');
  });
  it('rører ikke the/a midt i tittelen, og «The» alene beholdes', () => {
    expect(normalizeTitle('Into the Wild')).toBe('into the wild');
    expect(normalizeTitle('The')).toBe('the');
    expect(normalizeTitle('!!!')).toBe('');
  });
});

describe('extractImdbId / extractYear', () => {
  it('finner urn:imdb i streng eller liste', () => {
    expect(extractImdbId('urn:imdb:tt0111161')).toBe('tt0111161');
    expect(extractImdbId(['urn:oclc:record:1', 'URN:IMDB:TT0068646'])).toBe('tt0068646');
    expect(extractImdbId('urn:imdb:nm0000001')).toBeNull();
    expect(extractImdbId('urn:imdb:tt12')).toBeNull();
    expect(extractImdbId(undefined)).toBeNull();
  });
  it('leser år fra year, ellers date', () => {
    expect(extractYear({ year: '1944' })).toBe(1944);
    expect(extractYear({ year: 1944 })).toBe(1944);
    expect(extractYear({ date: '1931-01-01T00:00:00Z' })).toBe(1931);
    expect(extractYear({ year: 'unknown', date: '1950-05-05' })).toBe(1950);
    expect(extractYear({ year: '0000' })).toBeNull();
    expect(extractYear({})).toBeNull();
  });
});

describe('kobling', () => {
  const index = buildTitleIndex([
    { id: 'tt1', primary_title: 'Metropolis', original_title: 'Metropolis', start_year: 1927 },
    {
      id: 'tt2',
      primary_title: 'Nosferatu',
      original_title: 'Nosferatu, eine Symphonie',
      start_year: 1922,
    },
    { id: 'tt3', primary_title: 'Dark City', original_title: 'Dark City', start_year: 1950 },
    { id: 'tt4', primary_title: 'Dark City', original_title: 'Dark City', start_year: 1998 },
    { id: 'tt5', primary_title: 'Dark City', original_title: 'Dark City', start_year: 1999 },
    { id: 'tt6', primary_title: 'Yearless', original_title: 'Yearless', start_year: null },
  ]);

  it('matcher på normalisert tittel og år ±1', () => {
    expect(matchByTitle(index, 'METROPOLIS!', 1927)).toBe('tt1');
    expect(matchByTitle(index, 'The Metropolis', 1926)).toBe('tt1');
    expect(matchByTitle(index, 'Metropolis', 1928)).toBe('tt1');
    expect(matchByTitle(index, 'Metropolis', 1929)).toBeNull();
  });
  it('matcher også originaltittel', () => {
    expect(matchByTitle(index, 'Nosferatu, eine Symphonie', 1922)).toBe('tt2');
  });
  it('hopper over tvetydige treff, manglende år og titler uten treff', () => {
    expect(matchByTitle(index, 'Dark City', 1998)).toBeNull(); // tt4 og tt5 innen ±1
    expect(matchByTitle(index, 'Dark City', 1950)).toBe('tt3');
    expect(matchByTitle(index, 'Metropolis', null)).toBeNull();
    expect(matchByTitle(index, 'Yearless', 1990)).toBeNull();
    expect(matchByTitle(index, '???', 1990)).toBeNull();
  });

  it('IMDb-ID slår tittel, og ukjent ID faller tilbake til tittel + år', () => {
    const known = { hasId: (id: string) => id === 'tt0000009', titles: index };
    expect(
      linkItem(
        {
          identifier: 'a',
          title: 'Metropolis',
          year: '1927',
          'external-identifier': 'urn:imdb:tt0000009',
        },
        known,
      ),
    ).toEqual({ titleId: 'tt0000009', via: 'imdb' });
    expect(
      linkItem(
        {
          identifier: 'a',
          title: 'Metropolis',
          year: '1927',
          'external-identifier': 'urn:imdb:tt0000008',
        },
        known,
      ),
    ).toEqual({ titleId: 'tt1', via: 'title' });
    expect(linkItem({ identifier: 'a', title: 'Ukjent', year: '1927' }, known)).toBeNull();
    expect(linkItem({ identifier: 'a', year: '1927' }, known)).toBeNull();
  });
});

describe('parseDuration', () => {
  it('leser sekunder og tid', () => {
    expect(parseDuration('5401.23')).toBe(5401);
    expect(parseDuration('90')).toBe(90);
    expect(parseDuration(61.6)).toBe(62);
    expect(parseDuration('01:30:01')).toBe(5401);
    expect(parseDuration('90:01')).toBe(5401);
    expect(parseDuration('0:08')).toBe(8);
    expect(parseDuration(' 00:00:08.4 ')).toBe(8);
  });
  it('gir null for ugyldig, null og urimelig', () => {
    for (const v of ['', 'abc', '0', '-5', '1:2:3:4', undefined, null, NaN, {}, '999999']) {
      expect(parseDuration(v)).toBeNull();
    }
  });
});

describe('chooseFiles', () => {
  const f = (name: string, format: string, size?: number, extra = {}) => ({
    name,
    format,
    ...(size ? { size: String(size) } : {}),
    ...extra,
  });

  it('foretrekker h.264 foran 512Kb foran stor MPEG4-original', () => {
    const files = [
      f('film.mpg', 'MPEG2', 9e9),
      f('film.mp4', 'MPEG4', 4e9, { source: 'original', length: '5400.5' }),
      f('film_512kb.mp4', '512Kb MPEG4', 4e8),
      f('film.ia.mp4', 'h.264 IA', 1e9),
    ];
    expect(chooseFiles(files)?.fileName).toBe('film.ia.mp4');
    expect(chooseFiles(files.slice(0, 3))?.fileName).toBe('film_512kb.mp4');
    expect(chooseFiles(files.slice(0, 2))?.fileName).toBe('film.mp4');
  });
  it('velger minste fil innen samme klasse', () => {
    const files = [f('a.mp4', 'h.264', 2e9), f('b.mp4', 'h.264', 1e9)];
    expect(chooseFiles(files)?.fileName).toBe('b.mp4');
  });
  it('mp4 foran webm foran ogv', () => {
    expect(chooseFiles([f('a.ogv', 'Ogg Video'), f('a.webm', 'WebM')])?.fileName).toBe('a.webm');
    expect(chooseFiles([f('a.webm', 'WebM'), f('a.mp4', 'h.264')])?.fileName).toBe('a.mp4');
  });
  it('tar også ukjente mp4-formater som siste utvei', () => {
    expect(chooseFiles([f('a.mp4', 'Something')])?.fileName).toBe('a.mp4');
  });
  it('hopper over filer i undermapper og med farlige navn', () => {
    expect(chooseFiles([f('dir/a.mp4', 'h.264'), f('../b.mp4', 'h.264')])).toBeNull();
    expect(chooseFiles([f('dir/a.mp4', 'h.264'), f('c.webm', 'WebM')])?.fileName).toBe('c.webm');
  });
  it('gir null uten spillbar fil eller ugyldig liste', () => {
    expect(chooseFiles([f('a.mkv', 'Matroska'), f('a.avi', 'AVI'), f('a.jpg', 'JPEG')])).toBeNull();
    expect(chooseFiles([])).toBeNull();
    expect(chooseFiles(undefined)).toBeNull();
    expect(chooseFiles({})).toBeNull();
    expect(chooseFiles([null, 3, 'x'])).toBeNull();
  });
  it('henter varighet fra valgt fil, ellers fra en annen fil i elementet', () => {
    expect(chooseFiles([f('a.mp4', 'h.264', 1, { length: '01:00:00' })])?.durationSeconds).toBe(
      3600,
    );
    expect(
      chooseFiles([f('a.mp4', 'h.264'), f('a.mkv', 'Matroska', 1, { length: '120.4' })])
        ?.durationSeconds,
    ).toBe(120);
    expect(chooseFiles([f('a.mp4', 'h.264')])?.durationSeconds).toBeNull();
  });
  it('velger .vtt, helst med samme grunnnavn', () => {
    const files = [
      f('film.mp4', 'h.264'),
      f('other.vtt', 'WebVTT'),
      f('film.en.vtt', 'WebVTT'),
      f('dir/x.vtt', 'WebVTT'),
    ];
    expect(chooseFiles(files)?.subtitlesFile).toBe('film.en.vtt');
    expect(chooseFiles([f('film.mp4', 'h.264'), f('z.vtt', 'WebVTT')])?.subtitlesFile).toBe(
      'z.vtt',
    );
    expect(chooseFiles([f('film.mp4', 'h.264'), f('a.srt', 'SubRip')])?.subtitlesFile).toBeNull();
  });
});
