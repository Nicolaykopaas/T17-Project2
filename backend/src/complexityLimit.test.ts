import { buildSchema, parse, validate } from 'graphql';
import { describe, expect, it } from 'vitest';
import { complexityLimit } from './complexityLimit.js';

const schema = buildSchema(`
  type Node { id: ID, name: String, child: Node }
  type Query { root: Node }
`);
const check = (q: string, maxRootFields = 3, maxFields = 10) =>
  validate(schema, parse(q), [complexityLimit({ maxRootFields, maxFields })]);

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
});
