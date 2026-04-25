/**
 * @fileoverview Recovery codes display modal — shown once after MFA is enabled.
 *
 * Lists the one-time recovery codes returned by `POST /auth/mfa/setup`.
 * The user must save these before the modal is dismissed; they cannot be
 * retrieved again. The dialog is controlled (caller owns `open` state).
 *
 * @layer components/dashboard
 */

'use client';

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';

interface RecoveryCodesModalProps {
  /** Whether the modal is visible. */
  open: boolean;
  /** Called when the user clicks "I've saved my codes". */
  onClose: () => void;
  /** Recovery codes to display. */
  codes: string[];
}

/**
 * Modal that presents MFA recovery codes for the user to copy.
 *
 * Blocks dismissal via the standard `AlertDialog` — the user must click
 * the confirm button to close. The codes are rendered in a monospace grid
 * for easy scanning.
 *
 * @param open    - Controlled visibility flag.
 * @param onClose - Called when the confirm button is clicked.
 * @param codes   - Array of recovery code strings.
 */
export function RecoveryCodesModal({ open, onClose, codes }: RecoveryCodesModalProps) {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-white">Save your recovery codes</AlertDialogTitle>
          <AlertDialogDescription className="text-[rgba(255,255,255,0.55)]">
            These codes can be used to access your account if you lose your authenticator app. Each
            code works only once. Store them somewhere safe — they cannot be shown again.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="my-2 grid grid-cols-2 gap-2 rounded-lg border border-[rgba(255,255,255,0.08)] bg-[rgba(0,0,0,0.3)] p-4">
          {codes.map((code) => (
            <span
              key={code}
              className="font-mono text-sm tracking-widest text-[rgba(255,255,255,0.85)]"
            >
              {code}
            </span>
          ))}
        </div>

        <AlertDialogFooter>
          <AlertDialogAction variant="default" onClick={onClose}>
            I&apos;ve saved my codes
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
