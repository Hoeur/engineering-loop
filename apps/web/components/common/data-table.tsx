'use client';

import type * as React from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, cn } from '@engloop/ui';

export interface Column<T> {
  id: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  className?: string;
  /** Hidden on the mobile card layout. */
  hideOnCard?: boolean;
  /** Rendered as the card title on small screens. */
  primary?: boolean;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  className?: string;
}

/**
 * Responsive table (spec section 36): a real table from md up, stacked cards
 * below it, so no screen ever scrolls sideways on a phone.
 */
export const DataTable = <T,>({
  columns,
  rows,
  rowKey,
  onRowClick,
  className,
}: DataTableProps<T>): React.JSX.Element => (
  <>
    <div className={cn('hidden rounded-lg border border-border bg-card md:block', className)}>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((column) => (
              <TableHead key={column.id} className={column.className}>
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={onRowClick ? 'cursor-pointer' : undefined}
            >
              {columns.map((column) => (
                <TableCell key={column.id} className={column.className}>
                  {column.cell(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>

    <div className={cn('grid gap-2 md:hidden', className)}>
      {rows.map((row) => {
        const primary = columns.find((column) => column.primary) ?? columns[0];
        const rest = columns.filter((column) => column !== primary && !column.hideOnCard);
        return (
          <button
            key={rowKey(row)}
            type="button"
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={cn(
              'w-full rounded-lg border border-border bg-card p-3 text-left shadow-xs',
              onRowClick ? 'active:bg-muted' : 'cursor-default',
            )}
          >
            <div className="mb-2 text-sm font-medium">{primary?.cell(row)}</div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              {rest.map((column) => (
                <div key={column.id} className="min-w-0">
                  <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {column.header}
                  </dt>
                  <dd className="truncate text-xs">{column.cell(row)}</dd>
                </div>
              ))}
            </dl>
          </button>
        );
      })}
    </div>
  </>
);
