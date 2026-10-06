'use client';

import type * as React from 'react';

export const linesToItems = (value: string): string[] =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

export const PlanningText = ({
  label,
  value,
  onChange,
  disabled,
  maxLength = 10000,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  maxLength?: number;
}): React.JSX.Element => (
  <label className="block space-y-1 text-xs">
    {label}
    <textarea
      className="min-h-20 w-full min-w-0 resize-y rounded-md border border-input bg-background p-2"
      value={value}
      maxLength={maxLength}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  </label>
);

export const PlanningList = ({
  title,
  items,
}: {
  title: string;
  items: readonly string[];
}): React.JSX.Element => (
  <div className="space-y-1 text-xs">
    <h4 className="font-medium">{title}</h4>
    {items.length ? (
      <ul className="list-inside list-disc space-y-1">
        {items.map((item, index) => (
          <li className="break-words" key={`${index}-${item}`}>
            {item}
          </li>
        ))}
      </ul>
    ) : (
      <p className="text-muted-foreground">None specified.</p>
    )}
  </div>
);
