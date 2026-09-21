import type { AgentTaskContext } from '@engloop/schemas';

/**
 * Prompt-injection scanning for untrusted text that reaches an agent.
 *
 * Task descriptions are written by users; AGENTS.md / CLAUDE.md / .ai/* are
 * fetched from the repository under test. Neither is trusted. The scanner
 * flags instructions aimed at the agent rather than at the code — it never
 * rewrites or strips text, because a silent edit would hide the attempt from
 * the audit trail and could itself be gamed.
 *
 * Confidence is deliberately coarse. HIGH means the text is unambiguously
 * addressing the model (override its instructions, exfiltrate secrets, drop
 * the safety policy) and the caller should refuse to spawn the provider.
 * MEDIUM and LOW are recorded for a human to read and never block on their own.
 */

export type InjectionConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface InjectionPattern {
  /** Stable identifier, safe to store and to assert on in tests. */
  id: string;
  confidence: InjectionConfidence;
  pattern: RegExp;
  description: string;
}

export interface InjectionFinding {
  patternId: string;
  confidence: InjectionConfidence;
  description: string;
  /** Where the text came from, e.g. `input.requirement` or `guidance.AGENTS.md`. */
  source: string;
  /** Short window around the match, trimmed so audit rows stay small. */
  excerpt: string;
}

export interface InjectionScanResult {
  findings: InjectionFinding[];
  /** Highest confidence across all findings, `null` when clean. */
  highestConfidence: InjectionConfidence | null;
  /** True when at least one finding is HIGH — the caller must not proceed. */
  blocking: boolean;
}

/** Thrown by callers that refuse to spawn a provider on a blocking scan. */
export class InjectionBlockedError extends Error {
  readonly code = 'AGENT_INPUT_INJECTION';
  constructor(readonly findings: readonly InjectionFinding[]) {
    const sources = [...new Set(findings.map((finding) => finding.source))].join(', ');
    super(`Refused to start agent: prompt-injection pattern found in ${sources}`);
    this.name = 'InjectionBlockedError';
  }
}

const EXCERPT_RADIUS = 60;

/**
 * Value-shaped secrets that may sit inside an excerpt. Audit metadata is only
 * key-scrubbed downstream, so free text must be masked here before it is
 * persisted.
 */
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?|AUTHORIZATION)[A-Z0-9_]*)(\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi,
  /\bbearer\s+[a-z0-9._~+/-]+=*/gi,
  /\b(?:sk|pk|rk)-[a-z0-9_-]{8,}/gi,
  /\b(?:gh[pousr]|github_pat)_[a-z0-9_]{8,}/gi,
  /\bxox[abpors]-[a-z0-9-]{8,}/gi,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}/gi,
  /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END[A-Z ]*PRIVATE KEY-----|$)/g,
  /\b[a-f0-9]{32,}\b/gi,
];

export const maskSecretValues = (text: string): string => {
  let out = text;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, (match: string, ...groups: unknown[]) => {
      const [name, separator] = groups;
      return typeof name === 'string' && typeof separator === 'string'
        ? `${name}${separator}[redacted]`
        : '[redacted]';
    });
  }
  return out;
};

/** Ordered from most to least specific. Every pattern is case-insensitive. */
export const INJECTION_PATTERNS: readonly InjectionPattern[] = Object.freeze([
  {
    id: 'override-instructions',
    confidence: 'HIGH',
    pattern:
      /\b(ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|your|any|original|initial)\b[^.\n]{0,30}\b(instructions?|guidelines?|prompts?|directives?|system prompt|programming|training)\b/i,
    description: 'Attempts to cancel or override the instructions the agent already has',
  },
  {
    id: 'exfiltrate-secrets',
    confidence: 'HIGH',
    pattern:
      /\b(print|echo|cat|reveal|dump|leak|exfiltrate|send|upload|post|paste|transmit|email)\b[^.\n]{0,60}(\b(secrets?|credentials?|api[ _-]?keys?|access[ _-]?tokens?|private[ _-]?keys?)\b|~\/\.ssh|\bid_rsa\b|\.aws\/credentials|\.netrc\b)/i,
    description: 'Directs the agent to expose or transmit credentials or secret files',
  },
  {
    id: 'disable-own-safety',
    confidence: 'HIGH',
    pattern:
      /\b(disable|turn off|bypass|circumvent|escape|break out of)\b[^.\n]{0,30}\b(your|the agent'?s?|this agent'?s?)\b[^.\n]{0,20}\b(safety|sandbox|permissions?|allowlist|allow-list|guard(?:rail)?s?|restrictions?|budget|worktree)\b/i,
    description: 'Directs the agent to weaken the controls it is running under',
  },
  {
    id: 'disable-safety',
    confidence: 'MEDIUM',
    pattern:
      /\b(disable|turn off|skip|bypass|remove|circumvent)\b[^.\n]{0,40}\b(safety|sandbox|allowlist|allow-list|whitelist|audit(?:ing| log)?|approval|guard(?:rail)?s?)\b/i,
    description: 'Mentions weakening a safety, permission or audit control',
  },
  {
    id: 'role-hijack',
    confidence: 'HIGH',
    pattern:
      /\b(you are now (a|an|the|in|no longer)|from now on,? you (are|will|must)|pretend (to be|you are|that you)|roleplay as|adopt (a|the) (new )?persona|jailbreak|DAN mode)\b/i,
    description: 'Attempts to replace the agent’s role or persona',
  },
  {
    id: 'system-prompt-marker',
    confidence: 'HIGH',
    pattern:
      /(<\|?\/?\s*(system|im_start|im_end)\s*\|?>|\[\s*\/?(system|inst)\s*\]|<<\s*sys\s*>>|^\s*###?\s*system\s*(prompt|message)?\s*$)/im,
    description: 'Contains chat-template or system-prompt delimiters that a model may honour',
  },
  {
    id: 'address-model',
    confidence: 'MEDIUM',
    pattern:
      /\b(ai|assistant|language model|llm|model|agent|copilot|codex|claude|gpt|chatgpt|gemini)\b[^.\n]{0,20}\b(you must|you should|you will|you have to|must now|should now|do not tell|don't tell|never mention)\b/i,
    description: 'Text addresses the model directly with an imperative',
  },
  {
    id: 'hidden-directive',
    confidence: 'MEDIUM',
    pattern:
      /\b(do not (tell|inform|mention|reveal|show)|don't (tell|inform|mention|reveal|show)|without (telling|informing|alerting|notifying)|keep (this|it) (secret|hidden)|hide (this|it) from)\b[^.\n]{0,40}\b(user|human|reviewer|operator|maintainer|team|anyone|owner)s?\b/i,
    description: 'Asks the agent to conceal an action from the human in the loop',
  },
  {
    id: 'unsafe-command',
    confidence: 'MEDIUM',
    pattern:
      /(\bcurl\b[^\n|]{0,80}\|\s*(ba|z)?sh\b|\bwget\b[^\n|]{0,80}\|\s*(ba|z)?sh\b|\brm\s+-rf\s+[/~]|\bchmod\s+(-R\s+)?[0-7]*777\b|\bgit\s+push\s+(-f|--force)\b)/i,
    description:
      'Contains a command that installs from the network, destroys data or rewrites history',
  },
  {
    id: 'urgency-authority',
    confidence: 'LOW',
    pattern:
      /\b(this (is|message is) (an? )?(urgent|official|authori[sz]ed)( (urgent|official|authori[sz]ed))? (instruction|directive|message|override)|by order of|the (administrator|admin|operator|developer|owner) (has )?(authori[sz]ed|approved|instructed)|you have permission to)\b/i,
    description: 'Claims authority or urgency to justify an out-of-band instruction',
  },
  {
    id: 'invisible-characters',
    confidence: 'LOW',
    pattern: /\u200b|\u200c|\u200d|\u2060|[\u2062-\u2064]|\ufeff|[\u202a-\u202e]|[\u2066-\u2069]/,
    description: 'Contains zero-width or bidirectional control characters that can hide text',
  },
]);

const RANK: Record<InjectionConfidence, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

const excerptAround = (text: string, index: number, length: number): string => {
  const start = Math.max(0, index - EXCERPT_RADIUS);
  const end = Math.min(text.length, index + length + EXCERPT_RADIUS);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${maskSecretValues(text.slice(start, end).replace(/\s+/g, ' ').trim())}${suffix}`;
};

/** Scans one piece of text. Each pattern reports at most one finding. */
export const scanText = (text: string, source: string): InjectionFinding[] => {
  if (!text) return [];
  const findings: InjectionFinding[] = [];
  for (const candidate of INJECTION_PATTERNS) {
    const match = candidate.pattern.exec(text);
    if (!match) continue;
    findings.push({
      patternId: candidate.id,
      confidence: candidate.confidence,
      description: candidate.description,
      source,
      excerpt: excerptAround(text, match.index, match[0].length),
    });
  }
  return findings;
};

const collectStrings = (value: unknown, path: string, out: Array<[string, string]>): void => {
  if (typeof value === 'string') {
    out.push([path, value]);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => collectStrings(item, `${path}[${index}]`, out));
  } else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      collectStrings(nested, `${path}.${key}`, out);
    }
  }
};

export const summarize = (findings: readonly InjectionFinding[]): InjectionScanResult => {
  let highest: InjectionConfidence | null = null;
  for (const finding of findings) {
    if (!highest || RANK[finding.confidence] > RANK[highest]) highest = finding.confidence;
  }
  return { findings: [...findings], highestConfidence: highest, blocking: highest === 'HIGH' };
};

/**
 * Scans every untrusted surface of an agent context: the role input (task
 * description, requirement, constraints, review findings…) and the guidance
 * files fetched from the repository. Project memory and budget are written by
 * operators through the API and are not scanned.
 */
export const scanAgentContext = (
  context: Pick<AgentTaskContext, 'input'> & Partial<Pick<AgentTaskContext, 'guidance'>>,
): InjectionScanResult => {
  const sources: Array<[string, string]> = [];
  collectStrings(context.input, 'input', sources);
  for (const [file, content] of Object.entries(context.guidance?.files ?? {})) {
    sources.push([`guidance.${file}`, content]);
  }
  return summarize(sources.flatMap(([source, text]) => scanText(text, source)));
};
