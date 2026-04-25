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
 * @layer components/layout
 */

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, User, Shield, Monitor, Users, MailOpen } from 'lucide-react';
import { useSession } from '@bymax-one/nest-auth/react';
import { cn } from '@/lib/utils';

/** Navigation item definition. */
interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  /** When true, only exact path match marks the item active. */
  exact?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Overview', href: '/dashboard', icon: LayoutDashboard, exact: true },
  { label: 'Account', href: '/dashboard/account', icon: User },
  { label: 'Security', href: '/dashboard/security', icon: Shield },
  { label: 'Sessions', href: '/dashboard/sessions', icon: Monitor },
  { label: 'Team', href: '/dashboard/team', icon: Users },
  { label: 'Invitations', href: '/dashboard/invitations', icon: MailOpen },
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

  return (
    <Link
      href={item.href}
      {...(onNavClick !== undefined && { onClick: onNavClick })}
      className={cn(
        'flex items-center gap-3 rounded-lg border-l-2 px-3 py-[10px] text-sm transition-all duration-150',
        isActive
          ? 'border-l-[#ff6224] bg-[rgba(255,98,36,0.1)] font-semibold text-[#ff6224]'
          : 'border-l-transparent font-normal text-[rgba(255,255,255,0.55)] hover:bg-[rgba(255,255,255,0.05)] hover:text-[rgba(255,255,255,0.8)]',
      )}
      aria-current={isActive ? 'page' : undefined}
    >
      <Icon
        className={cn(
          'h-4 w-4 shrink-0',
          isActive ? 'text-[#ff6224]' : 'text-[rgba(255,255,255,0.4)]',
        )}
      />
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
 * @param isOpen   - Controls mobile visibility.
 * @param onNavClick - Closes the mobile overlay on navigation.
 */
export function Sidebar({ isOpen, onNavClick }: SidebarProps) {
  const { user } = useSession();

  return (
    <nav
      aria-label="Main navigation"
      className={cn(
        'flex w-[250px] shrink-0 flex-col border-r border-[rgba(255,255,255,0.08)] bg-[rgba(12,12,12,0.98)]',
        // Mobile: fixed overlay below topbar
        'z-100 fixed left-0 top-16 h-[calc(100vh-64px)] overflow-y-auto',
        // Desktop: sticky in the flex row
        'lg:sticky lg:top-16 lg:h-[calc(100vh-64px)]',
        // Mobile visibility toggle
        isOpen ? 'flex' : 'hidden lg:flex',
      )}
    >
      <div className="flex h-full flex-col gap-0 px-4 py-6">
        {/* ── Navigation items ── */}
        <div className="flex flex-1 flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <SidebarNavItem
              key={item.href}
              item={item}
              {...(onNavClick !== undefined && { onNavClick })}
            />
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
