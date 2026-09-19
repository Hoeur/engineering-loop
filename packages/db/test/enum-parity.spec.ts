import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOMAIN_ENUMS } from '@engloop/types';

/**
 * Guard rail for the "single source of truth" claim in enums.ts: every member of
 * every domain enum must exist in schema.prisma, and vice versa. Adding a task
 * status in one place and forgetting the other fails here rather than at runtime.
 */
const schema = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');

const parsePrismaEnums = (source: string): Record<string, string[]> => {
  const result: Record<string, string[]> = {};
  const pattern = /^enum\s+(\w+)\s*\{([^}]*)\}/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const [, name, body] = match;
    if (!name || !body) continue;
    result[name] = body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('//') && !line.startsWith('@'));
  }
  return result;
};

const prismaEnums = parsePrismaEnums(schema);

describe('domain enum parity', () => {
  it('parses every enum block from schema.prisma', () => {
    expect(Object.keys(prismaEnums).length).toBeGreaterThanOrEqual(35);
  });

  for (const [enumName, members] of Object.entries(DOMAIN_ENUMS)) {
    it(`${enumName} matches schema.prisma`, () => {
      const prismaMembers = prismaEnums[enumName];
      expect(prismaMembers, `enum ${enumName} is missing from schema.prisma`).toBeDefined();
      expect([...Object.values(members)].sort()).toEqual([...(prismaMembers ?? [])].sort());
    });
  }
});
