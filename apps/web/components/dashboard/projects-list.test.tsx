/**
 * @fileoverview Unit tests for the `ProjectsList` component.
 *
 * Verifies loading, empty, and populated states, and that admin users
 * see a delete button per project row.
 *
 * @module components/dashboard/projects-list.test
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

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
import { ProjectsList } from './projects-list.js';

const mockProjects: ProjectInfo[] = [
  {
    id: 'proj-1',
    name: 'Alpha Project',
    tenantId: 'tenant-1',
    ownerUserId: 'user-1',
    createdAt: new Date(Date.now() - 86400_000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'proj-2',
    name: 'Beta Project',
    tenantId: 'tenant-1',
    ownerUserId: 'user-1',
    createdAt: new Date(Date.now() - 172800_000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

beforeEach(() => {
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
      const deleteButtons = screen.getAllByRole('button', { name: /delete project/i });
      expect(deleteButtons).toHaveLength(2);
    });
  });
});

describe('ProjectsList error paths', () => {
  it('calls handleAuthClientError when listProjects rejects', async () => {
    /*
     * Scenario: when the initial load fails the error must be forwarded to
     * handleAuthClientError so the user sees a toast.
     * Protects: line 55 — catch block in load() calls handleAuthClientError.
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
     * Protects: line 72 — catch block in handleDelete calls handleAuthClientError.
     */
    const err = new Error('Delete failed');
    vi.mocked(listProjects).mockResolvedValue(mockProjects);
    vi.mocked(deleteProject).mockRejectedValue(err);

    render(<ProjectsList isAdmin refreshKey={0} />);
    await waitFor(() => expect(screen.getByText('Alpha Project')).toBeDefined());

    const [firstDeleteBtn] = screen.getAllByRole('button', { name: /delete project/i });
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
    // First load returns two projects; after delete, returns one.
    vi.mocked(listProjects)
      .mockResolvedValueOnce(mockProjects)
      .mockResolvedValueOnce([mockProjects[1]!]);
    vi.mocked(deleteProject).mockResolvedValue(undefined);

    render(<ProjectsList isAdmin refreshKey={0} />);
    await waitFor(() => expect(screen.getByText('Alpha Project')).toBeDefined());

    // Open the confirmation dialog for the first project.
    const [firstDeleteBtn] = screen.getAllByRole('button', { name: /delete project/i });
    fireEvent.click(firstDeleteBtn!);

    // Click "Delete project" inside the AlertDialogAction.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^delete project$/i })).toBeDefined(),
    );
    fireEvent.click(screen.getByRole('button', { name: /^delete project$/i }));

    await waitFor(() => {
      expect(deleteProject).toHaveBeenCalledWith('proj-1');
    });
    // After reload only Beta Project remains.
    await waitFor(() => {
      expect(screen.queryByText('Alpha Project')).toBeNull();
      expect(screen.getByText('Beta Project')).toBeDefined();
    });
  });
});
