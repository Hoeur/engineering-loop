import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DataTable } from './data-table';

describe('DataTable action cards', () => {
  it('does not nest action buttons inside a card button when no row action exists', () => {
    const { container } = render(
      <DataTable
        rows={[{ id: 'one' }]}
        rowKey={(row) => row.id}
        columns={[
          { id: 'action', header: 'Action', cell: () => <button type="button">Edit entry</button> },
        ]}
      />,
    );
    expect(screen.getAllByRole('button', { name: 'Edit entry' })).toHaveLength(2);
    expect(container.querySelector('button button')).toBeNull();
  });
  it('keeps mobile cards keyboard accessible when they have a row action', () => {
    const click = vi.fn();
    render(
      <DataTable
        rows={[{ id: 'one' }]}
        rowKey={(row) => row.id}
        onRowClick={click}
        columns={[{ id: 'name', header: 'Name', cell: () => 'Entry one' }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Entry one' }));
    expect(click).toHaveBeenCalledWith({ id: 'one' });
  });
});
