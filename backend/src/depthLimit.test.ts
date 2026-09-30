import { buildSchema, parse, validate } from 'graphql';
import { describe, expect, it } from 'vitest';
import { depthLimit } from './depthLimit.js';

// Sirkulært testskjema: det ekte skjemaet kan ikke nøstes dypt nok til å teste regelen.
const schema = buildSchema(`
  type Node { id: ID, child: Node }
  type Query { root: Node }
`);
const check = (q: string, max = 3) => validate(schema, parse(q), [depthLimit(max)]);

describe('depthLimit', () => {
  it('godtar spørring på grensen', () => {
    expect(check('{ root { child { child { id } } } }')).toHaveLength(0);
  });
  it('avviser spørring over grensen med BAD_USER_INPUT', () => {
    const errors = check('{ root { child { child { child { id } } } } }');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.extensions.code).toBe('BAD_USER_INPUT');
  });
  it('teller dybde gjennom fragmenter', () => {
    const q = `
      query { root { ...A } }
      fragment A on Node { child { ...B } }
      fragment B on Node { child { child { id } } }`;
    expect(check(q)).toHaveLength(1);
  });
  it('hopper over introspeksjon', () => {
    expect(check('{ __schema { types { fields { type { ofType { name } } } } } }')).toHaveLength(0);
  });
});
