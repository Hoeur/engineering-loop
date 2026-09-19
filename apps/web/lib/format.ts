import { formatDistanceToNowStrict, format, parseISO } from 'date-fns';

export const toDate = (value: string | Date | null | undefined): Date | null => {
  if (!value) return null;
  const date = typeof value === 'string' ? parseISO(value) : value;
  return Number.isNaN(date.getTime()) ? null : date;
};

export const relativeTime = (value: string | Date | null | undefined): string => {
  const date = toDate(value);
  if (!date) return '—';
  return `${formatDistanceToNowStrict(date)} ago`;
};

export const absoluteTime = (value: string | Date | null | undefined): string => {
  const date = toDate(value);
  return date ? format(date, 'd MMM yyyy, HH:mm') : '—';
};

export const shortDate = (value: string | Date | null | undefined): string => {
  const date = toDate(value);
  return date ? format(date, 'd MMM') : '—';
};

export const formatDuration = (ms: number | null | undefined): string => {
  if (ms === null || ms === undefined || ms <= 0) return '—';
  if (ms < 1_000) return `${String(Math.round(ms))}ms`;
  const seconds = ms / 1_000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes < 60) return `${String(minutes)}m ${String(rest)}s`;
  const hours = Math.floor(minutes / 60);
  return `${String(hours)}h ${String(minutes % 60)}m`;
};

export const formatCost = (value: string | number | null | undefined): string => {
  const numeric = typeof value === 'string' ? Number.parseFloat(value) : (value ?? 0);
  if (!Number.isFinite(numeric)) return '$0.00';
  if (numeric > 0 && numeric < 0.01) return `$${numeric.toFixed(4)}`;
  return `$${numeric.toFixed(2)}`;
};

export const formatTokens = (value: number | null | undefined): string => {
  const numeric = value ?? 0;
  if (numeric >= 1_000_000) return `${(numeric / 1_000_000).toFixed(1)}M`;
  if (numeric >= 1_000) return `${(numeric / 1_000).toFixed(1)}k`;
  return String(numeric);
};

export const formatNumber = (value: number | null | undefined): string =>
  new Intl.NumberFormat('en-US').format(value ?? 0);

export const formatPercent = (value: number | null | undefined): string =>
  `${String(Math.round(value ?? 0))}%`;

export const titleCase = (value: string): string =>
  value
    .toLowerCase()
    .split(/[_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

export const initials = (value: string): string =>
  value
    .split(/[\s-_]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
