'use client';

import type * as React from 'react';
import { Search, X } from 'lucide-react';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from '@engloop/ui';

export interface FilterOption {
  label: string;
  value: string;
}

export interface FilterDefinition {
  id: string;
  label: string;
  value: string | undefined;
  options: FilterOption[];
  onChange: (value: string | undefined) => void;
}

export interface FilterBarProps {
  search?: { value: string; onChange: (value: string) => void; placeholder?: string };
  filters?: FilterDefinition[];
  actions?: React.ReactNode;
  onReset?: () => void;
  className?: string;
}

export const FilterBar = ({
  search,
  filters = [],
  actions,
  onReset,
  className,
}: FilterBarProps): React.JSX.Element => {
  const hasActiveFilter = filters.some((filter) => filter.value) || Boolean(search?.value);

  return (
    <div
      className={cn(
        'flex flex-col gap-2 pb-4 lg:flex-row lg:items-center lg:justify-between',
        className,
      )}
    >
      <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {search ? (
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search.value}
              onChange={(event) => search.onChange(event.target.value)}
              placeholder={search.placeholder ?? 'Search…'}
              className="pl-8"
              aria-label={search.placeholder ?? 'Search'}
            />
          </div>
        ) : null}

        {filters.map((filter) => (
          <Select
            key={filter.id}
            value={filter.value ?? '__all__'}
            onValueChange={(value) => filter.onChange(value === '__all__' ? undefined : value)}
          >
            <SelectTrigger className="w-full sm:w-[170px]" aria-label={filter.label}>
              <SelectValue placeholder={filter.label} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All {filter.label.toLowerCase()}</SelectItem>
              {filter.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}

        {hasActiveFilter && onReset ? (
          <Button variant="ghost" size="sm" onClick={onReset}>
            <X className="h-3.5 w-3.5" />
            Clear
          </Button>
        ) : null}
      </div>

      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
};
