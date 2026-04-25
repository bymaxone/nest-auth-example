/**
 * @fileoverview Fixed top bar for authenticated app pages.
 *
 * Visual style mirrors `ai-product-assistant`'s `Topbar`:
 *   - Dark glass: rgba(10,10,10,0.85) + backdrop-blur-[12px]
 *   - 1px border-bottom: rgba(255,255,255,0.07)
 *   - Brand icon + gradient name (left, always visible)
 *   - Hamburger (mobile) + user dropdown (right)
 *
 * Height: 64px. Stacked above the sidebar on all screen sizes.
 *
 * @layer components/layout
 */

'use client';

import { Menu } from 'lucide-react';
import { useSession } from '@bymax-one/nest-auth/react';
import SignOutButton from '@/components/auth/sign-out-button';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

interface TopbarProps {
  /** Called when the hamburger button is pressed to toggle the sidebar. */
  onMenuOpen: () => void;
}

/**
 * Fixed top bar — brand identity (left) + user menu (right).
 *
 * @param onMenuOpen - Handler invoked by the mobile hamburger button.
 */
export function Topbar({ onMenuOpen }: TopbarProps) {
  const { user } = useSession();

  const initials = user?.name
    ? user.name
        .split(' ')
        .slice(0, 2)
        .map((n) => n[0] ?? '')
        .join('')
        .toUpperCase()
    : '?';

  return (
    <header className="z-200 fixed left-0 right-0 top-0 flex h-16 items-center justify-between border-b border-[rgba(255,255,255,0.07)] bg-[rgba(10,10,10,0.85)] px-4 backdrop-blur-md lg:px-6">
      {/* ── Left: brand ── */}
      <div className="flex items-center gap-3">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[rgba(255,98,36,0.4)] bg-[rgba(255,98,36,0.15)]"
          aria-hidden="true"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 2L2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5"
              stroke="#ff6224"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <span className="bg-linear-to-r select-none from-[#ff6224] to-amber-200 bg-clip-text font-mono text-sm font-bold leading-tight text-transparent">
          nest-auth-example
        </span>
      </div>

      {/* ── Right: hamburger (mobile) + user info + sign out ── */}
      <div className="flex items-center gap-2">
        {/* Hamburger — mobile only */}
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open navigation menu"
          className="flex lg:hidden"
          onClick={onMenuOpen}
        >
          <Menu className="h-4 w-4 text-[rgba(255,255,255,0.7)]" />
        </Button>

        {/* User avatar + name */}
        {user && (
          <div className="hidden items-center gap-2 lg:flex">
            <Avatar className="h-7 w-7">
              <AvatarFallback className="bg-[rgba(255,98,36,0.15)] text-[10px] font-semibold text-[#ff6224]">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <span className="font-mono text-xs font-medium text-[rgba(255,255,255,0.8)]">
                {user.name}
              </span>
              <span className="font-mono text-[10px] text-[rgba(255,255,255,0.4)]">
                {user.role}
              </span>
            </div>
          </div>
        )}

        <SignOutButton />
      </div>
    </header>
  );
}
