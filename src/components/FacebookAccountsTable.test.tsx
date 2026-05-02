import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { FacebookAccountsTable } from './FacebookAccountsTable';
import type { FacebookAdAccount } from '@/types/facebook';

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() })
}));

const accounts: FacebookAdAccount[] = [
  { id: 'act_1', name: 'Acme Cosmetics', accessToken: 't', isEnabled: true },
  { id: 'act_2', name: 'Bravo Apparel', accessToken: 't', isEnabled: false },
  { id: 'act_3', name: 'Caryona Bags', accessToken: 't', isEnabled: true },
  { id: 'act_4', name: 'Delta Decor', accessToken: 't', isEnabled: false }
];

const spend = { act_1: 500, act_2: 0, act_3: 250, act_4: 0 };

describe('FacebookAccountsTable', () => {
  let onToggle: ReturnType<typeof vi.fn>;
  let onSelect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onToggle = vi.fn();
    onSelect = vi.fn();
  });

  it('renders all accounts and stats with default filter', () => {
    render(
      <FacebookAccountsTable
        accounts={accounts}
        accountsSpend={spend}
        onAccountToggle={onToggle}
        onSelectAccount={onSelect}
      />
    );
    expect(screen.getByText('Acme Cosmetics')).toBeInTheDocument();
    expect(screen.getByText('Bravo Apparel')).toBeInTheDocument();
    expect(screen.getByText('Caryona Bags')).toBeInTheDocument();
    expect(screen.getByText('Delta Decor')).toBeInTheDocument();
    // Total Accounts stat should show 4
    expect(screen.getByText('Total Accounts')).toBeInTheDocument();
    // 4 in stat tile
    const statText = screen.getAllByText('4');
    expect(statText.length).toBeGreaterThan(0);
  });

  it('filters by enabled status', () => {
    render(
      <FacebookAccountsTable
        accounts={accounts}
        accountsSpend={spend}
        onAccountToggle={onToggle}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Enabled/i }));
    expect(screen.getByText('Acme Cosmetics')).toBeInTheDocument();
    expect(screen.getByText('Caryona Bags')).toBeInTheDocument();
    expect(screen.queryByText('Bravo Apparel')).not.toBeInTheDocument();
    expect(screen.queryByText('Delta Decor')).not.toBeInTheDocument();
  });

  it('filters by disabled status', () => {
    render(
      <FacebookAccountsTable
        accounts={accounts}
        accountsSpend={spend}
        onAccountToggle={onToggle}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Off/i }));
    expect(screen.queryByText('Acme Cosmetics')).not.toBeInTheDocument();
    expect(screen.getByText('Bravo Apparel')).toBeInTheDocument();
  });

  it('search filters by name and account ID', () => {
    render(
      <FacebookAccountsTable
        accounts={accounts}
        accountsSpend={spend}
        onAccountToggle={onToggle}
      />
    );
    const search = screen.getByPlaceholderText(/Search by name/i) as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'caryona' } });
    expect(screen.getByText('Caryona Bags')).toBeInTheDocument();
    expect(screen.queryByText('Acme Cosmetics')).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'act_2' } });
    expect(screen.getByText('Bravo Apparel')).toBeInTheDocument();
    expect(screen.queryByText('Caryona Bags')).not.toBeInTheDocument();
  });

  it('shows empty state when no accounts match filters', () => {
    render(
      <FacebookAccountsTable
        accounts={accounts}
        accountsSpend={spend}
        onAccountToggle={onToggle}
      />
    );
    const search = screen.getByPlaceholderText(/Search by name/i);
    fireEvent.change(search, { target: { value: 'nope-zzz-doesnotexist' } });
    expect(screen.getByText(/No ad accounts match/i)).toBeInTheDocument();
  });

  it('emits onAccountToggle for individual switches', () => {
    render(
      <FacebookAccountsTable
        accounts={accounts}
        accountsSpend={spend}
        onAccountToggle={onToggle}
      />
    );
    // First switch in the table — Acme is enabled, click should emit false
    const toggle = screen.getByRole('switch', { name: /Toggle Acme Cosmetics/ });
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith('act_1', false);
  });

  it('Disable all only fires for currently-enabled accounts', () => {
    render(
      <FacebookAccountsTable
        accounts={accounts}
        accountsSpend={spend}
        onAccountToggle={onToggle}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Disable all/i }));
    // 2 enabled accounts → 2 calls
    expect(onToggle).toHaveBeenCalledTimes(2);
    expect(onToggle).toHaveBeenCalledWith('act_1', false);
    expect(onToggle).toHaveBeenCalledWith('act_3', false);
  });

  it('Enable all only fires for currently-disabled accounts', () => {
    render(
      <FacebookAccountsTable
        accounts={accounts}
        accountsSpend={spend}
        onAccountToggle={onToggle}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Enable all/i }));
    expect(onToggle).toHaveBeenCalledTimes(2);
    expect(onToggle).toHaveBeenCalledWith('act_2', true);
    expect(onToggle).toHaveBeenCalledWith('act_4', true);
  });

  it('row click calls onSelectAccount', () => {
    render(
      <FacebookAccountsTable
        accounts={accounts}
        accountsSpend={spend}
        onAccountToggle={onToggle}
        onSelectAccount={onSelect}
      />
    );
    fireEvent.click(screen.getByText('Caryona Bags'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].id).toBe('act_3');
  });

  it('sorts enabled accounts before disabled, by spend desc within each group', () => {
    const { container } = render(
      <FacebookAccountsTable
        accounts={accounts}
        accountsSpend={spend}
        onAccountToggle={onToggle}
      />
    );
    // Read the rendered <tr> rows in order from the data table (skip the header)
    const rows = container.querySelectorAll('tbody tr');
    const names = Array.from(rows).map(r => within(r as HTMLElement).queryAllByText(/./)[0]?.textContent);
    // Expect Acme (500), Caryona (250), then disabled Bravo / Delta
    const collapsed = (Array.from(rows) as HTMLElement[]).map(r => r.textContent || '');
    expect(collapsed[0]).toMatch(/Acme/);
    expect(collapsed[1]).toMatch(/Caryona/);
    expect(collapsed[2]).toMatch(/Bravo|Delta/);
    expect(collapsed[3]).toMatch(/Bravo|Delta/);
    // names just helps debug if assertion fails
    void names;
  });
});
