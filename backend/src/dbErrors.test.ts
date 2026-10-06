import { GraphQLError } from 'graphql';
import { describe, expect, it } from 'vitest';
import { isDatabaseUnavailable } from './dbErrors.js';

const withCode = (code: string) => Object.assign(new Error('x'), { code });

describe('isDatabaseUnavailable', () => {
  it.each(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', '57P01', '57P03', '08006', '08001'])(
    'regner %s som nedetid',
    (code) => {
      expect(isDatabaseUnavailable(withCode(code))).toBe(true);
    },
  );

  it('kjenner igjen pg-pools tilkoblingstimeout og AggregateError', () => {
    expect(isDatabaseUnavailable(new Error('timeout exceeded when trying to connect'))).toBe(true);
    const agg = Object.assign(new Error(''), {
      errors: [withCode('ECONNREFUSED'), withCode('ECONNREFUSED')],
    });
    expect(isDatabaseUnavailable(agg)).toBe(true);
  });

  it('pakker ut originalError fra GraphQLError', () => {
    const wrapped = new GraphQLError('x', { originalError: withCode('ECONNREFUSED') });
    expect(isDatabaseUnavailable(wrapped)).toBe(true);
  });

  it('regner ikke vanlige feil, SQL-feil eller ikke-feil som nedetid', () => {
    expect(isDatabaseUnavailable(new Error('boom'))).toBe(false);
    expect(isDatabaseUnavailable(withCode('42P01'))).toBe(false);
    expect(isDatabaseUnavailable(withCode('57014'))).toBe(false);
    expect(isDatabaseUnavailable(null)).toBe(false);
    expect(isDatabaseUnavailable('ECONNREFUSED')).toBe(false);
  });
});
