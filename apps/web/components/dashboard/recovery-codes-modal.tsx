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

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';

/** How long the "Copied" confirmation stays on the button, in milliseconds. */
const COPIED_FEEDBACK_MS = 2000;

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
  const [hasCopied, setHasCopied] = useState(false);

  /**
   * Copies every code to the clipboard, one per line.
   *
   * The clipboard API rejects when the document is not focused or permission is
   * refused; the codes stay on screen either way, so the failure is reported and
   * nothing is lost.
   */
  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setHasCopied(true);
      window.setTimeout(() => setHasCopied(false), COPIED_FEEDBACK_MS);
    } catch {
      toast.error('Could not copy to the clipboard. Select the codes and copy them manually.');
    }
  };

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

        {/* `tracking-widest` on a code this long pushed it past its column and
            wrapped mid-value, which is the worst possible moment to make a code
            hard to read: it is shown exactly once. Normal tracking with
            `whitespace-nowrap` keeps each code on one line. */}
        <div className="my-2 grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-[rgba(255,255,255,0.08)] bg-[rgba(0,0,0,0.3)] p-4">
          {codes.map((code) => (
            <span
              key={code}
              className="font-mono text-sm whitespace-nowrap text-[rgba(255,255,255,0.85)]"
            >
              {code}
            </span>
          ))}
        </div>

        <AlertDialogFooter className="sm:justify-between">
          {/* Copying is the whole point of the dialog — the codes are shown once
              and transcribing them by hand is how people lose them. */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleCopy()}
            className="gap-2"
          >
            {hasCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {hasCopied ? 'Copied' : 'Copy codes'}
          </Button>
          <AlertDialogAction variant="default" onClick={onClose}>
            I&apos;ve saved my codes
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
