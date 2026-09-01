/**
 * @file notifications.gateway.spec.ts
 * @description Unit tests for `NotificationsGateway`.
 *
 * Exercises all public methods and the connection-time auth logic:
 *   - `handleConnection`: ws-ticket redeem (success / refused / blocked status) /
 *     Bearer header / cookie fallback / no token / invalid JWT /
 *     wrong token type / revoked token (AuthRevocationService hit) / success
 *   - `handleDisconnect`: socket removed; empty set → map entry deleted
 *   - `emitNewNotification`: no sockets / OPEN socket / non-OPEN socket
 *   - `disconnectUser`: sockets closed 4403; map entry deleted
 *   - `maybeDisconnectBlockedUser`: blocked status → disconnectUser; other → no call
 *
 * All dependencies (JwtService, WsTicketService, AuthRevocationService) are
 * plain jest mocks — no NestJS module.
 *
 * @layer test
 * @see apps/api/src/notifications/notifications.gateway.ts
 */

import { jest } from '@jest/globals';
import { AuthException, AUTH_ERROR_CODES } from '@bymax-one/nest-auth';
import type { DashboardJwtPayload, WsTicketSnapshot } from '@bymax-one/nest-auth';
import { NotificationsGateway } from './notifications.gateway.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal DashboardJwtPayload used in successful connection tests. */
const VALID_PAYLOAD: DashboardJwtPayload = {
  sub: 'user-001',
  tenantId: 'tenant-001',
  role: 'MEMBER',
  type: 'dashboard',
  status: 'ACTIVE',
  mfaEnabled: false,
  mfaVerified: false,
  iat: 0,
  exp: 9999999999,
  jti: 'jti-valid-001',
};

/**
 * Builds a mock `JwtService` stub.
 *
 * @param verifyResult - Value returned by `verify` (throw an Error to simulate failure).
 */
function makeJwtService(verifyResult: DashboardJwtPayload | Error = VALID_PAYLOAD) {
  return {
    verify: jest.fn<(token: string) => DashboardJwtPayload>().mockImplementation(() => {
      if (verifyResult instanceof Error) throw verifyResult;
      return verifyResult;
    }),
  };
}

/** Snapshot returned by the mocked `WsTicketService.redeem` on success. */
const VALID_SNAPSHOT: WsTicketSnapshot = {
  sub: 'user-001',
  tenantId: 'tenant-001',
  role: 'MEMBER',
  status: 'ACTIVE',
  mfaEnabled: false,
  mfaVerified: false,
};

/**
 * Builds a mock `WsTicketService` stub.
 *
 * @param redeemResult - Snapshot resolved by `redeem`, or an Error to simulate
 *   an invalid/replayed ticket (the library throws `AuthException`).
 */
function makeTicketService(redeemResult: WsTicketSnapshot | Error = VALID_SNAPSHOT) {
  return {
    redeem: jest.fn<(ticket: string) => Promise<WsTicketSnapshot>>().mockImplementation(() => {
      if (redeemResult instanceof Error) return Promise.reject(redeemResult);
      return Promise.resolve(redeemResult);
    }),
  };
}

/**
 * Builds a mock `AuthRevocationService` stub.
 *
 * @param revoked - Whether `isAccessTokenRevoked` reports the token as revoked.
 */
function makeRevocationService(revoked = false) {
  return {
    isAccessTokenRevoked: jest.fn<() => Promise<boolean>>().mockResolvedValue(revoked),
  };
}

/**
 * Builds a mock `AuthenticatedSocket`-shaped object.
 *
 * @param readyState - WebSocket readyState (1 = OPEN, 0 = CONNECTING, 3 = CLOSED).
 */
function makeSocket(readyState = 1) {
  return {
    readyState,
    close: jest.fn<(code: number, reason: string) => void>(),
    send: jest.fn<(data: string) => void>(),
    data: {} as { user?: DashboardJwtPayload; userId?: string },
    handshake: { headers: {} as Record<string, string | undefined> },
  };
}

/**
 * Builds a minimal IncomingMessage-shaped request with the given headers.
 *
 * @param headers - HTTP upgrade request headers.
 */
function makeRequest(headers: Record<string, string>) {
  return { headers };
}

/**
 * Creates a `NotificationsGateway` with fresh mocks.
 *
 * @param jwtResult - Return value / thrown Error for `JwtService.verify`.
 * @param revoked - Whether the mocked `AuthRevocationService` reports revocation.
 * @param redeemResult - Snapshot / Error for the mocked `WsTicketService.redeem`.
 */
function makeGateway(
  jwtResult: DashboardJwtPayload | Error = VALID_PAYLOAD,
  revoked = false,
  redeemResult: WsTicketSnapshot | Error = VALID_SNAPSHOT,
) {
  const jwtService = makeJwtService(jwtResult);
  const wsTickets = makeTicketService(redeemResult);
  const revocation = makeRevocationService(revoked);

  // We bypass the DI container and construct directly with the mocks.
  const gateway = new NotificationsGateway(
    jwtService as never,
    wsTickets as never,
    revocation as never,
  );

  return { gateway, jwtService, wsTickets, revocation };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('NotificationsGateway', () => {
  // ── handleConnection ───────────────────────────────────────────────────────

  describe('handleConnection', () => {
    it('authenticates via Authorization Bearer header and stores socket in userSockets', async () => {
      // FCM #24 — A valid Bearer token must result in client.data being populated
      // and the socket being added to the in-memory map for delivery.
      const { gateway } = makeGateway();
      const client = makeSocket();
      const req = makeRequest({ authorization: 'Bearer valid-token' });

      await gateway.handleConnection(client as never, req);

      expect(client.data.user).toEqual(VALID_PAYLOAD);
      expect(client.data.userId).toBe('user-001');
      expect(client.close).not.toHaveBeenCalled();
    });

    it('extracts token from access_token cookie when no Authorization header is present', async () => {
      // Browser WebSocket connections cannot send custom headers — the cookie
      // fallback is the only mechanism for same-origin browser clients.
      const { gateway } = makeGateway();
      const client = makeSocket();
      const req = makeRequest({ cookie: 'access_token=cookie-token; other=val' });

      await gateway.handleConnection(client as never, req);

      expect(client.data.userId).toBe('user-001');
      expect(client.close).not.toHaveBeenCalled();
    });

    it('closes with 4401 when no token is present in headers or cookies', async () => {
      // No token → unauthorized. The gateway must close before the connection is
      // considered established at the application level.
      const { gateway } = makeGateway();
      const client = makeSocket();
      const req = makeRequest({});

      await gateway.handleConnection(client as never, req);

      expect(client.close).toHaveBeenCalledWith(4401, 'Unauthorized');
    });

    it('closes with 4401 when JwtService.verify throws (invalid or expired token)', async () => {
      // Expired, malformed, or wrong-secret tokens must be rejected — the gateway
      // must close the connection rather than setting partial state.
      const { gateway } = makeGateway(new Error('invalid signature'));
      const client = makeSocket();
      const req = makeRequest({ authorization: 'Bearer bad-token' });

      await gateway.handleConnection(client as never, req);

      expect(client.close).toHaveBeenCalledWith(4401, 'Unauthorized');
      expect(client.data.userId).toBeUndefined();
    });

    it('closes with 4401 when payload.type is not "dashboard"', async () => {
      // Platform tokens or MFA-challenge tokens must not be accepted on the
      // dashboard WebSocket gateway — only type=dashboard is allowed.
      // Cast through unknown: 'platform' is not assignable to 'dashboard' by type but
      // we need to simulate a foreign token type reaching the gateway to test the guard.
      const platformPayload = {
        ...VALID_PAYLOAD,
        type: 'platform',
      } as unknown as DashboardJwtPayload;
      const { gateway } = makeGateway(platformPayload);
      const client = makeSocket();
      const req = makeRequest({ authorization: 'Bearer platform-token' });

      await gateway.handleConnection(client as never, req);

      expect(client.close).toHaveBeenCalledWith(4401, 'Unauthorized');
    });

    it('closes with 4401 when AuthRevocationService reports the token revoked', async () => {
      // Tokens that have been explicitly revoked (logout, "sign out everywhere",
      // suspension) must be rejected even if the JWT signature is valid. The
      // library's AuthRevocationService covers both the JTI blacklist and the
      // per-user token epoch — the gateway must consult it, never raw Redis keys.
      const { gateway, revocation } = makeGateway(VALID_PAYLOAD, true);
      const client = makeSocket();
      const req = makeRequest({ authorization: 'Bearer revoked-token' });

      await gateway.handleConnection(client as never, req);

      expect(revocation.isAccessTokenRevoked).toHaveBeenCalledWith(VALID_PAYLOAD);
      expect(client.close).toHaveBeenCalledWith(4401, 'Unauthorized');
    });

    it('treats an empty ?ticket= as no ticket at all', async () => {
      /*
       * Scenario: `?ticket=` present but empty. Redeeming an empty string
       * would spend a Redis round-trip on a value that can never match, and
       * worse, a redeem implementation that treated '' as a wildcard would
       * admit the socket. `extractTicket` reports undefined so the JWT path
       * takes over and refuses.
       * Protects: the `ticket.length > 0` half of the ternary — the branch a
       * `!== null` check alone would miss.
       */
      const { gateway, wsTickets } = makeGateway();
      const client = makeSocket();
      const req = { headers: {}, url: '/ws/notifications?ticket=' };

      await gateway.handleConnection(client as never, req);

      expect(wsTickets.redeem).not.toHaveBeenCalled();
      expect(client.close).toHaveBeenCalledWith(4401, 'Unauthorized');
    });

    it('falls through to the JWT path when the upgrade URL cannot be parsed', async () => {
      /*
       * Scenario: a malformed upgrade URL makes the `URL` constructor throw.
       * `extractTicket` must answer "no ticket" rather than propagating —
       * an exception here would escape handleConnection and leave the socket
       * neither authenticated nor closed, i.e. hung open and unauthenticated.
       * Protects: the catch arm of extractTicket, and the fall-through to the
       * JWT path that then rejects the connection with 4401.
       */
      const { gateway, wsTickets } = makeGateway();
      const client = makeSocket();
      const req = { headers: {}, url: 'http://[' };

      await expect(gateway.handleConnection(client as never, req)).resolves.toBeUndefined();

      expect(wsTickets.redeem).not.toHaveBeenCalled();
      expect(client.close).toHaveBeenCalledWith(4401, 'Unauthorized');
    });

    it('authenticates via a single-use ws-ticket in the upgrade URL query', async () => {
      // FCM: WS upgrade tickets (lib v1.1.0+) — the browser path. The ticket is
      // redeemed atomically and the socket is registered under the snapshot's sub.
      const { gateway, wsTickets, jwtService } = makeGateway();
      const client = makeSocket();
      const req = {
        headers: { cookie: 'access_token=live-token' },
        url: '/ws/notifications?ticket=tkt-123',
      };

      await gateway.handleConnection(client as never, req);

      expect(wsTickets.redeem).toHaveBeenCalledWith('tkt-123');
      // The cookie's token is verified — a ticket carries no `jti` or epoch, so
      // it cannot be checked for revocation on its own — but identity still
      // comes from the redeemed snapshot, not from that token.
      expect(jwtService.verify).toHaveBeenCalled();
      expect(client.data.user).toBeUndefined();
      expect(client.data.userId).toBe('user-001');
      expect(client.close).not.toHaveBeenCalled();
      // A push notification must reach the ticket-authenticated socket.
      expect(gateway.emitNewNotification('user-001', { title: 't', body: 'b' })).toBe(1);
    });

    it('closes with 4401 when the ws-ticket is invalid or already redeemed', async () => {
      // A replayed or expired ticket is refused by WsTicketService with an
      // AuthException — the gateway must close 4401, not crash.
      const { gateway } = makeGateway(
        VALID_PAYLOAD,
        false,
        new AuthException(AUTH_ERROR_CODES.TOKEN_INVALID),
      );
      const client = makeSocket();
      const req = { headers: {}, url: '/ws/notifications?ticket=replayed' };

      await gateway.handleConnection(client as never, req);

      expect(client.close).toHaveBeenCalledWith(4401, 'Unauthorized');
    });

    it('closes with 4403 when the ticket snapshot carries a blocked status', async () => {
      // The snapshot's status is the repository's CURRENT state (unlike the JWT
      // status claim) — a suspended account must be refused at the door.
      const { gateway } = makeGateway(VALID_PAYLOAD, false, {
        ...VALID_SNAPSHOT,
        status: 'SUSPENDED',
      });
      const client = makeSocket();
      const req = { headers: {}, url: '/ws/notifications?ticket=tkt-456' };

      await gateway.handleConnection(client as never, req);

      expect(client.close).toHaveBeenCalledWith(4403, 'Account suspended');
    });

    it('sets client.handshake.headers.authorization from the Authorization header when present', async () => {
      // WsJwtGuard reads client.handshake.headers.authorization for future
      // @SubscribeMessage handlers — this shim must be populated at connect time.
      const { gateway } = makeGateway();
      const client = makeSocket();
      const req = makeRequest({ authorization: 'Bearer valid-token' });

      await gateway.handleConnection(client as never, req);

      expect(client.handshake.headers.authorization).toBe('Bearer valid-token');
    });

    it('synthesises client.handshake.headers.authorization as "Bearer <token>" when only cookie is used', async () => {
      // When the token comes from a cookie, the handshake shim must still have a
      // Bearer value so WsJwtGuard can authenticate future message handlers.
      const { gateway } = makeGateway();
      const client = makeSocket();
      const req = makeRequest({ cookie: 'access_token=cookie-token' });

      await gateway.handleConnection(client as never, req);

      expect(client.handshake.headers.authorization).toMatch(/^Bearer /);
    });

    it('creates a new Set in userSockets when userId is seen for the first time', async () => {
      // The first connection for a userId must create a new Set entry; subsequent
      // connections add to the same Set.
      const { gateway } = makeGateway();
      const client1 = makeSocket();
      const client2 = makeSocket();
      const req = makeRequest({ authorization: 'Bearer valid-token' });

      await gateway.handleConnection(client1 as never, req);
      await gateway.handleConnection(client2 as never, req);

      // Both sockets are registered — emitNewNotification would deliver to both.
      const delivered = gateway.emitNewNotification('user-001', {
        title: 'T',
        body: 'B',
      });
      expect(delivered).toBe(2);
    });
  });

  // ── handleDisconnect ───────────────────────────────────────────────────────

  describe('handleDisconnect', () => {
    it('removes the socket from userSockets on disconnect', async () => {
      // After disconnect the socket must no longer receive notifications.
      const { gateway } = makeGateway();
      const client = makeSocket();
      const req = makeRequest({ authorization: 'Bearer valid-token' });

      await gateway.handleConnection(client as never, req);
      gateway.handleDisconnect(client as never);

      const delivered = gateway.emitNewNotification('user-001', { title: 'T', body: 'B' });
      expect(delivered).toBe(0);
    });

    it('deletes the userId map entry when the last socket disconnects', async () => {
      /*
       * Memory leak prevention: the userId map entry must be REMOVED
       * (the key deleted, not just the inner set emptied) when no
       * sockets remain, so the map does not grow unbounded across
       * users who connect and disconnect over the process lifetime.
       * Inspecting the internal map directly is the only way to
       * distinguish "entry removed" from "entry with empty set".
       */
      const { gateway } = makeGateway();
      const client = makeSocket();
      const req = makeRequest({ authorization: 'Bearer valid-token' });

      await gateway.handleConnection(client as never, req);
      gateway.handleDisconnect(client as never);

      // The internal map MUST no longer carry a key for the user.
      const internalMap = (gateway as unknown as { userSockets: Map<string, Set<unknown>> })
        .userSockets;
      expect(internalMap.has('user-001')).toBe(false);

      // Emitting to a userId with no map entry returns 0 (not an error).
      expect(gateway.emitNewNotification('user-001', { title: 'T', body: 'B' })).toBe(0);
    });

    it('handles disconnect for a client with no userId (unauthenticated socket) gracefully', () => {
      // A socket that was closed before authentication completes has no data.userId.
      // handleDisconnect must not throw in this scenario.
      const { gateway } = makeGateway();
      const client = makeSocket();
      // data.userId is deliberately not set

      expect(() => gateway.handleDisconnect(client as never)).not.toThrow();
    });

    it('does nothing when the userId is set but has no entry in userSockets (stale socket path)', () => {
      // Covers the `if (sockets)` false branch — the map may not have an entry for
      // a given userId if handleConnection was never completed or the map was
      // already cleared. handleDisconnect must not throw.
      const { gateway } = makeGateway();
      const client = makeSocket();
      client.data.userId = 'ghost-user'; // userId present but no map entry

      expect(() => gateway.handleDisconnect(client as never)).not.toThrow();
      expect(gateway.emitNewNotification('ghost-user', { title: 'T', body: 'B' })).toBe(0);
    });

    it('preserves the map entry when other sockets for the user remain after disconnect', async () => {
      // Covers the `if (sockets.size === 0)` false branch — when a user has two
      // open connections and one disconnects, the remaining connection must stay active.
      const { gateway } = makeGateway();
      const client1 = makeSocket();
      const client2 = makeSocket();
      const req = makeRequest({ authorization: 'Bearer valid-token' });

      await gateway.handleConnection(client1 as never, req);
      await gateway.handleConnection(client2 as never, req);

      gateway.handleDisconnect(client1 as never);

      // client2 is still registered — user-001 remains deliverable.
      expect(gateway.emitNewNotification('user-001', { title: 'T', body: 'B' })).toBe(1);
    });
  });

  // ── emitNewNotification ────────────────────────────────────────────────────

  describe('emitNewNotification', () => {
    it('returns 0 when userId has no registered sockets', () => {
      // No socket map entry → no delivery. The caller should handle delivered=0
      // as a normal case (user not connected).
      const { gateway } = makeGateway();

      const delivered = gateway.emitNewNotification('unknown-user', { title: 'T', body: 'B' });

      expect(delivered).toBe(0);
    });

    it('sends the notification to OPEN sockets and returns the correct delivered count', async () => {
      // The message must be valid JSON containing the notification:new event name
      // and the full payload so the client-side handler can parse it.
      const { gateway } = makeGateway();
      const client = makeSocket(1); // OPEN
      const req = makeRequest({ authorization: 'Bearer valid-token' });
      await gateway.handleConnection(client as never, req);

      const delivered = gateway.emitNewNotification('user-001', {
        title: 'Hello',
        body: 'World',
      });

      expect(delivered).toBe(1);
      expect(client.send).toHaveBeenCalledTimes(1);
      const sentMsg = JSON.parse(client.send.mock.calls[0]?.[0] as string) as {
        event: string;
        data: { title: string; body: string };
      };
      expect(sentMsg.event).toBe('notification:new');
      expect(sentMsg.data.title).toBe('Hello');
      expect(sentMsg.data.body).toBe('World');
    });

    it('skips sockets that are not in OPEN state', async () => {
      // A socket in CONNECTING (0) or CLOSED (3) state must not receive send() —
      // calling send on a non-open socket throws in the ws library.
      const { gateway } = makeGateway();
      const closedClient = makeSocket(3); // CLOSED
      // Manually insert the socket into the gateway's map by connecting first as
      // OPEN then simulating a state change.
      const openClient = makeSocket(1);
      const req = makeRequest({ authorization: 'Bearer valid-token' });
      await gateway.handleConnection(openClient as never, req);

      // Replace the socket entry with the closed socket without going through
      // handleConnection (which would reject a non-open socket after setup).
      // Access the private map via bracket notation to set up the scenario.
      (
        gateway as unknown as { userSockets: Map<string, Set<ReturnType<typeof makeSocket>>> }
      ).userSockets.set('user-001', new Set([closedClient]));

      const delivered = gateway.emitNewNotification('user-001', { title: 'T', body: 'B' });

      expect(delivered).toBe(0);
      expect(closedClient.send).not.toHaveBeenCalled();
    });
  });

  // ── disconnectUser ─────────────────────────────────────────────────────────

  describe('disconnectUser', () => {
    it('closes all OPEN sockets for the userId with code 4403', async () => {
      // Account suspension path: all active connections must be terminated with
      // 4403 so the client knows access was revoked (not a network error).
      const { gateway } = makeGateway();
      const client = makeSocket(1);
      const req = makeRequest({ authorization: 'Bearer valid-token' });
      await gateway.handleConnection(client as never, req);

      gateway.disconnectUser('user-001');

      expect(client.close).toHaveBeenCalledWith(4403, 'Account suspended');
    });

    it('closes CONNECTING (readyState=0) sockets with code 4403', () => {
      // Sockets in the CONNECTING state are also terminated to prevent them from
      // completing the handshake and receiving data after suspension.
      const { gateway } = makeGateway();
      // Insert a CONNECTING socket directly into the map.
      const connectingClient = makeSocket(0);
      (
        gateway as unknown as { userSockets: Map<string, Set<ReturnType<typeof makeSocket>>> }
      ).userSockets.set('user-001', new Set([connectingClient]));

      gateway.disconnectUser('user-001');

      expect(connectingClient.close).toHaveBeenCalledWith(4403, 'Account suspended');
    });

    it('deletes the userId map entry after disconnecting all sockets', async () => {
      // The map entry must be removed so subsequent emitNewNotification calls
      // immediately return 0 rather than iterating over stale closed sockets.
      const { gateway } = makeGateway();
      const client = makeSocket(1);
      const req = makeRequest({ authorization: 'Bearer valid-token' });
      await gateway.handleConnection(client as never, req);

      gateway.disconnectUser('user-001');

      expect(gateway.emitNewNotification('user-001', { title: 'T', body: 'B' })).toBe(0);
    });

    it('does nothing when userId has no registered sockets', () => {
      // Calling disconnectUser for a user who has no connections must not throw.
      const { gateway } = makeGateway();

      expect(() => gateway.disconnectUser('unknown-user')).not.toThrow();
    });

    it('skips sockets that are neither OPEN (1) nor CONNECTING (0) when disconnecting', () => {
      // Covers the `if (socket.readyState === WS_OPEN || WS_CONNECTING)` false branch.
      // A socket in CLOSED (2) state must be skipped — calling close on it is a no-op
      // or can throw in some environments.
      const { gateway } = makeGateway();
      const closedClient = makeSocket(2); // readyState 2 = CLOSED
      (
        gateway as unknown as { userSockets: Map<string, Set<ReturnType<typeof makeSocket>>> }
      ).userSockets.set('user-001', new Set([closedClient]));

      gateway.disconnectUser('user-001');

      expect(closedClient.close).not.toHaveBeenCalled();
    });
  });

  // ── maybeDisconnectBlockedUser ─────────────────────────────────────────────

  describe('maybeDisconnectBlockedUser', () => {
    it('calls disconnectUser when the new status is BANNED', () => {
      // BANNED is a blocked status — all connections must be terminated immediately.
      const { gateway } = makeGateway();
      const disconnectSpy = jest.spyOn(gateway, 'disconnectUser');

      gateway.maybeDisconnectBlockedUser('user-001', 'BANNED');

      expect(disconnectSpy).toHaveBeenCalledWith('user-001');
    });

    it('calls disconnectUser when the new status is SUSPENDED', () => {
      // SUSPENDED is also a blocked status — same enforcement applies.
      const { gateway } = makeGateway();
      const disconnectSpy = jest.spyOn(gateway, 'disconnectUser');

      gateway.maybeDisconnectBlockedUser('user-001', 'SUSPENDED');

      expect(disconnectSpy).toHaveBeenCalledWith('user-001');
    });

    it('calls disconnectUser when the new status is INACTIVE', () => {
      // INACTIVE is the third blocked status — the gateway must also disconnect here.
      const { gateway } = makeGateway();
      const disconnectSpy = jest.spyOn(gateway, 'disconnectUser');

      gateway.maybeDisconnectBlockedUser('user-001', 'INACTIVE');

      expect(disconnectSpy).toHaveBeenCalledWith('user-001');
    });

    it('does not call disconnectUser when the new status is ACTIVE', () => {
      // Non-blocked statuses must not trigger a disconnect — the user's sessions
      // remain valid when transitioning from a blocked status back to ACTIVE.
      const { gateway } = makeGateway();
      const disconnectSpy = jest.spyOn(gateway, 'disconnectUser');

      gateway.maybeDisconnectBlockedUser('user-001', 'ACTIVE');

      expect(disconnectSpy).not.toHaveBeenCalled();
    });

    it('does not call disconnectUser for an unrecognised status string', () => {
      // Future statuses that are not in the blocked set must not trigger a disconnect
      // to avoid breaking changes when the enum is extended.
      const { gateway } = makeGateway();
      const disconnectSpy = jest.spyOn(gateway, 'disconnectUser');

      gateway.maybeDisconnectBlockedUser('user-001', 'UNKNOWN_FUTURE_STATUS');

      expect(disconnectSpy).not.toHaveBeenCalled();
    });
  });

  // ─── Wire-shape and observability pinning ─────────────────────────────────

  describe('wire shape and observability', () => {
    it('verifies the JWT with the HS256 algorithm only', async () => {
      /*
       * Scenario: a JWT signed with an unexpected algorithm (e.g. `none`
       * or `RS256` from a misconfigured upstream) must never be accepted
       * by the WebSocket connection path. Pinning the verify options
       * preserves the "HS256-only" contract this gateway relies on; a
       * widened algorithm list would be a real downgrade in the
       * security posture.
       */
      const { gateway, jwtService } = makeGateway();
      const client = makeSocket();
      const req = makeRequest({ authorization: 'Bearer good-token' });

      await gateway.handleConnection(client as never, req);

      expect(jwtService.verify).toHaveBeenCalledTimes(1);
      const call = jwtService.verify.mock.calls[0] as unknown as [string, { algorithms: string[] }];
      expect(call?.[0]).toBe('good-token');
      expect(call?.[1]).toEqual({ algorithms: ['HS256'] });
    });

    it('rejects a JWT whose `type` is not "dashboard"', async () => {
      /*
       * Scenario: a platform-admin or MFA-temp token is delivered to
       * the dashboard WebSocket gateway. Even though the signature
       * verifies, the token is for a different audience and must be
       * rejected at connection time — otherwise a platform admin's
       * token could be used to receive dashboard-level notifications.
       */
      const platformPayload = { ...VALID_PAYLOAD, type: 'platform' as const };
      const { gateway } = makeGateway(platformPayload as never);
      const client = makeSocket();
      const req = makeRequest({ authorization: 'Bearer token' });

      await gateway.handleConnection(client as never, req);

      expect(client.close).toHaveBeenCalledWith(4401, 'Unauthorized');
    });

    it('reads the access_token cookie from the upgrade Cookie header (browser path)', async () => {
      /*
       * Scenario: a browser opens the dashboard WebSocket through the
       * Next.js same-origin proxy. The browser cannot set custom
       * Authorization headers on a WS upgrade, so the gateway must
       * fall back to the HttpOnly `access_token` cookie. The cookie
       * regex extracts the token value between `access_token=` and
       * either the next `;` or the end of the header.
       */
      const { gateway, jwtService } = makeGateway();
      const client = makeSocket();
      const req = makeRequest({
        cookie: 'other=foo; access_token=cookie-token-value; another=bar',
      });

      await gateway.handleConnection(client as never, req);

      expect(jwtService.verify).toHaveBeenCalledTimes(1);
      const call = jwtService.verify.mock.calls[0] as unknown as [string, unknown];
      expect(call?.[0]).toBe('cookie-token-value');
    });

    it('rejects a Cookie header that has no access_token entry', async () => {
      /*
       * Scenario: the upgrade request carries cookies but the
       * `access_token` is absent (the user already signed out or the
       * cookie was scoped elsewhere). The gateway must NOT pull a
       * random cookie value as a token candidate — the regex must
       * specifically match `access_token=`. Without an exact match
       * the connection is closed with 4401.
       */
      const { gateway } = makeGateway();
      const client = makeSocket();
      const req = makeRequest({ cookie: 'csrf=abc; theme=dark' });

      await gateway.handleConnection(client as never, req);

      expect(client.close).toHaveBeenCalledWith(4401, 'Unauthorized');
    });

    it('reads only the substring up to the next semicolon when access_token is followed by other cookies', async () => {
      /*
       * Scenario: the cookie header has more than one entry after
       * `access_token=`. The token value MUST stop at the next `;`
       * — picking up the rest of the header would invalidate the
       * JWT signature and lock every browser-initiated WS connection
       * out of notifications.
       */
      const { gateway, jwtService } = makeGateway();
      const client = makeSocket();
      const req = makeRequest({ cookie: 'access_token=just-this-part; csrf=other' });

      await gateway.handleConnection(client as never, req);

      const call = jwtService.verify.mock.calls[0] as unknown as [string, unknown];
      expect(call?.[0]).toBe('just-this-part');
    });

    it('strips exactly the "Bearer " prefix when extracting the token from the Authorization header', async () => {
      /*
       * Scenario: a non-browser client (CLI, mobile app) sends
       * `Authorization: Bearer <token>`. The gateway must remove the
       * 7-character "Bearer " prefix exactly. A different prefix
       * length would pass garbage characters through to `jwt.verify`
       * and the connection would close on every API consumer.
       */
      const { gateway, jwtService } = makeGateway();
      const client = makeSocket();
      const req = makeRequest({ authorization: 'Bearer just-the-token' });

      await gateway.handleConnection(client as never, req);

      const call = jwtService.verify.mock.calls[0] as unknown as [string, unknown];
      expect(call?.[0]).toBe('just-the-token');
    });

    it('logs a connect event with the userId and current socket count', async () => {
      /*
       * Scenario: every accepted connection must surface in operator
       * logs with the userId and the current count of connected
       * sockets for that user. The log entry feeds dashboards that
       * detect runaway reconnect loops; pinning the payload keeps
       * the observability contract stable.
       */
      const { gateway } = makeGateway();
      const logSpy = jest
        .spyOn((gateway as unknown as { logger: { log: (m: unknown) => void } }).logger, 'log')
        .mockImplementation(() => undefined);
      const client = makeSocket();
      const req = makeRequest({ authorization: 'Bearer token' });

      await gateway.handleConnection(client as never, req);

      expect(logSpy).toHaveBeenCalledTimes(1);
      const arg = logSpy.mock.calls[0]?.[0] as {
        msg?: string;
        userId?: string;
        socketCount?: number;
      };
      expect(arg.msg).toBe('ws:connect');
      expect(arg.userId).toBe('user-001');
      expect(arg.socketCount).toBe(1);
    });

    it('logs a disconnect event with the userId on handleDisconnect', async () => {
      /*
       * Scenario: every clean disconnect must also surface in logs
       * with the userId, so dashboards can match connect/disconnect
       * pairs and detect orphaned sessions. The payload must keep
       * the documented `msg` shape.
       */
      const { gateway } = makeGateway();
      const client = makeSocket();
      const req = makeRequest({ authorization: 'Bearer token' });
      await gateway.handleConnection(client as never, req);
      const logSpy = jest
        .spyOn((gateway as unknown as { logger: { log: (m: unknown) => void } }).logger, 'log')
        .mockImplementation(() => undefined);

      gateway.handleDisconnect(client as never);

      expect(logSpy).toHaveBeenCalledTimes(1);
      const arg = logSpy.mock.calls[0]?.[0] as { msg?: string; userId?: string };
      expect(arg.msg).toBe('ws:disconnect');
      expect(arg.userId).toBe('user-001');
    });

    it('disconnectUser logs a user_disconnected event with the documented reason', async () => {
      /*
       * Scenario: when a user is suspended, every open socket for
       * them is closed forcibly. The log entry must surface BOTH
       * the canonical event name (`ws:user_disconnected`) and the
       * `reason: status_blocked` discriminator so support can
       * distinguish suspensions from voluntary disconnects.
       */
      const { gateway } = makeGateway();
      const client = makeSocket();
      const req = makeRequest({ authorization: 'Bearer token' });
      await gateway.handleConnection(client as never, req);
      const logSpy = jest
        .spyOn((gateway as unknown as { logger: { log: (m: unknown) => void } }).logger, 'log')
        .mockImplementation(() => undefined);

      gateway.disconnectUser('user-001');

      // The forced-disconnect path emits exactly one log entry.
      expect(logSpy).toHaveBeenCalledTimes(1);
      const arg = logSpy.mock.calls[0]?.[0] as { msg?: string; reason?: string };
      expect(arg.msg).toBe('ws:user_disconnected');
      expect(arg.reason).toBe('status_blocked');
    });

    it('emitNewNotification returns 0 when the user has no entry in the socket map', () => {
      /*
       * Scenario: a notification is fired for a user who has no
       * active WebSocket sessions (e.g. they signed out on every
       * device). The method must return 0 without attempting to
       * iterate, so callers can decide whether to fall back to
       * email or push delivery.
       */
      const { gateway } = makeGateway();

      const delivered = gateway.emitNewNotification('ghost-user', {
        title: 't',
        body: 'b',
      });

      expect(delivered).toBe(0);
    });

    it('handleDisconnect leaves the userSockets entry alive when the user has other open sockets', async () => {
      /*
       * Scenario: a user is connected on two tabs and closes one.
       * The set of sockets for that user must shrink to one entry
       * but the map key must remain so the surviving tab continues
       * to receive notifications. Only when the set drops to zero
       * does the map entry get deleted (covered separately by the
       * "removes the userId entry when no sockets remain" test).
       */
      const { gateway } = makeGateway();
      const clientA = makeSocket();
      const clientB = makeSocket();
      const reqA = makeRequest({ authorization: 'Bearer t' });
      const reqB = makeRequest({ authorization: 'Bearer t' });
      await gateway.handleConnection(clientA as never, reqA);
      await gateway.handleConnection(clientB as never, reqB);

      gateway.handleDisconnect(clientA as never);

      // Single remaining socket still receives a follow-up notification.
      const delivered = gateway.emitNewNotification('user-001', {
        title: 't',
        body: 'b',
      });
      expect(delivered).toBe(1);
    });
  });

  // ── Ticket corroborated by the access-token cookie ─────────────────────────

  describe('ticket path — credential required alongside the ticket', () => {
    it('refuses a ticket when the upgrade also carries a revoked access token', async () => {
      /*
       * Scenario: a device minted a ticket, then the user signed out
       * everywhere (or changed their password) before the socket opened. The
       * ticket is still redeemable for its TTL and its snapshot carries no
       * `jti` or epoch to check, so the redemption alone cannot tell. The
       * browser sends its cookies on this same-origin upgrade, and the access
       * token in them does carry the session — revoked, in this case.
       * Protects: the corroboration check on the ticket path, without which a
       * ticket minted before a revocation opens a socket nothing revalidates.
       */
      const { gateway } = makeGateway(VALID_PAYLOAD, true);
      const client = makeSocket();
      const req = {
        headers: { cookie: 'access_token=revoked-token' },
        url: '/ws/notifications?ticket=tkt-stale',
      };

      await gateway.handleConnection(client as never, req);

      expect(client.close).toHaveBeenCalledWith(4401, 'Unauthorized');
      expect(gateway.emitNewNotification('user-001', { title: 't', body: 'b' })).toBe(0);
    });

    it('refuses a ticket when a Bearer header carries the revoked token instead of a cookie', async () => {
      /*
       * Scenario: a non-browser client that holds both a ticket and its access
       * token, presenting the token in the header the way the JWT path expects.
       * The corroboration reads the credential from the same two places that
       * path does, so the header must count exactly as the cookie does.
       * Protects: the Authorization-header arm of the token extraction — a
       * cookie-only reading would silently skip the check for these clients.
       */
      const { gateway } = makeGateway(VALID_PAYLOAD, true);
      const client = makeSocket();
      const req = {
        headers: { authorization: 'Bearer revoked-token' },
        url: '/ws/notifications?ticket=tkt-bearer',
      };

      await gateway.handleConnection(client as never, req);

      expect(client.close).toHaveBeenCalledWith(4401, 'Unauthorized');
      expect(gateway.emitNewNotification('user-001', { title: 't', body: 'b' })).toBe(0);
    });

    it('admits a ticket when the cookie is present and not revoked', async () => {
      /*
       * Scenario: the ordinary browser reconnect. The cookie corroborates the
       * ticket rather than contradicting it.
       * Protects: the check refusing only on an actual revocation — inverting
       * it would break every normal ticket connection.
       */
      const { gateway } = makeGateway();
      const client = makeSocket();
      const req = {
        headers: { cookie: 'access_token=live-token' },
        url: '/ws/notifications?ticket=tkt-fresh',
      };

      await gateway.handleConnection(client as never, req);

      expect(client.close).not.toHaveBeenCalled();
      expect(gateway.emitNewNotification('user-001', { title: 't', body: 'b' })).toBe(1);
    });

    it('refuses a ticket that arrives with no credential at all', async () => {
      /*
       * Scenario: the ticket is presented alone. Since the snapshot carries no
       * `jti` and no epoch, a ticket minted just before a revocation is
       * indistinguishable from one minted just after it — so admitting on the
       * ticket alone would make the revocation check optional for anyone who
       * simply omits their cookie. Browsers cannot: the WS URL is same-origin
       * so the cookies ride along, and a client that can set headers does not
       * need a ticket in the first place.
       * Protects: the `!token` refusal — treating absence as "nothing to say"
       * is precisely the bypass.
       */
      const { gateway } = makeGateway();
      const client = makeSocket();
      const req = { headers: {}, url: '/ws/notifications?ticket=tkt-bare' };

      await gateway.handleConnection(client as never, req);

      expect(client.close).toHaveBeenCalledWith(4401, 'Unauthorized');
      expect(gateway.emitNewNotification('user-001', { title: 't', body: 'b' })).toBe(0);
    });

    it('refuses a ticket whose credential does not verify', async () => {
      /*
       * Scenario: the token is expired, forged, or minted for another plane.
       * It cannot be checked against the revocation channels, so it is not a
       * credential for this purpose. Minting a ticket is an authenticated call
       * that refreshes the token first, so a live client is never in this
       * state for the 30 s the ticket lasts.
       * Protects: the `!payload` refusal — accepting an unverifiable token
       * would let anyone bypass the check by sending a junk one.
       */
      const { gateway } = makeGateway(new Error('jwt expired'));
      const client = makeSocket();
      const req = {
        headers: { cookie: 'access_token=expired-token' },
        url: '/ws/notifications?ticket=tkt-expired-cookie',
      };

      await gateway.handleConnection(client as never, req);

      expect(client.close).toHaveBeenCalledWith(4401, 'Unauthorized');
      expect(gateway.emitNewNotification('user-001', { title: 't', body: 'b' })).toBe(0);
    });
  });

  // ── Admission racing a forced disconnect ───────────────────────────────────

  describe('admission racing a forced disconnect', () => {
    it('refuses a ticket connection when the user is disconnected while the ticket is being redeemed', async () => {
      /*
       * Scenario: a device is redeeming its upgrade ticket at the moment
       * "sign out everywhere" (or a suspension) fires. `disconnectUser` walks
       * `userSockets` and finds nothing for this user — the socket is not
       * registered until the redemption resolves — so the close reaches every
       * device except the one still in the handshake. Registering it a moment
       * later would hand the revoked session a socket that is never
       * re-authenticated and therefore streams until the browser closes it.
       * Protects: the admission check against the forced-disconnect marker on
       * the ticket path, and the marker being stamped even when the disconnect
       * had no socket to close.
       */
      const { gateway, wsTickets } = makeGateway();
      let releaseRedeem: (snapshot: WsTicketSnapshot) => void = () => undefined;
      wsTickets.redeem.mockImplementation(
        () =>
          new Promise<WsTicketSnapshot>((resolve) => {
            releaseRedeem = resolve;
          }),
      );
      const client = makeSocket();
      const req = {
        headers: { cookie: 'access_token=live-token' },
        url: '/ws/notifications?ticket=tkt-race',
      };

      const connecting = gateway.handleConnection(client as never, req);
      // The revocation lands mid-handshake, with nothing yet to close.
      gateway.disconnectUser('user-001');
      releaseRedeem(VALID_SNAPSHOT);
      await connecting;

      expect(client.close).toHaveBeenCalledWith(4403, 'Account suspended');
      // Never registered: a notification has nowhere to go.
      expect(gateway.emitNewNotification('user-001', { title: 't', body: 'b' })).toBe(0);
    });

    it('refuses a Bearer connection when the user is disconnected while the revocation lookup is in flight', async () => {
      /*
       * Scenario: same race on the JWT path. The token was checked against the
       * revocation store before the disconnect committed, so the lookup answers
       * "not revoked" and the socket would otherwise be admitted just after the
       * disconnect swept the user's other connections.
       * Protects: the admission check on the JWT path — the branch a
       * ticket-only test would leave uncovered.
       */
      const { gateway, revocation } = makeGateway();
      let releaseCheck: (revoked: boolean) => void = () => undefined;
      revocation.isAccessTokenRevoked.mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            releaseCheck = resolve;
          }),
      );
      const client = makeSocket();
      const req = makeRequest({ authorization: 'Bearer valid-token' });

      const connecting = gateway.handleConnection(client as never, req);
      gateway.disconnectUser('user-001');
      releaseCheck(false);
      await connecting;

      expect(client.close).toHaveBeenCalledWith(4403, 'Account suspended');
      expect(gateway.emitNewNotification('user-001', { title: 't', body: 'b' })).toBe(0);
    });

    it('admits a connection that starts after the disconnect has already happened', async () => {
      /*
       * Scenario: the user signs out everywhere and then signs back in, or the
       * initiating tab reconnects right after the change-password disconnect —
       * the ordinary case the guard must not break. The marker is older than
       * the attempt, so it says nothing about this connection.
       * Protects: the timestamp comparison. A guard that refused on the mere
       * existence of a marker would lock the user out of realtime for the rest
       * of the process's life.
       */
      const { gateway } = makeGateway();
      gateway.disconnectUser('user-001');

      const client = makeSocket();
      const req = makeRequest({ authorization: 'Bearer valid-token' });
      await gateway.handleConnection(client as never, req);

      expect(client.close).not.toHaveBeenCalled();
      expect(gateway.emitNewNotification('user-001', { title: 't', body: 'b' })).toBe(1);
    });

    it('does not refuse a connection because a different user was disconnected', async () => {
      /*
       * Scenario: two users are active; one is suspended while the other is
       * mid-handshake. The marker is per-user, so the bystander must connect
       * normally.
       * Protects: the per-user key on the marker lookup — a global flag would
       * refuse every concurrent connection in the process.
       */
      const { gateway, revocation } = makeGateway();
      let releaseCheck: (revoked: boolean) => void = () => undefined;
      revocation.isAccessTokenRevoked.mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            releaseCheck = resolve;
          }),
      );
      const client = makeSocket();
      const req = makeRequest({ authorization: 'Bearer valid-token' });

      const connecting = gateway.handleConnection(client as never, req);
      gateway.disconnectUser('someone-else');
      releaseCheck(false);
      await connecting;

      expect(client.close).not.toHaveBeenCalled();
      expect(gateway.emitNewNotification('user-001', { title: 't', body: 'b' })).toBe(1);
    });
  });
});
