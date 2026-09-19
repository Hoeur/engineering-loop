import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DataTable, type Column } from '../common/data-table';

interface Row {
  id: string;
  name: string;
  status: string;
}

const rows: Row[] = [
  { id: '1', name: 'ENG-101', status: 'Reviewing' },
  { id: '2', name: 'ENG-102', status: 'Completed' },
];

const columns: Column<Row>[] = [
  { id: 'name', header: 'Task', primary: true, cell: (row) => row.name },
  { id: 'status', header: 'Status', cell: (row) => row.status },
];

describe('DataTable', () => {
  it('renders a real table for wide screens', () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(row) => row.id} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getAllByText('ENG-101').length).toBeGreaterThan(0);
  });

  it('also renders a stacked card list for small screens', () => {
    const { container } = render(
      <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} />,
    );
    // The card layout is a sibling of the table wrapper, hidden from md up.
    const cardLayout = container.querySelector('.md\\:hidden');
    expect(cardLayout).not.toBeNull();
    expect(cardLayout?.querySelectorAll('button')).toHaveLength(2);
  });

  it('keeps horizontal scrolling inside the table wrapper', () => {
    const { container } = render(
      <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} />,
    );
    expect(container.querySelector('.overflow-x-auto')).not.toBeNull();
  });
});
