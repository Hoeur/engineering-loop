import { describe, expect, it } from 'vitest';
import {
  egressAllowed,
  normalizeEgressAllowlist,
  parseDeniedEgress,
  parseEgressRule,
} from './egress-policy';

describe('egress policy', () => {
  it('accepts host:port and wildcard subdomain rules', () => {
    expect(parseEgressRule('API.OpenAI.com:443')).toMatchObject({ port: 443 });
    expect(normalizeEgressAllowlist(['a.com:443', 'A.com:443', '*.b.com:443'])).toEqual([
      'a.com:443',
      '*.b.com:443',
    ]);
  });

  it.each(['a.com', 'https://a.com:443', 'a.com:0', 'a.com:1-100', '*:443', 'a b:443', ''])(
    'rejects malformed rule %j',
    (rule) => {
      expect(() => parseEgressRule(rule)).toThrow();
    },
  );

  it('denies everything not explicitly listed', () => {
    const rules = ['api.openai.com:443', '*.example.com:443'];
    expect(egressAllowed(rules, 'api.openai.com', 443)).toBe(true);
    expect(egressAllowed(rules, 'API.OPENAI.COM', 443)).toBe(true);
    expect(egressAllowed(rules, 'api.openai.com', 80)).toBe(false);
    expect(egressAllowed(rules, 'evil.com', 443)).toBe(false);
    expect(egressAllowed(rules, 'x.example.com', 443)).toBe(true);
    expect(egressAllowed(rules, 'example.com', 443)).toBe(false);
    expect(egressAllowed(rules, 'api.openai.com.evil.com', 443)).toBe(false);
    expect(egressAllowed([], 'api.openai.com', 443)).toBe(false);
  });

  it('extracts unique denied destinations from proxy logs', () => {
    expect(
      parseDeniedEgress('READY\nALLOW api.openai.com:443\nDENY evil.com:443\nDENY evil.com:443\n'),
    ).toEqual(['evil.com:443']);
  });
});
