import { buildSchema, parse, validate } from 'graphql';
import { describe, expect, it } from 'vitest';
import { complexityLimit } from './complexityLimit.js';

const schema = buildSchema(`
  type Node { id: ID, name: String, child: Node, reviews(first: Int): Node }
  type Query { root: Node, facets: Node, search(first: Int): Node, myList(first: Int): Node }
`);
const check = (q: string, maxRootFields = 3, maxFields = 10, maxCost = 1e9) =>
  validate(schema, parse(q), [complexityLimit({ maxRootFields, maxFields, maxCost })]);

const aliases = (n: number) => Array.from({ length: n }, (_, i) => `a${i}: root { id }`).join(' ');

describe('complexityLimit', () => {
  it('godtar rotfelt akkurat på grensen og avviser ett over', () => {
    expect(check(`{ ${aliases(3)} }`, 3, 100)).toHaveLength(0);
    const errors = check(`{ ${aliases(4)} }`, 3, 100);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.extensions.code).toBe('BAD_USER_INPUT');
    expect(errors[0]?.message).toContain('rotfelt');
  });

  it('teller aliaser av samme felt hver for seg', () => {
    expect(check(`{ ${aliases(500)} }`, 8, 1000)).toHaveLength(1);
  });

  it('teller felt totalt: grensen er inklusiv', () => {
    // root + id + name + child + id + name = 6 felt.
    const q = '{ root { id name child { id name } } }';
    expect(check(q, 3, 6)).toHaveLength(0);
    const errors = check(q, 3, 5);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.extensions.code).toBe('BAD_USER_INPUT');
    expect(errors[0]?.message).toContain('6 felt');
  });

  it('teller felt i fragmenter og inline-fragmenter, og hvert bruk av fragmentet', () => {
    const q = `
      query { root { ...F } b: root { ...F } c: root { ... on Node { id name } } }
      fragment F on Node { id name }`;
    // 3 rotfelt + 2 + 2 + 2 = 9
    expect(check(q, 3, 9)).toHaveLength(0);
    expect(check(q, 3, 8)).toHaveLength(1);
  });

  it('hopper over introspeksjon', () => {
    expect(check('{ __schema { types { fields { type { ofType { name } } } } } }')).toHaveLength(0);
  });

  it('tåler eksponentielt voksende og sirkulære fragmenter uten å henge', () => {
    // Hvert nivå bruker det neste ti ganger: 10^8 noder uten memoisering.
    const levels = 8;
    let doc = '{ root { ...F0 } }';
    for (let i = 0; i < levels; i++) {
      const uses = Array.from({ length: 10 }, () => `...F${i + 1}`).join(' ');
      doc += ` fragment F${i} on Node { ${uses} }`;
    }
    doc += ` fragment F${levels} on Node { id }`;
    const started = Date.now();
    expect(check(doc, 3, 1000)).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(500);
    // Sirkel A -> B -> A: selve avvisningen gjøres av NoFragmentCycles; vi må bare ikke løpe i ring.
    expect(() =>
      check('{ root { ...A } } fragment A on Node { child { ...B } } fragment B on Node { ...A }'),
    ).not.toThrow();
  });

  it('tåler eksponentielt voksende fragmentkjeder spredt fra rotnivå (CPU-DoS)', () => {
    // 636 byte i originalrapporten: 8 nivåer med ti spredninger hver tok ca. 60 s uten memoisering.
    const levels = 8;
    let doc = '{ ...F0 }';
    for (let i = 0; i < levels; i++) {
      const uses = Array.from({ length: 10 }, () => `...F${i + 1}`).join(' ');
      doc += ` fragment F${i} on Query { ${uses} }`;
    }
    doc += ` fragment F${levels} on Query { root { id } }`;
    const started = Date.now();
    const errors = check(doc, 8, 1000);
    expect(Date.now() - started).toBeLessThan(200);
    // 10^8 rotfelt: må avvises, og med rotfelt-meldingen.
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('rotfelt');
  });

  describe('vektet kostnad (first)', () => {
    const cost = (q: string, max: number) => check(q, 100, 1000, max);

    it('vekter feltene under en liste med literal first', () => {
      // search(1) + 50 x (id + name = 2) = 101
      const q = '{ search(first: 50) { id name } }';
      expect(cost(q, 101)).toHaveLength(0);
      const errors = cost(q, 100);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.extensions.code).toBe('BAD_USER_INPUT');
      expect(errors[0]?.message).toContain('first');
    });

    it('bruker standard sidestørrelse når first utelates (search: 20, reviews: 10)', () => {
      expect(cost('{ search { id } }', 21)).toHaveLength(0);
      expect(cost('{ search { id } }', 20)).toHaveLength(1);
      // search(1) + 20 x (reviews(1) + 10 x id) = 1 + 20 x 11 = 221
      expect(cost('{ search { reviews { id } } }', 221)).toHaveLength(0);
      expect(cost('{ search { reviews { id } } }', 220)).toHaveLength(1);
    });

    it('regner en variabel first som 50, også når den har en lav standardverdi', () => {
      expect(cost('query($n: Int) { search(first: $n) { id } }', 51)).toHaveLength(0);
      expect(cost('query($n: Int) { search(first: $n) { id } }', 50)).toHaveLength(1);
      // Standardverdien kan overstyres av klienten, så den skal ikke gi rabatt.
      expect(cost('query($n: Int = 5) { search(first: $n) { id } }', 51)).toHaveLength(0);
      expect(cost('query($n: Int = 5) { search(first: $n) { id } }', 50)).toHaveLength(1);
    });

    it('stopper omgåelsen via standardverdi på variabel (default 1, sendt som 50)', () => {
      const q =
        'query($n: Int = 1) { a: search(first: $n) { id name } b: search(first: $n) { id name } }';
      // Regnet som first = 1 ville dette kostet 2 x (1 + 2) = 6; riktig er 2 x (1 + 50 x 2) = 202.
      const errors = cost(q, 100);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.message).toContain('kostbar');
    });

    it('multipliserer nøstede lister og avviser 8 x search(first: 50) med reviews(first: 50)', () => {
      const one = 'search(first: 50) { id reviews(first: 50) { id name } }';
      const q = `{ ${Array.from({ length: 8 }, (_, i) => `s${i}: ${one}`).join(' ')} }`;
      // Under rotfelt- og totalgrensene, men 8 x 50 x 50 x ... er enormt.
      const errors = check(q, 8, 1000, 2500);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.message).toContain('kostbar');
    });

    it('gir facets en høy fast vekt slik at aliasede facets stoppes', () => {
      const facets = (n: number) =>
        `{ ${Array.from({ length: n }, (_, i) => `f${i}: facets { id }`).join(' ')} }`;
      // Hver forekomst: 1 + 500 + 1 (id) = 502; grensen 2 500 rommer fire, ikke fem.
      expect(check(facets(1), 8, 100, 2500)).toHaveLength(0);
      expect(check(facets(4), 8, 100, 2500)).toHaveLength(0);
      const errors = check(facets(5), 8, 100, 2500);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.message).toContain('kostbar');
      // 8 aliaser (rotfeltgrensen) ga før 32 parallelle aggregeringer.
      expect(check(facets(8), 8, 100, 2500)).toHaveLength(1);
    });

    it('teller listevekt gjennom fragmenter', () => {
      const q = '{ search(first: 10) { ...F } } fragment F on Node { id name }';
      // 1 + 10 x 2 = 21
      expect(cost(q, 21)).toHaveLength(0);
      expect(cost(q, 20)).toHaveLength(1);
    });
  });
});
