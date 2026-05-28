/**
 * @fileoverview Platform admin sidebar navigation.
 *
 * Two nav items: Tenants and Users. Uses `lucide-react` icons and mirrors the
 * visual rhythm of the tenant dashboard sidebar, but with a dark red colour scheme
 * so it remains visually distinct from the dashboard context.
 *
 * @layer components/platform
 */

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Building2, Users, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Definition of a single platform nav item. */
interface PlatformNavItem {
  /** Link label displayed in the sidebar. */
  label: string;
  /** Absolute href for `<Link>`. */
  href: string;
  /** Icon component from `lucide-react`. */
  icon: React.ComponentType<{ className?: string }>;
  /** When true, only an exact path match marks the item active. */
  exact?: boolean;
}

/** Platform admin navigation items — read-only for SUPPORT, full access for SUPER_ADMIN. */
const PLATFORM_NAV_ITEMS: PlatformNavItem[] = [
  { label: 'Tenants', href: '/platform/tenants', icon: Building2, exact: true },
  { label: 'Users', href: '/platform/users', icon: Users, exact: false },
  { label: 'Security', href: '/platform/security', icon: Shield, exact: true },
];

// Stryker disable StringLiteral
const LINK_BASE_CLASS =
  'flex items-center gap-3 rounded-lg border-l-2 px-3 py-[10px] text-sm transition-all duration-150';
const ICON_BASE_CLASS = 'h-4 w-4 shrink-0';
const NAV_CONTAINER_CLASSES = [
  'flex w-[250px] shrink-0 flex-col border-r border-[rgba(239,68,68,0.2)] bg-[rgba(10,0,0,0.98)]',
  'sticky top-16 h-[calc(100vh-64px)] overflow-y-auto',
] as const;
// Stryker restore StringLiteral

// Branch-specific classes live OUTSIDE the block — each one is killable via a
// per-branch className assertion (active link contains `text-red-300`,
// inactive contains `text-[rgba(255,200,200,0.55)]`, etc.).
const LINK_ACTIVE_CLASS = 'border-l-red-500 bg-[rgba(239,68,68,0.15)] font-semibold text-red-300';
const LINK_INACTIVE_CLASS =
  'border-l-transparent font-normal text-[rgba(255,200,200,0.55)] hover:bg-[rgba(239,68,68,0.08)] hover:text-red-200';
const ICON_ACTIVE_CLASS = 'text-red-400';
const ICON_INACTIVE_CLASS = 'text-[rgba(255,200,200,0.4)]';

/** Single nav item — extracted so the active-state check stays component-scoped. */
function PlatformNavItem({ item }: { item: PlatformNavItem }) {
  const pathname = usePathname();
  const matchesExact = pathname === item.href;
  const matchesPrefix = pathname.startsWith(item.href);
  const isActive = item.exact ? matchesExact : matchesPrefix;
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      className={cn(LINK_BASE_CLASS, isActive ? LINK_ACTIVE_CLASS : LINK_INACTIVE_CLASS)}
      aria-current={isActive ? 'page' : undefined}
    >
      <Icon className={cn(ICON_BASE_CLASS, isActive ? ICON_ACTIVE_CLASS : ICON_INACTIVE_CLASS)} />
      {item.label}
    </Link>
  );
}

/**
 * Sidebar navigation for the platform admin area.
 *
 * Shows Tenants and Users links with lucide-react icons.
 * Always visible on desktop; on mobile it occupies its natural space
 * (the platform area is operator-only, so mobile breakpoints are simplified).
 */
export function PlatformSidebar() {
  return (
    <nav aria-label="Platform admin navigation" className={cn(...NAV_CONTAINER_CLASSES)}>
      <div className="flex h-full flex-col gap-0 px-4 py-6">
        <div className="flex flex-1 flex-col gap-1">
          {PLATFORM_NAV_ITEMS.map((item) => (
            <PlatformNavItem key={item.href} item={item} />
          ))}
        </div>

        {/* Bottom label — reinforces the platform context */}
        <div className="mt-4 border-t border-[rgba(239,68,68,0.15)] pt-4">
          <p className="px-2 font-mono text-[10px] uppercase tracking-widest text-red-800">
            Platform Admin Area
          </p>
        </div>
      </div>
    </nav>
  );
}
