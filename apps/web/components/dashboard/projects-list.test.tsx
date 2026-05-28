/**
 * @fileoverview Unit tests for the `ProjectsList` component.
 *
 * Verifies loading, empty, and populated states, the admin/non-admin delete
 * affordance, the success-toast wording, the `addSuffix: true` suffix on the
 * Created label, the mid-flight disabled trigger, the post-delete re-enable
 * (protects the `finally` block), the refresh-key reload, and both error
 * paths.
 *
 * @module components/dashboard/projects-list.test
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/auth-client', () => ({
  listProjects: vi.fn(),
  deleteProject: vi.fn(),
  handleAuthClientError: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ── Typed imports after mocks ─────────────────────────────────────────────────

import { listProjects, deleteProject, handleAuthClientError } from '@/lib/auth-client';
import type { ProjectInfo } from '@/lib/auth-client';
import { toast } from 'sonner';
import { ProjectsList } from './projects-list.js';

const ONE_DAY_MS = 86_400_000;
const TWO_DAYS_MS = 172_800_000;

const mockProjects: ProjectInfo[] = [
  {
    id: 'proj-1',
    name: 'Alpha Project',
    tenantId: 'tenant-1',
    ownerUserId: 'user-1',
    // Fixed past offsets so date-fns wording stays deterministic ("1 day ago").
    createdAt: new Date(Date.now() - ONE_DAY_MS).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'proj-2',
    name: 'Beta Project',
    tenantId: 'tenant-1',
    ownerUserId: 'user-1',
    createdAt: new Date(Date.now() - TWO_DAYS_MS).toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ProjectsList states', () => {
  it('shows loading text while fetching', () => {
    /*
     * Scenario: before listProjects resolves the component must show a loading
     * paragraph.
     * Protects: isLoading guard renders loading state.
     */
    vi.mocked(listProjects).mockReturnValue(new Promise(() => undefined));
    render(<ProjectsList isAdmin={false} refreshKey={0} />);
    expect(screen.getByText(/loading projects/i)).toBeDefined();
  });

  it('shows empty state when no projects are returned', async () => {
    /*
     * Scenario: when listProjects resolves with [] the empty state with
     * "No projects yet" must be shown.
     * Protects: empty array condition renders the empty-state UI.
     */
    vi.mocked(listProjects).mockResolvedValue([]);
    render(<ProjectsList isAdmin={false} refreshKey={0} />);
    await waitFor(() => {
      expect(screen.getByText(/no projects yet/i)).toBeDefined();
    });
  });

  it('renders project names when projects are returned', async () => {
    /*
     * Scenario: each project in the list must show its name.
     * Protects: project data is rendered inside the list.
     */
    vi.mocked(listProjects).mockResolvedValue(mockProjects);
    render(<ProjectsList isAdmin={false} refreshKey={0} />);
    await waitFor(() => {
      expect(screen.getByText('Alpha Project')).toBeDefined();
      expect(screen.getByText('Beta Project')).toBeDefined();
    });
  });

  it('renders the Created label with the date-fns "ago" suffix', async () => {
    /*
     * Scenario: each project's Created label must include the date-fns
     * "ago" suffix (1 day ago, 2 days ago) so the human-readable direction
     * of the timestamp is clear.
     * Protects: DATE_FORMAT_OPTIONS { addSuffix: true } passed to
     * formatDistanceToNow — kills the ObjectLiteral `{}` mutant and the
     * BooleanLiteral `false` mutant which would emit "1 day" / "2 days"
     * without the trailing " ago".
     */
    vi.mocked(listProjects).mockResolvedValue(mockProjects);
    render(<ProjectsList isAdmin={false} refreshKey={0} />);
    await waitFor(() => expect(screen.getByText('Alpha Project')).toBeDefined());
    // Each row must contain a "Created … ago" line.
    const created = screen.getAllByText(/^Created\s.+\sago$/i);
    expect(created).toHaveLength(2);
  });

  it('does not render delete buttons when isAdmin=false', async () => {
    /*
     * Scenario: non-admin users must not see delete controls for any project.
     * Protects: isAdmin=false hides delete buttons.
     */
    vi.mocked(listProjects).mockResolvedValue(mockProjects);
    render(<ProjectsList isAdmin={false} refreshKey={0} />);
    await waitFor(() => {
      expect(screen.getByText('Alpha Project')).toBeDefined();
    });
    expect(screen.queryAllByRole('button', { name: /delete project/i })).toHaveLength(0);
  });

  it('renders delete buttons when isAdmin=true', async () => {
    /*
     * Scenario: admin users must see a delete button for each project row.
     * Protects: isAdmin=true renders Trash2 delete buttons.
     */
    vi.mocked(listProjects).mockResolvedValue(mockProjects);
    render(<ProjectsList isAdmin refreshKey={0} />);
    await waitFor(() => {
      const deleteButtons = screen.getAllByRole('button', { name: /^Delete project /i });
      expect(deleteButtons).toHaveLength(2);
    });
  });
});

describe('ProjectsList error paths', () => {
  it('calls handleAuthClientError when listProjects rejects', async () => {
    /*
     * Scenario: when the initial load fails the error must be forwarded to
     * handleAuthClientError so the user sees a toast.
     * Protects: catch block in load() calls handleAuthClientError.
     */
    const err = new Error('Load failed');
    vi.mocked(listProjects).mockRejectedValue(err);
    render(<ProjectsList isAdmin={false} refreshKey={0} />);
    await waitFor(() => {
      expect(handleAuthClientError).toHaveBeenCalledWith(
        err,
        expect.objectContaining({ toast: expect.anything() }),
      );
    });
  });

  it('calls handleAuthClientError when deleteProject rejects', async () => {
    /*
     * Scenario: when deleteProject throws the error must be forwarded to
     * handleAuthClientError.
     * Protects: catch block in handleDelete calls handleAuthClientError.
     */
    const err = new Error('Delete failed');
    vi.mocked(listProjects).mockResolvedValue(mockProjects);
    vi.mocked(deleteProject).mockRejectedValue(err);

    render(<ProjectsList isAdmin refreshKey={0} />);
    await waitFor(() => expect(screen.getByText('Alpha Project')).toBeDefined());

    const [firstDeleteBtn] = screen.getAllByRole('button', { name: /^Delete project /i });
    fireEvent.click(firstDeleteBtn!);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^delete project$/i })).toBeDefined(),
    );
    fireEvent.click(screen.getByRole('button', { name: /^delete project$/i }));

    await waitFor(() => {
      expect(handleAuthClientError).toHaveBeenCalledWith(
        err,
        expect.objectContaining({ toast: expect.anything() }),
      );
    });
  });
});

describe('ProjectsList delete flow', () => {
  it('calls deleteProject and reloads list when delete is confirmed', async () => {
    /*
     * Scenario: opening the delete confirmation dialog and clicking "Delete project"
     * must call deleteProject with the project id and then reload the list.
     * Protects: handleDelete calls deleteProject and re-fetches via load().
     */
    vi.mocked(listProjects)
      .mockResolvedValueOnce(mockProjects)
      .mockResolvedValueOnce([mockProjects[1]!]);
    vi.mocked(deleteProject).mockResolvedValue(undefined);

    render(<ProjectsList isAdmin refreshKey={0} />);
    await waitFor(() => expect(screen.getByText('Alpha Project')).toBeDefined());

    const [firstDeleteBtn] = screen.getAllByRole('button', { name: /^Delete project /i });
    fireEvent.click(firstDeleteBtn!);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^delete project$/i })).toBeDefined(),
    );
    fireEvent.click(screen.getByRole('button', { name: /^delete project$/i }));

    await waitFor(() => {
      expect(deleteProject).toHaveBeenCalledWith('proj-1');
    });
    await waitFor(() => {
      expect(screen.queryByText('Alpha Project')).toBeNull();
      expect(screen.getByText('Beta Project')).toBeDefined();
    });
  });

  it('shows the verbatim `Project "<name>" deleted.` success toast', async () => {
    /*
     * Scenario: a successful delete must surface the verbatim success toast
     * with the project name interpolated so support docs and audit dashboards
     * can pattern-match on the exact wording.
     * Protects: StringLiteral mutant on the toast.success template literal —
     * any swap of the message breaks this exact-string assertion.
     */
    vi.mocked(listProjects).mockResolvedValue(mockProjects);
    vi.mocked(deleteProject).mockResolvedValue(undefined);

    render(<ProjectsList isAdmin refreshKey={0} />);
    await waitFor(() => expect(screen.getByText('Alpha Project')).toBeDefined());

    const [firstDeleteBtn] = screen.getAllByRole('button', { name: /^Delete project /i });
    fireEvent.click(firstDeleteBtn!);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^delete project$/i })).toBeDefined(),
    );
    fireEvent.click(screen.getByRole('button', { name: /^delete project$/i }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Project "Alpha Project" deleted.');
    });
  });

  it('disables the trigger button for the row whose delete is in flight', async () => {
    /*
     * Scenario: between confirming the delete and the server responding, the
     * trigger button on the row being deleted must be disabled so the operator
     * cannot re-enter the dialog and trigger a duplicate delete.
     * Protects: disabled={deleting === project.id} ConditionalExpression — a
     * `false` mutant would leave the trigger button enabled mid-flight, and a
     * `true` mutant would disable EVERY row's trigger.
     */
    vi.mocked(listProjects).mockResolvedValue(mockProjects);
    let resolveDelete: () => void = () => undefined;
    vi.mocked(deleteProject).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve;
        }),
    );

    render(<ProjectsList isAdmin refreshKey={0} />);
    await waitFor(() => expect(screen.getByText('Alpha Project')).toBeDefined());

    const triggers = screen.getAllByRole('button', { name: /^Delete project /i });
    const alphaTrigger = triggers[0]!;
    const betaTrigger = triggers[1]!;
    fireEvent.click(alphaTrigger);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^delete project$/i })).toBeDefined(),
    );
    fireEvent.click(screen.getByRole('button', { name: /^delete project$/i }));

    await waitFor(() => expect(deleteProject).toHaveBeenCalledWith('proj-1'));
    // The captured trigger references stay valid in the DOM even while the
    // dialog overlay marks the rest of the body aria-hidden during teardown.
    await waitFor(() => expect((alphaTrigger as HTMLButtonElement).disabled).toBe(true));
    // Other row's trigger must remain enabled — kills the `true` mutant which
    // would disable every row's trigger regardless of id.
    expect((betaTrigger as HTMLButtonElement).disabled).toBe(false);
    resolveDelete();
  });

  it('re-enables the trigger button after a failed delete (finally → setDeleting(null))', async () => {
    /*
     * Scenario: when deleteProject fails the row stays in the list and its
     * trigger button must become enabled again so the operator can retry.
     * Using the failure path avoids the post-success list reload that swaps
     * the DOM and complicates the assertion.
     * Protects: finally { setDeleting(null) } in handleDelete — the empty-block
     * mutant would leave `deleting` stuck on the just-attempted id, keeping
     * the trigger disabled forever for that row.
     */
    const err = new Error('Boom');
    vi.mocked(listProjects).mockResolvedValue(mockProjects);
    vi.mocked(deleteProject).mockRejectedValue(err);

    render(<ProjectsList isAdmin refreshKey={0} />);
    await waitFor(() => expect(screen.getByText('Alpha Project')).toBeDefined());

    const triggers = screen.getAllByRole('button', { name: /^Delete project /i });
    fireEvent.click(triggers[0]!);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^delete project$/i })).toBeDefined(),
    );
    fireEvent.click(screen.getByRole('button', { name: /^delete project$/i }));

    await waitFor(() =>
      expect(handleAuthClientError).toHaveBeenCalledWith(
        err,
        expect.objectContaining({ toast: expect.anything() }),
      ),
    );
    // After the failure resolves the finally block clears `deleting`, so the
    // Alpha trigger must be enabled again. Radix may keep the body
    // aria-hidden while it tears the dialog down, so query via the DOM
    // attribute selector that ignores the aria-hidden tree.
    await waitFor(() => {
      const alphaTrigger = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Delete project Alpha Project"]',
      );
      expect(alphaTrigger).not.toBeNull();
      expect(alphaTrigger?.disabled).toBe(false);
    });
  });

  it('reloads the list when refreshKey changes', async () => {
    /*
     * Scenario: incrementing refreshKey must trigger a new API call so the list
     * reflects the latest project state from the parent.
     * Protects: useEffect depends on [load, refreshKey] re-fetches on change.
     */
    vi.mocked(listProjects).mockResolvedValue([]);
    const { rerender } = render(<ProjectsList isAdmin={false} refreshKey={0} />);
    await waitFor(() => expect(listProjects).toHaveBeenCalledTimes(1));
    rerender(<ProjectsList isAdmin={false} refreshKey={1} />);
    await waitFor(() => expect(listProjects).toHaveBeenCalledTimes(2));
  });
});

// Keep one within-scoped guard so the helper import is exercised even if a
// future refactor narrows the assertions above.
describe('ProjectsList row scoping', () => {
  it('renders the Created label inside the same row as the project name', async () => {
    /*
     * Scenario: the Created … ago label must live alongside the project name in
     * the same row, otherwise the metadata is visually orphaned.
     * Protects: per-row layout — the createdAt paragraph sits as a sibling of
     * the project name inside the row container.
     */
    vi.mocked(listProjects).mockResolvedValue(mockProjects);
    render(<ProjectsList isAdmin={false} refreshKey={0} />);
    await waitFor(() => expect(screen.getByText('Alpha Project')).toBeDefined());
    const alphaName = screen.getByText('Alpha Project');
    const alphaRow = alphaName.closest('div.flex.items-center.justify-between');
    expect(alphaRow).not.toBeNull();
    expect(within(alphaRow as HTMLElement).getByText(/^Created\s.+\sago$/i)).toBeDefined();
  });
});
