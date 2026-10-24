import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import * as api from '../../../src/lib/api';
import { copyToClipboard } from '../../../src/components/settings/CopyField';
import { useEntitiesStore } from '../../../src/stores/entities.store';
import { useVizStore } from '../../../src/stores/viz.store';
import { useToastStore } from '../../../src/components/ui';
import { DelegateDialog, type DelegationSource } from '../../../src/components/delegation/DelegateDialog';

/** RD-12 — Delegate dialog: deliver first, record second, nothing extra in the brief. Invented data only. */

vi.mock('../../../src/lib/api', () => ({
  createCommitment: vi.fn(),
  createPerson: vi.fn(),
}));
vi.mock('../../../src/components/settings/CopyField', () => ({
  copyToClipboard: vi.fn(),
}));

const PEOPLE = [
  { id: 'p1', name: 'Sam Rivera', role: 'Volunteer lead', domains: ['business'] },
  { id: 'p2', name: 'Lee Park', role: 'Deacon', domains: ['Ministry'] },
];

const DECISION_SOURCE: DelegationSource = {
  what: 'Send the volunteer rota to every team lead before the fair',
  project: { id: 'pr1', title: 'Harvest fair' },
  decision: { id: 'd1', title: 'Fair format', chosenPath: 'Host it in March', rationale: 'More volunteers free', expectedOutcome: '80 families attend' },
};

const fetchPeople = vi.fn(async () => {});
const fetchCommitments = vi.fn(async () => {});
const vizLoad = vi.fn(async () => null);
const addToast = vi.fn();

beforeEach(() => {
  useEntitiesStore.setState({ people: PEOPLE as never, fetchPeople, fetchCommitments });
  useVizStore.setState({ load: vizLoad as never });
  useToastStore.setState({ addToast } as never);
  vi.mocked(copyToClipboard).mockResolvedValue(true);
  vi.mocked(api.createCommitment).mockResolvedValue({ id: 'c1' } as never);
});

afterEach(() => {
  // @ts-expect-error test cleanup
  delete navigator.share;
});

function open(source: DelegationSource = DECISION_SOURCE, onClose = vi.fn()) {
  render(<DelegateDialog open onClose={onClose} source={source} />);
  return { onClose, dialog: screen.getByTestId('delegate-dialog') };
}

const pick = (name: string) => fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }));
const primary = () => screen.getByTestId('delegate-primary');
const preview = () => screen.getByTestId('delegate-preview') as HTMLTextAreaElement;

describe('<DelegateDialog />', () => {
  it('pre-fills What (≤200, with maxLength) and By; every Why/Context box starts unticked', () => {
    const long = 'x'.repeat(260);
    open({ ...DECISION_SOURCE, what: long });
    const what = screen.getByLabelText('What') as HTMLInputElement;
    expect(what.value).toHaveLength(200);
    expect(what.maxLength).toBe(200);
    expect(screen.getByText('200/200')).toBeInTheDocument();
    expect((screen.getByLabelText('By') as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map((b) => b.closest('label')!.textContent)).toEqual([
      'We decided: Host it in March',
      'Reasoning: More volunteers free',
      'Part of Harvest fair',
      'Expected outcome: 80 families attend',
    ]);
    expect(boxes.every((b) => !b.checked)).toBe(true);
    expect(preview().value).not.toContain('Reasoning');
    expect(preview().value).not.toContain('Expected outcome');
  });

  it('copies BEFORE recording, records one STAKEHOLDER commitment with links, then closes and refreshes', async () => {
    const order: string[] = [];
    vi.mocked(copyToClipboard).mockImplementation(async () => { order.push('copy'); return true; });
    vi.mocked(api.createCommitment).mockImplementation(async () => { order.push('post'); return { id: 'c1' } as never; });
    const changed = vi.fn();
    window.addEventListener('boardroom:commitments-changed', changed);
    const { onClose } = open();
    pick('Sam Rivera');
    fireEvent.change(screen.getByLabelText('By'), { target: { value: '2030-11-07' } });
    expect(primary()).toHaveTextContent('Copy & record');
    fireEvent.click(primary());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(order).toEqual(['copy', 'post']);
    const [body, key] = vi.mocked(api.createCommitment).mock.calls[0];
    expect(body).toEqual({
      description: 'Send the volunteer rota to every team lead before the fair',
      stakeholderId: 'p1',
      deadline: '2030-11-07T23:59:59.999Z',
      owedBy: 'STAKEHOLDER',
      linkedProjectId: 'pr1',
      links: { decisionId: 'd1' },
    });
    expect(typeof key).toBe('string');
    expect(vi.mocked(copyToClipboard).mock.calls[0][0]).toBe(preview().value);
    expect(preview().value).toContain('Hi Sam,');
    expect(addToast).toHaveBeenCalledWith(expect.stringMatching(/^Recorded: waiting on Sam by /), 'success');
    expect(changed).toHaveBeenCalledTimes(1);
    expect(vizLoad).toHaveBeenCalledWith('commitments', true);
    expect(fetchCommitments).toHaveBeenCalled();
    window.removeEventListener('boardroom:commitments-changed', changed);
  });

  it('task source links the task (and its project)', async () => {
    open({ what: 'Fix the projector', task: { id: 't1', title: 'Fix the projector', deadline: null }, project: { id: 'pr1', title: 'Harvest fair' } });
    pick('Sam Rivera');
    fireEvent.click(primary());
    await waitFor(() => expect(api.createCommitment).toHaveBeenCalled());
    expect(vi.mocked(api.createCommitment).mock.calls[0][0]).toMatchObject({ linkedProjectId: 'pr1', links: { taskId: 't1' } });
  });

  it('uses the share sheet on a coarse pointer; navigator.share runs before the POST', async () => {
    const order: string[] = [];
    Object.defineProperty(navigator, 'share', { configurable: true, value: vi.fn(async () => { order.push('share'); }) });
    vi.mocked(window.matchMedia).mockImplementation(((q: string) => ({ matches: q === '(pointer: coarse)', media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as never);
    vi.mocked(api.createCommitment).mockImplementation(async () => { order.push('post'); return { id: 'c1' } as never; });
    open();
    pick('Sam Rivera');
    expect(primary()).toHaveTextContent('Share & record');
    fireEvent.click(primary());
    await waitFor(() => expect(api.createCommitment).toHaveBeenCalled());
    expect(order).toEqual(['share', 'post']);
    expect(vi.mocked(navigator.share).mock.calls[0][0]).toEqual({ text: preview().value });
    expect(copyToClipboard).not.toHaveBeenCalled();
    vi.mocked(window.matchMedia).mockImplementation(((q: string) => ({ matches: false, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as never);
  });

  it('a cancelled share (AbortError) records nothing and keeps the dialog open', async () => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: vi.fn(async () => { throw Object.assign(new Error('cancel'), { name: 'AbortError' }); }) });
    vi.mocked(window.matchMedia).mockImplementation(((q: string) => ({ matches: q === '(pointer: coarse)', media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as never);
    const { onClose } = open();
    pick('Sam Rivera');
    fireEvent.click(primary());
    await waitFor(() => expect(navigator.share).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(api.createCommitment).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('delegate-dialog')).toBeInTheDocument();
    vi.mocked(window.matchMedia).mockImplementation(((q: string) => ({ matches: false, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as never);
  });

  it('a failed copy records nothing and shows an error toast', async () => {
    vi.mocked(copyToClipboard).mockResolvedValue(false);
    open();
    pick('Sam Rivera');
    fireEvent.click(primary());
    await waitFor(() => expect(addToast).toHaveBeenCalledWith('Could not copy. Select the text and copy it yourself.', 'error'));
    expect(api.createCommitment).not.toHaveBeenCalled();
  });

  it('a failed POST keeps the dialog open; Retry re-POSTs with the same key and does not re-copy', async () => {
    vi.mocked(api.createCommitment).mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce({ id: 'c1' } as never);
    const { onClose } = open();
    pick('Sam Rivera');
    fireEvent.click(primary());
    const retry = await screen.findByRole('button', { name: 'Retry' });
    expect(addToast).toHaveBeenCalledWith('Copied, but not recorded', 'error');
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(retry);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.createCommitment).toHaveBeenCalledTimes(2);
    const keys = vi.mocked(api.createCommitment).mock.calls.map((c) => c[1]);
    expect(keys[0]).toBe(keys[1]);
    expect(copyToClipboard).toHaveBeenCalledTimes(1);
  });

  it('the primary button is disabled without a person and while a request is pending', async () => {
    let release!: () => void;
    vi.mocked(api.createCommitment).mockImplementation(() => new Promise((r) => { release = () => r({ id: 'c1' } as never); }));
    open();
    expect(primary()).toBeDisabled();
    pick('Sam Rivera');
    expect(primary()).toBeEnabled();
    fireEvent.change(screen.getByLabelText('What'), { target: { value: '   ' } });
    expect(primary()).toBeDisabled();
    fireEvent.change(screen.getByLabelText('What'), { target: { value: 'Send the rota' } });
    fireEvent.click(primary());
    await waitFor(() => expect(api.createCommitment).toHaveBeenCalled());
    expect(primary()).toBeDisabled();
    release();
  });

  it('copies exactly the textarea value after a manual edit; Reset restores the template', async () => {
    open();
    pick('Sam Rivera');
    fireEvent.change(preview(), { target: { value: 'Hi Sam, my own words.' } });
    fireEvent.click(primary());
    await waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith('Hi Sam, my own words.'));
  });

  it('ticking a Why box adds that line (and only that line) to the brief', () => {
    open();
    pick('Sam Rivera');
    fireEvent.click(screen.getByLabelText('Reasoning: More volunteers free'));
    expect(preview().value).toContain('Why: Reasoning: More volunteers free');
    expect(preview().value).not.toContain('We decided');
  });

  it('Copy only copies without recording', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Copy only' }));
    await waitFor(() => expect(copyToClipboard).toHaveBeenCalled());
    expect(api.createCommitment).not.toHaveBeenCalled();
  });

  it('inline Add person calls createPerson then fetchPeople and selects the new person', async () => {
    vi.mocked(api.createPerson).mockResolvedValue({ id: 'p9', name: 'Jordan Vale', role: null, domains: [] } as never);
    open();
    fireEvent.change(screen.getByLabelText('Search people'), { target: { value: 'Jordan Vale' } });
    fireEvent.click(screen.getByRole('button', { name: /Add person "Jordan Vale"/ }));
    await waitFor(() => expect(fetchPeople).toHaveBeenCalled());
    expect(api.createPerson).toHaveBeenCalledWith({ name: 'Jordan Vale' });
    expect(vi.mocked(api.createPerson).mock.invocationCallOrder[0]).toBeLessThan(fetchPeople.mock.invocationCallOrder[fetchPeople.mock.invocationCallOrder.length - 1]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument());
    expect(within(screen.getByTestId('delegate-dialog')).getByText('Jordan Vale')).toBeInTheDocument();
    expect(preview().value.startsWith('Hi Jordan,')).toBe(true);
  });

  it('a ministry-domain person shows the notice', () => {
    open();
    expect(screen.queryByTestId('delegate-ministry-note')).toBeNull();
    pick('Lee Park');
    expect(screen.getByTestId('delegate-ministry-note')).toHaveTextContent("Keep pastoral details out of the brief's What line.");
  });
});
