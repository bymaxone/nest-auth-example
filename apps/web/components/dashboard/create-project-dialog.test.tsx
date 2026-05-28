/**
 * @fileoverview Unit tests for the `CreateProjectDialog` component.
 *
 * Verifies:
 * - The "New project" trigger button renders.
 * - The dialog opens when the trigger is clicked.
 * - Submitting a valid project name calls createProject and onSuccess.
 * - Submitting with an empty name shows a validation error.
 *
 * @module components/dashboard/create-project-dialog.test
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/auth-client', () => ({
  createProject: vi.fn(),
  handleAuthClientError: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ── Typed imports after mocks ─────────────────────────────────────────────────

import { createProject, handleAuthClientError } from '@/lib/auth-client';
import { toast } from 'sonner';
import { CreateProjectDialog } from './create-project-dialog.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CreateProjectDialog rendering', () => {
  it('renders the "New project" trigger button', () => {
    /*
     * Scenario: the trigger button must be in the document so the user can
     * open the dialog to create a project.
     * Protects: basic rendering of the DialogTrigger button.
     */
    render(<CreateProjectDialog onSuccess={vi.fn()} />);
    expect(screen.getByRole('button', { name: /new project/i })).toBeDefined();
  });

  it('opens the dialog when the trigger is clicked', () => {
    /*
     * Scenario: clicking the trigger must show the dialog with the project
     * name input so the user can fill in the details.
     * Protects: Dialog open state changes on trigger click.
     */
    render(<CreateProjectDialog onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /new project/i }));
    expect(screen.getByText(/create project/i)).toBeDefined();
    expect(screen.getByPlaceholderText(/my project/i)).toBeDefined();
  });
});

describe('CreateProjectDialog submission', () => {
  it('calls createProject with the project name, shows the verbatim success toast, closes the dialog and invokes onSuccess', async () => {
    /*
     * Scenario: typing a project name and clicking "Create" must call
     * createProject with the name, surface the verbatim success toast,
     * close the dialog, and invoke the onSuccess callback so the parent
     * can refresh its list.
     * Protects: successful submit path end-to-end —
     * - createProject called with the typed name,
     * - verbatim `Project "My App" created.` toast (StringLiteral kill),
     * - setOpen(false) closes the dialog (BooleanLiteral kill — a `true`
     *   mutant would keep the dialog open or reopen it),
     * - onSuccess invoked so the parent can refresh.
     */
    vi.mocked(createProject).mockResolvedValue({
      id: 'proj-new',
      name: 'My App',
      tenantId: 't1',
      ownerUserId: 'u1',
      createdAt: '',
      updatedAt: '',
    });
    const onSuccess = vi.fn();
    render(<CreateProjectDialog onSuccess={onSuccess} />);

    fireEvent.click(screen.getByRole('button', { name: /new project/i }));

    const nameInput = screen.getByPlaceholderText(/my project/i);
    fireEvent.change(nameInput, { target: { value: 'My App' } });

    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith('My App');
      expect(onSuccess).toHaveBeenCalledOnce();
      expect(toast.success).toHaveBeenCalledWith('Project "My App" created.');
    });
    // Dialog closed — the input is no longer in the document.
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/my project/i)).toBeNull();
    });
  });

  it('shows a validation error and marks the input with the red error border when the project name is empty', async () => {
    /*
     * Scenario: clicking "Create" without a project name must trigger the
     * required-validation error AND mark the input with the
     * `border-red-500/60` token so the failed field is visually distinguishable.
     * Protects:
     * - Zod min(1) validation shows error on empty name,
     * - className StringLiteral `border-red-500/60` applied on the error
     *   branch (only branch — the other arm is now `false` via the
     *   `cn(errors.name && '…')` refactor).
     */
    render(<CreateProjectDialog onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /new project/i }));
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => {
      expect(screen.getByText(/project name is required/i)).toBeDefined();
    });
    expect(createProject).not.toHaveBeenCalled();
    const nameInput = screen.getByPlaceholderText(/my project/i);
    expect(nameInput.className).toContain('border-red-500/60');
  });

  it('renders the name input WITHOUT the red error border before validation runs', () => {
    /*
     * Scenario: before any validation runs the input must NOT carry the
     * `border-red-500/60` error token so the field looks neutral.
     * Protects: the `cn(errors.name && 'border-red-500/60')` falsy branch
     * resolves to empty — no error border. A mutant that always applies the
     * red border (or a mutant that flips the AND operand) would fail this.
     */
    render(<CreateProjectDialog onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /new project/i }));
    const nameInput = screen.getByPlaceholderText(/my project/i);
    expect(nameInput.className).not.toContain('border-red-500/60');
  });

  it('closes the dialog when the Cancel button is clicked', () => {
    /*
     * Scenario: clicking "Cancel" must close the dialog without submitting.
     * Protects: Cancel button sets open=false.
     */
    render(<CreateProjectDialog onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /new project/i }));
    expect(screen.getByPlaceholderText(/my project/i)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByPlaceholderText(/my project/i)).toBeNull();
  });

  it('shows "Creating…" text on the submit button while the request is pending', async () => {
    /*
     * Scenario: while createProject is in-flight the submit button must display
     * "Creating…" so the user knows submission is in progress.
     * Protects: line 115 — `isPending ? 'Creating…' : 'Create'` truthy branch.
     */
    // Never-resolving promise keeps isPending=true indefinitely.
    vi.mocked(createProject).mockReturnValue(new Promise(() => undefined));
    render(<CreateProjectDialog onSuccess={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /new project/i }));
    const nameInput = screen.getByPlaceholderText(/my project/i);
    fireEvent.change(nameInput, { target: { value: 'Pending Project' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      expect(screen.getByText('Creating…')).toBeDefined();
    });
  });

  it('forwards createProject failures to handleAuthClientError and re-enables the submit button (finally → setIsPending(false))', async () => {
    /*
     * Scenario: when createProject throws the error must be forwarded to
     * handleAuthClientError, the dialog must stay open (so the user can
     * retry), and the submit button must return to "Create" (not stuck on
     * "Creating…") so retry is possible.
     * Protects:
     * - catch block calls handleAuthClientError on API failure,
     * - finally { setIsPending(false) } in onSubmit — empty-block mutant
     *   would leave isPending=true forever, locking the button on
     *   "Creating…".
     */
    const err = new Error('API error');
    vi.mocked(createProject).mockRejectedValue(err);
    render(<CreateProjectDialog onSuccess={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /new project/i }));
    const nameInput = screen.getByPlaceholderText(/my project/i);
    fireEvent.change(nameInput, { target: { value: 'Test Project' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      expect(handleAuthClientError).toHaveBeenCalledWith(
        err,
        expect.objectContaining({ toast: expect.anything() }),
      );
    });
    // Submit button restored to "Create" — kills the empty-finally mutant
    // and the BooleanLiteral `setIsPending(false)` → `setIsPending(true)` mutant.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^create$/i })).toBeDefined();
      expect(screen.queryByText('Creating…')).toBeNull();
    });
  });
});
