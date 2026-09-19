import { FALLBACK_TOKEN_PRICING } from '@engloop/config';
import type { TokenUsage } from '@engloop/types';

export interface TokenPricing {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  cachedPerMillionUsd: number;
}

/** Indicative catalogue. Real deployments override this per AgentProvider row. */
export const MODEL_PRICING: Readonly<Record<string, TokenPricing>> = Object.freeze({
  'gpt-5-codex': { inputPerMillionUsd: 1.25, outputPerMillionUsd: 10, cachedPerMillionUsd: 0.125 },
  'claude-opus-5': { inputPerMillionUsd: 5, outputPerMillionUsd: 25, cachedPerMillionUsd: 0.5 },
  'claude-sonnet-4-5': { inputPerMillionUsd: 3, outputPerMillionUsd: 15, cachedPerMillionUsd: 0.3 },
  'gemini-2.5-pro': {
    inputPerMillionUsd: 1.25,
    outputPerMillionUsd: 10,
    cachedPerMillionUsd: 0.31,
  },
  mock: { inputPerMillionUsd: 0, outputPerMillionUsd: 0, cachedPerMillionUsd: 0 },
});

export const pricingFor = (model: string | null | undefined): TokenPricing =>
  (model ? MODEL_PRICING[model] : undefined) ?? { ...FALLBACK_TOKEN_PRICING };

export const estimateCostUsd = (usage: TokenUsage, model?: string | null): number => {
  const pricing = pricingFor(model);
  const cost =
    (usage.inputTokens / 1_000_000) * pricing.inputPerMillionUsd +
    (usage.outputTokens / 1_000_000) * pricing.outputPerMillionUsd +
    (usage.cachedTokens / 1_000_000) * pricing.cachedPerMillionUsd;
  return Math.round(cost * 1_000_000) / 1_000_000;
};

export const sumUsage = (entries: readonly TokenUsage[]): TokenUsage =>
  entries.reduce<TokenUsage>(
    (acc, entry) => ({
      inputTokens: acc.inputTokens + entry.inputTokens,
      outputTokens: acc.outputTokens + entry.outputTokens,
      cachedTokens: acc.cachedTokens + entry.cachedTokens,
      totalTokens: acc.totalTokens + entry.totalTokens,
    }),
    { inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalTokens: 0 },
  );
