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
 * Authentication flow:
 *  1. Client connects, sending `Authorization: Bearer <access_token>` header.
 *  2. `handleConnection` verifies the JWT using `JwtService`, sets `client.data`
 *     and a `handshake` shim so `WsJwtGuard` can run on any future message handler.
 *  3. If invalid, the connection is closed immediately with code 4401.
 *  4. On success, the userId → socket association is stored in an in-memory map.
 *
 * Disconnect-on-suspension:
 *  When a tenant admin or platform admin suspends a user, `disconnectUser(userId)`
 *  is called (via `UsersService` and `PlatformService`). All sockets belonging to
 *  that user are forcibly closed.
 *
 * Covers FCM row #24 (WebSocket auth + `WsJwtGuard`).
 *
 * @layer notifications
 * @see docs/DEVELOPMENT_PLAN.md §Phase 10 P10-1
 * @see docs/guidelines/nest-auth-guidelines.md §Decorators & guards
 */

import type { IncomingMessage } from 'node:http';

import { Inject, Logger, UseGuards } from '@nestjs/common';
import { WebSocketGateway } from '@nestjs/websockets';
import type { OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { BYMAX_AUTH_REDIS_CLIENT, WsJwtGuard } from '@bymax-one/nest-auth';
import type { DashboardJwtPayload } from '@bymax-one/nest-auth';
import type { Redis } from 'ioredis';
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
@WebSocketGateway({ path: '/ws/notifications' })
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(NotificationsGateway.name);

  /**
   * In-memory map from `userId` to the set of currently connected sockets.
   * Entries are removed in `handleDisconnect` once the set becomes empty.
   */
  private readonly userSockets = new Map<string, Set<AuthenticatedSocket>>();

  constructor(
    private readonly jwtService: JwtService,
    @Inject(BYMAX_AUTH_REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Called by the `WsAdapter` when a new WebSocket connection is established.
   *
   * Verifies the JWT from the `Authorization: Bearer <token>` header on the
   * HTTP upgrade request. On failure, closes the socket immediately with
   * code 4401 (unauthorized). On success, registers the socket in the
   * `userSockets` map and sets `client.data.user` + `client.handshake` so that
   * `WsJwtGuard` works correctly on any future `@SubscribeMessage` handler.
   *
   * @param client - The newly connected `ws.WebSocket` instance.
   * @param args - Additional connection arguments; index 0 is the `IncomingMessage`
   *   HTTP upgrade request provided by `@nestjs/platform-ws`.
   */
  async handleConnection(client: AuthenticatedSocket, ...args: unknown[]): Promise<void> {
    const req = args[0] as IncomingMessage | undefined;
    const authHeader =
      typeof req?.headers['authorization'] === 'string' ? req.headers['authorization'] : undefined;

    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

    if (!token) {
      // Close with 4401 (application-level unauthorized) before the connection
      // is fully established in the app's view.
      client.close(4401, 'Unauthorized');
      return;
    }

    let payload: DashboardJwtPayload;
    try {
      payload = this.jwtService.verify<DashboardJwtPayload>(token, {
        algorithms: ['HS256'],
      });
    } catch {
      client.close(4401, 'Unauthorized');
      return;
    }

    // Reject platform and MFA-challenge tokens — this gateway is for dashboard users only.
    if (typeof payload.type !== 'string' || payload.type !== 'dashboard') {
      client.close(4401, 'Unauthorized');
      return;
    }

    // Reject tokens that have been explicitly revoked (e.g. after logout or
    // account suspension). Mirrors the rv:{jti} check in JwtAuthGuard/WsJwtGuard
    // which NestJS guards cannot perform at connection time.
    const revoked = await this.redis.get(`rv:${payload.jti}`);
    if (revoked !== null) {
      client.close(4401, 'Unauthorized');
      return;
    }

    // Populate `data` and `handshake` shim before any guard invocation.
    client.data = { user: payload, userId: payload.sub };
    client.handshake = { headers: { authorization: authHeader } };

    const userId = payload.sub;

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
   * @param userId - The user whose connections should be terminated.
   */
  disconnectUser(userId: string): void {
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
