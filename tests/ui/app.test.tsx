// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { seededStore } from '../../fixtures/datasets';
import { App } from '../../static/rollup-ui/src/App';
import { createPlaygroundTransport, type PlaygroundOptions } from '../../static/rollup-ui/src/playground/playgroundTransport';
import type { Transport } from '../../static/rollup-ui/src/transport';
import { createMemoryStore } from '../../src/storage/store';

const NOW = new Date('2026-10-16T12:00:00Z');

function mount(options: Partial<PlaygroundOptions> = {}, store = createMemoryStore(seededStore())) {
  const transport = createPlaygroundTransport({ dataset: 'classic', module: 'issuePanel', license: 'ACTIVE', admin: true, today: NOW, ...options }, store);
  render(<App transport={transport} />);
  return { transport, store };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('issue panel', () => {
  it('shows the classic epic rollup KPIs', async () => {
    mount();
    expect(await screen.findByText('Checkout v2 (PCI re-platform)')).toBeTruthy();
    expect(screen.getByText('21.6%')).toBeTruthy(); // progress by story points
    expect(screen.getByText('8 / 37')).toBeTruthy();
    expect(screen.getByText('91h')).toBeTruthy();
    expect(screen.getByText('66.9%')).toBeTruthy(); // budget burn
    expect(screen.getAllByText(/Medium risk/).length).toBeGreaterThan(0);
    expect(screen.getByRole('img', { name: 'To Do 34%, In Progress 33%, Done 33%' })).toBeTruthy();
    expect(screen.queryByText(/Sandbox|Trial/)).toBeNull();
  });

  it('switches the distribution to story points', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Story points' }));
    expect(screen.getByRole('img', { name: 'To Do 13%, In Progress 65%, Done 22%' })).toBeTruthy();
  });

  it('shows the hierarchy table with signals and filters', async () => {
    mount();
    fireEvent.click(await screen.findByRole('tab', { name: 'Issues (9)' }));
    const table = screen.getByRole('table');
    expect(within(table).getByText('Fraud rules engine hook')).toBeTruthy();
    expect(within(table).getByText('6d overdue')).toBeTruthy();
    expect(within(table).getAllByText('Blocked').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Needs attention' }));
    expect(within(table).queryByText('Apple Pay / Google Pay wallets')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse CLS-1' }));
    expect(within(table).queryByText('Fraud rules engine hook')).toBeNull();
  });

  it('exports CSV as a browser download', async () => {
    const created: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => {
      created.push(b);
      return 'blob:mock';
    });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('CLS-1_rollup_2026-10-16.csv');
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    const text = await created[0]!.text();
    expect(text).toContain('Depth,Key,Parent,Summary');
    expect(text).toContain('CLS-10');
  });

  it('lets an admin see per-person cost and set a budget', async () => {
    const { store } = mount();
    fireEvent.click(await screen.findByRole('tab', { name: 'Cost & budget' }));
    expect(screen.getByText('Cost by person')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Budget for CLS-1 (USD)'), { target: { value: '32000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save budget' }));
    await waitFor(async () => expect(await store.get('budget:CLS-1')).toMatchObject({ amount: 32000 }));
  });

  it('hides the per-person breakdown and budget editor from non-admins (team-managed)', async () => {
    mount({ dataset: 'nextgen', admin: false, license: 'TRIAL' });
    expect(await screen.findByText('Offline mode')).toBeTruthy();
    expect(screen.getByText(/Free trial/)).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Cost & budget' }));
    expect(screen.queryByText('Cost by person')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save budget' })).toBeNull();
  });

  it('blocks the app with an inactive license', async () => {
    mount({ license: 'INACTIVE' });
    expect(await screen.findByText('License required')).toBeTruthy();
    expect(screen.queryByText('Checkout v2 (PCI re-platform)')).toBeNull();
  });

  it('shows the sandbox banner in development installs', async () => {
    mount({ license: 'SANDBOX' });
    expect(await screen.findByText('Sandbox')).toBeTruthy();
  });

  it('renders resolver errors instead of crashing', async () => {
    const transport: Transport = {
      getContext: async () => ({ moduleType: 'issuePanel', issueKey: 'CLS-1', projectKey: 'CLS', timezone: null }),
      invoke: (async (key: string) =>
        key === 'getAppState'
          ? { ok: true, data: { license: { state: 'ACTIVE', allowed: true, isEvaluation: false, trialEndDate: null, message: '' }, projectKey: 'CLS', issueKey: 'CLS-1', canConfigure: false, settings: null } }
          : { ok: false, error: { code: 'NOT_FOUND', message: 'Issue or project not found' } }) as Transport['invoke'],
    };
    render(<App transport={transport} />);
    expect(await screen.findByText('Could not roll up CLS-1')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Issue or project not found');
  });
});

describe('project page', () => {
  it('lists epics, opens one and saves settings', async () => {
    const { store } = mount({ module: 'projectPage' });
    expect(await screen.findByText('Loyalty points')).toBeTruthy();
    // The newest open epic is selected automatically.
    expect(screen.getByRole('button', { name: /Loyalty points/ }).getAttribute('aria-current')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /Checkout v2/ }));
    expect(await screen.findByText('8 / 37')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Filter epics'), { target: { value: 'legacy' } });
    expect(screen.queryByRole('button', { name: /Loyalty points/ })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    fireEvent.change(screen.getByLabelText('Default hourly rate'), { target: { value: '125' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(async () => expect(await store.get('settings:project:CLS')).toMatchObject({ defaultHourlyRate: 125 }));
  });

  it('shows validation errors from the resolver', async () => {
    mount({ module: 'projectPage' });
    fireEvent.click(await screen.findByRole('tab', { name: 'Settings' }));
    fireEvent.change(screen.getByLabelText('Currency (ISO 4217)'), { target: { value: 'XX' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/3-letter ISO 4217/);
  });

  it('has no settings tab for non-admins', async () => {
    mount({ module: 'projectPage', admin: false });
    expect(await screen.findByText('Loyalty points')).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Settings' })).toBeNull();
  });
});
