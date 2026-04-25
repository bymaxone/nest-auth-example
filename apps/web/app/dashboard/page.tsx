/**
 * @fileoverview Dashboard overview page — identity summary + stats grid.
 *
 * Visual style mirrors `ai-product-assistant`'s `DashboardPage`:
 *   - Stats row: 4 KPI cards with top accent line + icon + value + label
 *   - Glass card background: rgba(255,255,255,0.04) with coloured top accent
 *   - Each card accent colour: orange, blue, green, purple
 *   - Hover: card lifts (-translate-y-1) + coloured box-shadow
 *
 * This is a server component — `requireAuth()` extracts the verified identity
 * from the JWT cookie without a network round-trip.
 *
 * @layer pages/dashboard
 */

import { User, Shield, Monitor, MailOpen } from 'lucide-react';
import { requireAuth } from '@/lib/require-auth';

/** Stat card configuration — icon, label, value, accent colour. */
interface StatCardConfig {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string;
  value: string;
  accent: string;
}

/** Accent colours matching ai-product-assistant's stat grid palette. */
const ACCENT_ORANGE = '#ff6224';
const ACCENT_BLUE = '#06b6d4';
const ACCENT_GREEN = '#10b981';
const ACCENT_PURPLE = '#8b5cf6';

/**
 * Individual KPI stat card with top accent line and icon.
 *
 * @param icon   - Lucide icon component.
 * @param label  - Short metric description.
 * @param value  - Formatted metric value.
 * @param accent - Hex colour applied to the accent line, icon, and glow.
 */
function StatCard({ icon: Icon, label, value, accent }: StatCardConfig) {
  return (
    <div
      className="group relative overflow-hidden rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] p-5 transition-all duration-200 hover:-translate-y-px"
      style={
        {
          '--accent': accent,
        } as React.CSSProperties
      }
    >
      {/* Top accent line */}
      <div
        aria-hidden="true"
        className="absolute left-0 right-0 top-0 h-0.5 opacity-60"
        style={{
          background: `linear-gradient(to right, transparent, ${accent}, transparent)`,
        }}
      />

      <div className="flex flex-col gap-3">
        {/* Icon badge */}
        <div
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border"
          style={{
            background: `${accent}15`,
            borderColor: `${accent}25`,
          }}
        >
          <Icon className="h-4 w-4" style={{ color: accent }} />
        </div>

        {/* Value + label */}
        <div>
          <p className="font-mono text-2xl font-bold leading-none text-white">{value}</p>
          <p className="mt-1 text-xs font-medium text-[rgba(255,255,255,0.5)]">{label}</p>
        </div>
      </div>
    </div>
  );
}

/**
 * Dashboard overview — identity card + stats grid.
 *
 * All data is derived from the JWT; no additional API calls at render time.
 */
export default async function DashboardPage() {
  const session = await requireAuth();

  const stats: StatCardConfig[] = [
    {
      icon: User,
      label: 'Signed in as',
      value: session.role,
      accent: ACCENT_ORANGE,
    },
    {
      icon: Shield,
      label: 'Tenant',
      value: session.tenantId ?? 'platform',
      accent: ACCENT_BLUE,
    },
    {
      icon: Monitor,
      label: 'Session',
      value: 'Active',
      accent: ACCENT_GREEN,
    },
    {
      icon: MailOpen,
      label: 'User ID',
      value: session.userId.slice(0, 8) + '…',
      accent: ACCENT_PURPLE,
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      {/* ── Page header ── */}
      <div>
        <h1 className="font-mono text-2xl font-bold text-white">Dashboard</h1>
        <p className="mt-1 text-sm text-[rgba(255,255,255,0.5)]">
          Welcome back — your session is active and your identity is verified.
        </p>
      </div>

      {/* ── Stats grid ── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </div>

      {/* ── Auth feature overview ── */}
      <div className="rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-6">
        <h2 className="mb-4 font-mono text-base font-semibold text-white">Auth coverage</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { label: 'JWT refresh rotation', done: true },
            { label: 'MFA / TOTP', done: true },
            { label: 'Google OAuth', done: true },
            { label: 'Multi-tenancy', done: true },
            { label: 'Platform admin', done: true },
            { label: 'WebSocket auth', done: true },
            { label: 'Session management', done: true },
            { label: 'Brute-force protection', done: true },
          ].map(({ label, done }) => (
            <div key={label} className="flex items-center gap-2 text-sm">
              <span
                className={done ? 'text-[#22c55e]' : 'text-[rgba(255,255,255,0.3)]'}
                aria-hidden="true"
              >
                {done ? '✓' : '○'}
              </span>
              <span
                className={done ? 'text-[rgba(255,255,255,0.7)]' : 'text-[rgba(255,255,255,0.3)]'}
              >
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
