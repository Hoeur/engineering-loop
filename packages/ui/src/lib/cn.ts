import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge Tailwind classes with correct conflict resolution. */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
