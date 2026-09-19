import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface CollectedContext {
  files: Record<string, string>;
  truncated: string[];
  missing: string[];
}

export interface CollectContextOptions {
  rootPath: string;
  files: readonly string[];
  maxBytesPerFile: number;
}

/**
 * Reads repository-level agent guidance (spec section 17).
 * Read-only by design: EngLoop never rewrites AGENTS.md or .ai/* on its own.
 */
export const collectRepositoryContext = async (
  options: CollectContextOptions,
): Promise<CollectedContext> => {
  const result: CollectedContext = { files: {}, truncated: [], missing: [] };

  await Promise.all(
    options.files.map(async (relativePath) => {
      const absolute = join(options.rootPath, relativePath);
      try {
        const info = await stat(absolute);
        if (!info.isFile()) {
          result.missing.push(relativePath);
          return;
        }
        const raw = await readFile(absolute, 'utf8');
        if (raw.length > options.maxBytesPerFile) {
          result.files[relativePath] =
            `${raw.slice(0, options.maxBytesPerFile)}\n\n[... truncated]`;
          result.truncated.push(relativePath);
        } else {
          result.files[relativePath] = raw;
        }
      } catch {
        result.missing.push(relativePath);
      }
    }),
  );

  return result;
};
