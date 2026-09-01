/**
 * @file notifications.gateway.ts
 * @description WebSocket gateway that delivers real-time notifications to
 * authenticated dashboard users. Uses `WsJwtGuard` from `@bymax-one/nest-auth`
 * to verify the JWT carried in the `Authorization: Bearer` header of the
 * WebSocket upgrade request.
 *
 * Transport: plain WebSocket (via `@nestjs/platform-ws` `WsAdapter`).
 * Path: `/ws/notifications`
 *
 * Authentication flow (first match wins):
 *  1. Single-use WebSocket ticket (`?ticket=` query param, lib v1.1.0+): the
 *     browser first calls `POST /api/auth/ws-ticket` (authenticated) and then
 *     connects with the returned ticket. `WsTicketService.redeem` consumes it
 *     atomically — a replayed ticket is refused. This is the canonical browser
 *     path: browsers cannot set custom headers on WS upgrades, and putting a
 *     long-lived JWT in a URL would leak it into logs.
 *  2. `Authorization: Bearer <token>` header — for non-browser clients.
 *  3. `Cookie: access_token=<token>` — same-origin fallback via the Next.js proxy.
 *  For paths 2–3 the JWT is verified with `JwtService` and then checked against
 *  the library's `AuthRevocationService` (JTI blacklist + token epoch) — the
 *  check a logout, "sign out everywhere", or suspension relies on.
 *  On failure the connection closes immediately with code 4401.
 *
 * `WsAuthExceptionFilter` (lib v1.4.3+) is registered at class level so any
 * future `@SubscribeMessage` handler refused by `WsJwtGuard` answers with the
 * library's `auth.*` error envelope instead of crashing the socket.
 *
 *  A ticket cannot be checked against the revocation channels — its snapshot
 *  carries no `jti` and no epoch — so when the same-origin upgrade also brings
 *  the access-token cookie, that token's revocation state is checked alongside
 *  it. It corroborates the ticket; it never replaces it.
 *
 * Admission and disconnect:
 *  `disconnectUser` can only reach sockets already in the connection map, so a
 *  connection still being authenticated would otherwise be registered just
 *  after and outlive the revocation that targeted it. Every attempt therefore
 *  carries the monotonic timestamp it started at, and one that started before a
 *  disconnect for the same user is refused with 4403 instead of registered.
 *
 * Disconnect-on-suspension:
 *  When a tenant admin or platform admin suspends a user, `disconnectUser(userId)`
 *  is called (via `UsersService` and `PlatformService`). All sockets belonging to
 *  that user are forcibly closed.
 *
 * @layer notifications
 * @see docs/guidelines/nest-auth-guidelines.md §Decorators & guards
 */

import type { IncomingMessage } from 'node:http';
import { performance } from 'node:perf_hooks';

import { Logger, UseFilters, UseGuards } from '@nestjs/common';
import { WebSocketGateway } from '@nestjs/websockets';
import type { OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import {
  AuthRevocationService,
  WsAuthExceptionFilter,
  WsJwtGuard,
  WsTicketService,
} from '@bymax-one/nest-auth';
import type { DashboardJwtPayload, WsTicketSnapshot } from '@bymax-one/nest-auth';
import type { WebSocket } from 'ws';

import { isBlockedStatus } from '../auth/auth.constants.js';

/** `ws.WebSocket.readyState` value when the connection is being established. */
const WS_CONNECTING = 0;
/** `ws.WebSocket.readyState` value when the connection is open and ready. */
const WS_OPEN = 1;

/**
 * Extended WebSocket client type that includes NestJS-managed `data` and the
 * `handshake` shim required by `WsJwtGuard`.
 *
 * We add these fields in `handleConnection` before any guard runs so that
 * `WsJwtGuard.canActivate` finds the expected shape on the client object.
 */
interface AuthenticatedSocket extends WebSocket {
  /** User-keyed data store set by the auth layer. */
  data: {
    user?: DashboardJwtPayload;
    userId?: string;
  };
  /**
   * Socket.IO-compatible handshake shim. `WsJwtGuard` reads
   * `client.handshake.headers.authorization` to extract the Bearer token.
   * We populate this in `handleConnection` from the HTTP upgrade request headers.
   */
  handshake: {
    headers: Record<string, string | undefined>;
  };
}

/**
 * Extracts the `ticket` query parameter from a WebSocket upgrade request URL.
 *
 * The upgrade `req.url` is server-relative (e.g. `/ws/notifications?ticket=x`),
 * so a fixed localhost base makes `URL` parse it; only the query is read.
 *
 * @param url - `IncomingMessage.url` from the upgrade request, if any.
 * @returns The ticket string, or undefined when absent/empty.
 */
function extractTicket(url: string | undefined): string | undefined {
  if (typeof url !== 'string' || url.length === 0) {
    return undefined;
  }
  try {
    const ticket = new URL(url, 'http://localhost').searchParams.get('ticket');
    return ticket !== null && ticket.length > 0 ? ticket : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads the access token from an upgrade request, header first, cookie second.
 *
 * Browsers cannot set an `Authorization` header on a WebSocket upgrade, so the
 * cookie fallback is what makes same-origin browser connections work at all.
 *
 * @param req - The HTTP upgrade request, if any.
 * @param authHeader - Pre-read `Authorization` header value, if a string.
 * @returns The raw JWT, or undefined when neither source carries one.
 */
function extractAccessToken(
  req: IncomingMessage | undefined,
  authHeader: string | undefined,
): string | undefined {
  // Stryker disable next-line StringLiteral: the `'Bearer '` literal in
  // startsWith is paired with the slice(7) length on the next line. Both
  // must drift together to change observable behaviour; mutating the
  // startsWith prefix in isolation either accepts every header (rejected
  // later by jwt.verify) or accepts none (degrades to the 4401 path).
  if (authHeader?.startsWith('Bearer ')) {
    // Stryker disable next-line StringLiteral: the 'Bearer ' prefix length (7)
    // is paired with the `startsWith('Bearer ')` check above. Mutating either
    // independently produces noise (e.g. slice(7) of any non-Bearer string
    // still produces a "token" that the downstream `jwt.verify` rejects with
    // the same 4401 close). Both must drift together to change observable
    // behaviour, and the file-level guard test asserts the full Bearer flow.
    return authHeader.slice(7);
  }

  // Stryker disable next-line StringLiteral: empty-string fallback when no
  // cookie header is present yields the same final 4401 as the original —
  // an empty cookie header runs the regex against "" with no match.
  const cookieHeader = typeof req?.headers['cookie'] === 'string' ? req.headers['cookie'] : '';
  // Stryker disable next-line Regex: the access_token regex is exercised
  // by the dedicated cookie-fallback test. Stryker's regex mutators on
  // anchors / character classes produce regexes that either match the
  // same inputs or fail every input — the latter degrades to the no-token
  // 4401 path which downstream JWT verification would also produce.
  const match = /(?:^|;\s*)access_token=([^;]+)/.exec(cookieHeader);
  return match?.[1];
}

/**
 * WebSocket gateway at `/ws/notifications`, protected by `WsJwtGuard`.
 *
 * All `@SubscribeMessage` handlers (if added in the future) are covered by the
 * class-level `@UseGuards(WsJwtGuard)`. Authentication at connection time is
 * handled manually in `handleConnection` — NestJS guards do not intercept
 * connections, only message handlers.
 *
 * @public
 */
@UseGuards(WsJwtGuard)
@UseFilters(new WsAuthExceptionFilter())
@WebSocketGateway({ path: '/ws/notifications' })
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(NotificationsGateway.name);

  /**
   * In-memory map from `userId` to the set of currently connected sockets.
   * Entries are removed in `handleDisconnect` once the set becomes empty.
   */
  private readonly userSockets = new Map<string, Set<AuthenticatedSocket>>();

  /**
   * When each user was last force-disconnected, on the monotonic clock.
   *
   * `disconnectUser` can only close sockets that are already in `userSockets`,
   * and a connection is not there yet while its ticket redemption or its
   * revocation lookup is in flight. Without this marker such a connection is
   * registered a moment later and, since an established socket is never
   * re-authenticated, streams for as long as it stays open — precisely the
   * device the disconnect was meant to cut off. `admitSocket` compares the
   * marker against when the connection attempt started and refuses the ones
   * that raced.
   *
   * One number per user ever disconnected in this process, so it grows with the
   * user table rather than with traffic. Like `userSockets` it is per-process:
   * a disconnect reaches only the instance holding the socket, so a multi-
   * instance deployment needs both of these in a shared store, not just this.
   */
  private readonly forcedDisconnectAt = new Map<string, number>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly wsTickets: WsTicketService,
    private readonly revocation: AuthRevocationService,
  ) {}

  /**
   * Called by the `WsAdapter` when a new WebSocket connection is established.
   *
   * Authentication is attempted in one of two mutually exclusive modes, in
   * this order:
   *
   *   1. **Upgrade ticket** (`?ticket=` in the upgrade URL) — the browser path.
   *      Single-use and short-lived, so a value leaked into an access log is
   *      worthless moments later.
   *   2. **JWT** from `Authorization: Bearer <token>`, falling back to the
   *      `access_token` cookie — for non-browser clients, and for browser
   *      connections arriving through the Next.js same-origin proxy. Browsers
   *      cannot set custom headers on a WS upgrade but do forward HttpOnly
   *      cookies for same-origin URLs.
   *
   * Each mode owns its own rejection: on failure the socket is closed with
   * 4401 (unauthorized) or 4403 (suspended) and nothing is registered. On
   * success the socket joins the `userSockets` map with `client.data` and the
   * `client.handshake` shim populated, so `WsJwtGuard` keeps working on any
   * future `@SubscribeMessage` handler.
   *
   * @param client - The newly connected `ws.WebSocket` instance.
   * @param args - Additional connection arguments; index 0 is the `IncomingMessage`
   *   HTTP upgrade request provided by `@nestjs/platform-ws`.
   */
  async handleConnection(client: AuthenticatedSocket, ...args: unknown[]): Promise<void> {
    const req = args[0] as IncomingMessage | undefined;
    // Read before the first await: everything after this point can be overtaken
    // by a disconnect, and `admitSocket` needs to know the attempt predates it.
    const admissionStartedAt = performance.now();

    const ticket = extractTicket(req?.url);
    if (ticket !== undefined) {
      await this.authenticateWithTicket(client, ticket, admissionStartedAt, req);
      return;
    }

    await this.authenticateWithJwt(client, req, admissionStartedAt);
  }

  /**
   * Ticket path — redeems a single-use WS upgrade ticket (lib v1.1.0+).
   *
   * Redemption is atomic, so a second connection replaying the same ticket is
   * refused. The redeemed snapshot carries the repository's CURRENT account
   * state, unlike the access-token `status` claim which is point-in-time and
   * never authoritative — blocked accounts are refused at the door.
   *
   * Ticket connections carry no JWT, so no `handshake` shim is set: any future
   * `@SubscribeMessage` handler guarded by `WsJwtGuard` requires the
   * Bearer/cookie path. This gateway is push-only today.
   *
   * A redeemed ticket says nothing about the session that minted it: the
   * snapshot carries identity and account status, no `jti` and no epoch
   * (bymaxone/nest-auth#183). So a ticket minted moments before a logout, a
   * password change or "sign out everywhere" still redeems for the rest of its
   * TTL, and the socket it opens is never revalidated. The browser sends its
   * cookies on this same-origin upgrade, and those DO carry the session — so
   * the access token's revocation state is checked as well when one is
   * present. It is corroboration, not a second gate: an absent or unverifiable
   * token leaves the ticket to stand on its own, exactly as before.
   *
   * @param client - The connecting socket, closed in place on refusal.
   * @param ticket - The raw ticket value read from the upgrade URL.
   * @param admissionStartedAt - Monotonic timestamp taken before the redemption.
   * @param req - The upgrade request, read for the access-token cookie.
   */
  private async authenticateWithTicket(
    client: AuthenticatedSocket,
    ticket: string,
    admissionStartedAt: number,
    req: IncomingMessage | undefined,
  ): Promise<void> {
    let snapshot: WsTicketSnapshot;
    try {
      snapshot = await this.wsTickets.redeem(ticket);
    } catch {
      client.close(4401, 'Unauthorized');
      return;
    }

    if (isBlockedStatus(snapshot.status)) {
      client.close(4403, 'Account suspended');
      return;
    }

    if (await this.isRevokedByCookie(req)) {
      this.logger.warn({ msg: 'ws:ticket_refused', reason: 'session_revoked' });
      client.close(4401, 'Unauthorized');
      return;
    }

    client.data = { userId: snapshot.sub };
    client.handshake = { headers: {} };
    this.admitSocket(snapshot.sub, client, admissionStartedAt);
  }

  /**
   * JWT path — verifies a Bearer/cookie access token and admits the socket.
   *
   * Every refusal closes with 4401: a missing token, a token that fails
   * verification or is not a `dashboard` token, and a revoked one.
   *
   * @param client - The connecting socket, closed in place on refusal.
   * @param req - The HTTP upgrade request carrying the header or cookie.
   * @param admissionStartedAt - Monotonic timestamp taken before the lookups.
   */
  private async authenticateWithJwt(
    client: AuthenticatedSocket,
    req: IncomingMessage | undefined,
    admissionStartedAt: number,
  ): Promise<void> {
    const authHeader =
      typeof req?.headers['authorization'] === 'string' ? req.headers['authorization'] : undefined;
    const token = extractAccessToken(req, authHeader);

    // Close before the connection is fully established in the app's view.
    if (!token) {
      client.close(4401, 'Unauthorized');
      return;
    }

    const payload = this.verifyDashboardToken(token);
    if (!payload) {
      client.close(4401, 'Unauthorized');
      return;
    }

    // `AuthRevocationService` (lib v1.3.1+) is the library's supported
    // revocation check for realtime bridges that authenticate outside the HTTP
    // guard chain — it covers both the JTI blacklist and the per-user token
    // epoch, and fails closed on a dashboard token that carries no tenant
    // (lib v1.4.4+).
    if (await this.revocation.isAccessTokenRevoked(payload)) {
      client.close(4401, 'Unauthorized');
      return;
    }

    // The `handshake.headers.authorization` shim is required by `WsJwtGuard` on
    // any future `@SubscribeMessage` handler — synthesise it from the cookie
    // token when no explicit Authorization header was present.
    client.data = { user: payload, userId: payload.sub };
    client.handshake = {
      headers: { authorization: authHeader ?? `Bearer ${token}` },
    };

    this.admitSocket(payload.sub, client, admissionStartedAt);
  }

  /**
   * Whether the upgrade request carries an access token that has been revoked.
   *
   * Used to corroborate a ticket, which cannot be checked against the
   * revocation channels itself. Deliberately answers `false` — "nothing to say"
   * — in the two cases where the cookie is not evidence: no token at all (a
   * non-browser client, which never had one) and a token that does not verify
   * (expired, or minted for another plane). Only a token that verifies AND
   * comes back revoked refuses the connection, which is exactly the state a
   * logout, password change or bulk revocation leaves behind.
   *
   * @param req - The HTTP upgrade request.
   * @returns `true` only when a verifiable dashboard token is revoked.
   */
  private async isRevokedByCookie(req: IncomingMessage | undefined): Promise<boolean> {
    const authHeader =
      typeof req?.headers['authorization'] === 'string' ? req.headers['authorization'] : undefined;
    const token = extractAccessToken(req, authHeader);
    if (!token) return false;

    const payload = this.verifyDashboardToken(token);
    if (!payload) return false;

    return this.revocation.isAccessTokenRevoked(payload);
  }

  /**
   * Verifies an access token and confirms it belongs on this gateway.
   *
   * Platform and MFA-challenge tokens are signed with the same secret, so the
   * `type` claim is what keeps them off a dashboard socket; verification alone
   * would accept them.
   *
   * @param token - The raw JWT from the header or cookie.
   * @returns The payload when it verifies as a `dashboard` token, else undefined.
   */
  private verifyDashboardToken(token: string): DashboardJwtPayload | undefined {
    let payload: DashboardJwtPayload;
    try {
      payload = this.jwtService.verify<DashboardJwtPayload>(token, {
        algorithms: ['HS256'],
      });
    } catch {
      return undefined;
    }

    // Stryker disable next-line ConditionalExpression: the `typeof payload.type !== 'string'`
    // disjunct is a belt-and-suspenders narrowing — when the type field is not a string,
    // `payload.type !== 'dashboard'` would also be true (any non-string !== string literal).
    // Mutating it alone produces equivalent observable behaviour at this gate.
    if (typeof payload.type !== 'string' || payload.type !== 'dashboard') {
      return undefined;
    }

    return payload;
  }

  /**
   * Registers an authenticated socket unless a disconnect overtook it.
   *
   * Shared tail of every successful authentication path (ticket, Bearer,
   * cookie). The credential was checked before the awaits above; a revocation
   * that landed since then called `disconnectUser`, which found no socket for
   * this user to close because this one was not registered yet. Admitting it
   * now would hand the revoked device a connection nothing re-authenticates.
   * Refusing on that overlap is what makes admission atomic with the
   * disconnect, and it fails closed: an attempt that started in the same
   * millisecond as the disconnect is treated as having raced it.
   *
   * Nothing awaits between this check and the registration below, so no
   * disconnect can slip in between them; one arriving later finds the socket
   * in the map and closes it the ordinary way.
   *
   * @param userId - The authenticated user's internal ID.
   * @param client - The connected socket.
   * @param admissionStartedAt - When the connection attempt began, monotonic.
   */
  private admitSocket(
    userId: string,
    client: AuthenticatedSocket,
    admissionStartedAt: number,
  ): void {
    const forcedAt = this.forcedDisconnectAt.get(userId);
    if (forcedAt !== undefined && forcedAt >= admissionStartedAt) {
      this.logger.log({ msg: 'ws:admission_refused', userId, reason: 'disconnect_raced' });
      client.close(4403, 'Account suspended');
      return;
    }

    this.registerSocket(userId, client);
  }

  /**
   * Adds an authenticated socket to the `userSockets` map and logs the connect.
   *
   * @param userId - The authenticated user's internal ID.
   * @param client - The connected socket.
   */
  private registerSocket(userId: string, client: AuthenticatedSocket): void {
    let sockets = this.userSockets.get(userId);
    if (!sockets) {
      sockets = new Set();
      this.userSockets.set(userId, sockets);
    }
    sockets.add(client);

    this.logger.log({ msg: 'ws:connect', userId, socketCount: sockets.size });
  }

  /**
   * Called when a WebSocket connection is closed (by either side).
   *
   * Removes the socket from the `userSockets` map. If the set for a userId
   * becomes empty, the map entry is deleted to reclaim memory.
   *
   * @param client - The disconnected socket.
   */
  handleDisconnect(client: AuthenticatedSocket): void {
    // Stryker disable next-line OptionalChaining: `client.data` is set by
    // handleConnection before the socket is ever stored, so by the time
    // handleDisconnect fires `client.data` is non-null in every production
    // path. The optional chain is defensive for tests that synthesise
    // sockets without going through handleConnection — removing it would
    // throw in those tests but is unreachable in production.
    const userId = client.data?.userId;
    if (!userId) return;

    const sockets = this.userSockets.get(userId);
    if (sockets) {
      sockets.delete(client);
      if (sockets.size === 0) {
        this.userSockets.delete(userId);
      }
    }

    this.logger.log({ msg: 'ws:disconnect', userId });
  }

  /**
   * Emits a `notification:new` event to all open sockets belonging to `userId`.
   *
   * The method is synchronous and non-blocking — `ws.send` is fire-and-forget at
   * the OS level. No `await` or I/O is performed beyond the socket write.
   *
   * @param userId - Target user ID.
   * @param payload - Notification payload (`title` and `body`).
   * @returns Number of sockets the message was sent to.
   */
  emitNewNotification(userId: string, payload: { title: string; body: string }): number {
    const sockets = this.userSockets.get(userId);
    // Stryker disable next-line ConditionalExpression: the `sockets.size === 0`
    // disjunct is defensive — the map entry is supposed to be deleted in
    // handleDisconnect when the set empties, but a race between concurrent
    // disconnects could leave an empty set. Removing the conjunct merely
    // skips the early return for that empty set; the for-of loop below has
    // nothing to iterate so `delivered` stays 0 either way.
    if (!sockets || sockets.size === 0) return 0;

    const message = JSON.stringify({ event: 'notification:new', data: payload });
    let delivered = 0;

    for (const socket of sockets) {
      if (socket.readyState === WS_OPEN) {
        socket.send(message);
        delivered++;
      }
    }

    return delivered;
  }

  /**
   * Forcibly disconnects all sockets associated with `userId`.
   *
   * Called by `UsersService` and `PlatformService` when a user's status is
   * changed to a blocked value (SUSPENDED, BANNED, INACTIVE). The `close`
   * call with code 4403 signals the client that access was revoked rather than
   * a network error.
   *
   * The call is synchronous and non-blocking — `ws.close` enqueues a close
   * frame; no I/O is awaited.
   *
   * The marker is stamped first, before the "nothing to close" early return:
   * having no socket for the user is exactly the case where one is still being
   * authenticated, and that attempt has to be refused when it arrives.
   *
   * @param userId - The user whose connections should be terminated.
   */
  disconnectUser(userId: string): void {
    this.forcedDisconnectAt.set(userId, performance.now());

    const sockets = this.userSockets.get(userId);
    if (!sockets) return;

    for (const socket of sockets) {
      if (socket.readyState === WS_OPEN || socket.readyState === WS_CONNECTING) {
        socket.close(4403, 'Account suspended');
      }
    }

    this.userSockets.delete(userId);
    this.logger.log({ msg: 'ws:user_disconnected', reason: 'status_blocked' });
  }

  /**
   * Called by status-change paths to disconnect a user if their new status is blocked.
   *
   * A thin wrapper over `disconnectUser` that first checks whether the status
   * actually warrants a disconnect, so callers don't need to import `isBlockedStatus`.
   *
   * @param userId - The user whose status changed.
   * @param newStatus - The new status string.
   */
  maybeDisconnectBlockedUser(userId: string, newStatus: string): void {
    if (isBlockedStatus(newStatus)) {
      this.disconnectUser(userId);
    }
  }
}
