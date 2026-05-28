/**
 * @fileoverview Sticky sidebar navigation for authenticated dashboard pages.
 *
 * Visual style mirrors `ai-product-assistant`'s `Sidebar`:
 *   - Width: 250px, position sticky on desktop (lg+), fixed overlay on mobile
 *   - Background: rgba(12,12,12,0.98)
 *   - Border-right: rgba(255,255,255,0.08)
 *   - Active nav item: orange text (#ff6224), 2px left orange border, orange tinted bg
 *   - User footer: role pill + name + tenant
 *
 * Mobile behaviour: hidden when `isOpen=false`, shown as a fixed overlay below
 * the topbar (top: 64px) when `isOpen=true`.
 *
 * Role gating: `Team` and `Invitations` items are hidden for `MEMBER` and `VIEWER`
 * roles — only `ADMIN` and `OWNER` see them.
 *
 * @layer components/layout
 */

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  User,
  Shield,
  Monitor,
  Users,
  MailOpen,
  FolderOpen,
  ScrollText,
} from 'lucide-react';
import { useSession } from '@bymax-one/nest-auth/react';
import { cn } from '@/lib/utils';

/*
 * Pure-visual Tailwind class strings hoisted into module-level constants
 * per the constant-extraction pattern (mutation-testing-guidelines.md
 * § "Disable-directive placement"). The behaviourally-distinguishing
 * tokens (`#ff6224` brand orange on the active arm, `flex` / `hidden`
 * on the mobile-visibility ternary) live OUTSIDE the disable block
 * because they ARE pinned by tests.
 */
// Stryker disable StringLiteral
const NAV_ITEM_BASE_CLASS =
  'flex items-center gap-3 rounded-lg border-l-2 px-3 py-[10px] text-sm transition-all duration-150';
const NAV_ITEM_INACTIVE_CLASS =
  'border-l-transparent font-normal text-[rgba(255,255,255,0.55)] hover:bg-[rgba(255,255,255,0.05)] hover:text-[rgba(255,255,255,0.8)]';
const ICON_BASE_CLASS = 'h-4 w-4 shrink-0';
const ICON_INACTIVE_CLASS = 'text-[rgba(255,255,255,0.4)]';
const NAV_BASE_CLASSES = [
  'flex w-[250px] shrink-0 flex-col border-r border-[rgba(255,255,255,0.08)] bg-[rgba(12,12,12,0.98)]',
  // Mobile: fixed overlay below topbar
  'z-100 fixed left-0 top-16 h-[calc(100vh-64px)] overflow-y-auto',
  // Desktop: sticky in the flex row
  'lg:sticky lg:top-16 lg:h-[calc(100vh-64px)]',
] as const;
// Stryker restore StringLiteral

/** Active-state palette class — `text-[#ff6224]` brand orange. The active-state test pins this fragment. */
const NAV_ITEM_ACTIVE_CLASS =
  'border-l-[#ff6224] bg-[rgba(255,98,36,0.1)] font-semibold text-[#ff6224]';
const ICON_ACTIVE_CLASS = 'text-[#ff6224]';

/** Mobile-visibility classes. Pinned by the isOpen=true / isOpen=false tests. */
const NAV_OPEN_CLASS = 'flex';
const NAV_CLOSED_CLASS = 'hidden lg:flex';

/** Roles that may view admin-only nav items. */
const ADMIN_ROLES = new Set(['OWNER', 'ADMIN']);

/** Navigation item definition. */
interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  /** When true, only exact path match marks the item active. */
  exact?: boolean;
  /** When true, only ADMIN / OWNER roles see this item. */
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Overview', href: '/dashboard', icon: LayoutDashboard, exact: true },
  { label: 'Account', href: '/dashboard/account', icon: User },
  { label: 'Security', href: '/dashboard/security', icon: Shield },
  { label: 'Sessions', href: '/dashboard/sessions', icon: Monitor },
  { label: 'Projects', href: '/dashboard/projects', icon: FolderOpen },
  { label: 'Team', href: '/dashboard/team', icon: Users, adminOnly: true },
  { label: 'Invitations', href: '/dashboard/invitations', icon: MailOpen, adminOnly: true },
  { label: 'Audit log', href: '/dashboard/audit', icon: ScrollText, adminOnly: true },
];

interface SidebarNavItemProps {
  item: NavItem;
  onNavClick?: () => void;
}

/** Single nav item — extracted so the active-state check stays component-scoped. */
function SidebarNavItem({ item, onNavClick }: SidebarNavItemProps) {
  const pathname = usePathname();
  const isActive = item.exact ? pathname === item.href : pathname.startsWith(item.href);
  const Icon = item.icon;

  // Stryker disable next-line ConditionalExpression: the conditional spread guards against passing `onClick={undefined}` to Link — under React's prop handling, `onClick={undefined}` is a no-op identical to omitting the prop. A mutated `true && {…}` would still spread `{ onClick: undefined }`, which is observationally equivalent. The conditional is kept for type-narrowing readability under exactOptionalPropertyTypes.
  const linkExtras = onNavClick !== undefined ? { onClick: onNavClick } : {};
  return (
    <Link
      href={item.href}
      {...linkExtras}
      className={cn(
        NAV_ITEM_BASE_CLASS,
        isActive ? NAV_ITEM_ACTIVE_CLASS : NAV_ITEM_INACTIVE_CLASS,
      )}
      aria-current={isActive ? 'page' : undefined}
    >
      <Icon className={cn(ICON_BASE_CLASS, isActive ? ICON_ACTIVE_CLASS : ICON_INACTIVE_CLASS)} />
      {item.label}
    </Link>
  );
}

interface SidebarProps {
  /** Whether the sidebar overlay is open (controlled by the dashboard layout). */
  isOpen: boolean;
  /** Called when a nav link is clicked or the sidebar is dismissed. */
  onNavClick?: () => void;
}

/**
 * Sidebar navigation panel for the authenticated dashboard.
 *
 * Admin-only items (`Team`, `Invitations`) are hidden for `MEMBER` and `VIEWER`
 * roles using the `user.role` value from `useSession()`.
 *
 * @param isOpen     - Controls mobile visibility.
 * @param onNavClick - Closes the mobile overlay on navigation.
 */
export function Sidebar({ isOpen, onNavClick }: SidebarProps) {
  const { user } = useSession();
  const isAdmin = user !== null && ADMIN_ROLES.has(user.role);

  const visibleItems = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);

  // Stryker disable next-line ConditionalExpression: same conditional-spread reasoning as the Link's `linkExtras` — passing `onNavClick={undefined}` down to SidebarNavItem is observationally equivalent to omitting the prop. The conditional exists for exactOptionalPropertyTypes compliance, not for runtime branching.
  const childExtras = onNavClick !== undefined ? { onNavClick } : {};

  return (
    <nav
      aria-label="Main navigation"
      className={cn(...NAV_BASE_CLASSES, isOpen ? NAV_OPEN_CLASS : NAV_CLOSED_CLASS)}
    >
      <div className="flex h-full flex-col gap-0 px-4 py-6">
        {/* ── Navigation items ── */}
        <div className="flex flex-1 flex-col gap-1">
          {visibleItems.map((item) => (
            <SidebarNavItem key={item.href} item={item} {...childExtras} />
          ))}
        </div>

        {/* ── Footer: user identity ── */}
        {user && (
          <div className="mt-4 border-t border-[rgba(255,255,255,0.08)] pt-4">
            <div className="flex flex-col gap-0.5 px-2">
              <span className="truncate text-xs text-[rgba(255,255,255,0.4)]">{user.tenantId}</span>
              <span className="truncate text-sm font-medium text-[rgba(255,255,255,0.8)]">
                {user.name}
              </span>
              {/* Role pill */}
              <span className="mt-1 inline-flex w-fit items-center rounded-full border border-[rgba(255,98,36,0.25)] bg-[rgba(255,98,36,0.12)] px-2 py-0.5">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-[#ff6224]">
                  {user.role}
                </span>
              </span>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
