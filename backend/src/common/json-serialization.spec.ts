import { apiJsonReplacer } from './json-serialization';

describe('API JSON serialization', () => {
  it('serializes BigInt database cursors as decimal strings without a global prototype patch', () => {
    expect(JSON.stringify({ cursor: 42n, nested: { sequence: 43n } }, apiJsonReplacer))
      .toBe('{"cursor":"42","nested":{"sequence":"43"}}');
  });

  it('does not alter ordinary values', () => {
    expect(JSON.stringify({ count: 42, ok: true, value: null }, apiJsonReplacer))
      .toBe('{"count":42,"ok":true,"value":null}');
  });
});
