/**
 * @file notifications.controller.ts
 * @description Dev-only controller for pushing test notifications through the
 * `NotificationsGateway`. NEVER registered in production builds.
 *
 * Endpoints:
 *   - `POST /api/debug/notify/self` — any dashboard role; pushes to the caller's
 *     own user ID. Method-level `@Roles('VIEWER')` overrides the class-level
 *     `@Roles('ADMIN')` so all authenticated dashboard users can demo their own
 *     notifications from the Account page.
 *   - `POST /api/debug/notify/:userId` — admin-only; pushes to any user in the
 *     same tenant. Covered by the class-level `@Roles('ADMIN')`.
 *
 * Covers FCM row #24 (WebSocket auth + `WsJwtGuard`) — this controller is the
 * trigger side of the demo loop: a call here → gateway emits to user's sockets →
 * client receives `notification:new` → `sonner` toast appears.
 *
 * @layer notifications
 * @see docs/DEVELOPMENT_PLAN.md §Phase 10 P10-2
 * @see docs/DEVELOPMENT_PLAN.md §Phase 16 P16-3
 */

import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, Roles } from '@bymax-one/nest-auth';
import type { DashboardJwtPayload } from '@bymax-one/nest-auth';

import type { Env } from '../config/env.schema.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsGateway } from './notifications.gateway.js';
import { NotifyDto, NotifySelfDto } from './dto/notify.dto.js';

/** Response shape returned by notification push endpoints. */
interface NotifyResponse {
  /** Number of WebSocket sockets that received the notification. */
  delivered: number;
}

/** Default title used by `POST /api/debug/notify/self` when none is provided. */
const DEFAULT_TITLE = 'Hello';
/** Default body used by `POST /api/debug/notify/self` when none is provided. */
const DEFAULT_BODY = 'This is a test notification.';

/**
 * Dev-only notifications push controller.
 *
 * Registered in `NotificationsModule` only when `NODE_ENV !== 'production'`.
 * Applies belt-and-suspenders protection: every method re-checks `NODE_ENV`
 * even if the module is accidentally wired in a production build.
 *
 * @public
 */
@Controller('debug/notify')
@Roles('ADMIN')
export class NotificationsController {
  constructor(
    private readonly gateway: NotificationsGateway,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Pushes a notification to all open WebSocket sockets owned by the caller.
   *
   * The target user ID is extracted from the verified JWT payload — callers
   * cannot inject another user's ID. Method-level `@Roles('VIEWER')` overrides
   * the class-level `@Roles('ADMIN')` so any authenticated dashboard user can
   * demo their own notifications from the Account page.
   *
   * POST /api/debug/notify/self
   *
   * @param user - JWT payload of the authenticated caller (provides `sub` = userId).
   * @param dto  - Optional notification payload; both fields default when omitted.
   * @returns `{ delivered: number }` — count of sockets that received the message.
   * @throws `ForbiddenException` when called in a production environment.
   */
  @Post('self')
  @Roles('VIEWER')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  notifySelf(@CurrentUser() user: DashboardJwtPayload, @Body() dto: NotifySelfDto): NotifyResponse {
    if (this.config.get('NODE_ENV') === 'production') {
      throw new ForbiddenException('Not available in production');
    }

    const title = dto.title ?? DEFAULT_TITLE;
    const body = dto.body ?? DEFAULT_BODY;
    const delivered = this.gateway.emitNewNotification(user.sub, { title, body });
    return { delivered };
  }

  /**
   * Pushes a notification to all open WebSocket sockets owned by `userId`.
   *
   * Enforces tenant isolation: the target `userId` must belong to the same
   * tenant as the authenticated admin. Cross-tenant pushes are rejected with 404
   * (same pattern as `UsersService.updateStatus`) to prevent cross-tenant
   * enumeration via distinct error codes.
   *
   * POST /api/debug/notify/:userId
   *
   * @param userId - Target user ID from the URL path parameter.
   * @param admin  - JWT payload of the authenticated admin (provides `tenantId`).
   * @param dto    - Validated notification payload (`title` and `body`).
   * @returns `{ delivered: number }` — count of sockets that received the message.
   * @throws `ForbiddenException` when called in a production environment.
   * @throws `NotFoundException` when `userId` is not found in the admin's tenant.
   */
  @Post(':userId')
  @HttpCode(HttpStatus.OK)
  async notify(
    @Param('userId') userId: string,
    @CurrentUser() admin: DashboardJwtPayload,
    @Body() dto: NotifyDto,
  ): Promise<NotifyResponse> {
    if (this.config.get('NODE_ENV') === 'production') {
      throw new ForbiddenException('Not available in production');
    }

    // Tenant isolation: reject the push if the target user does not belong to
    // the admin's tenant. Prevents cross-tenant notification injection.
    const target = await this.prisma.user.findFirst({
      where: { id: userId, tenantId: admin.tenantId },
      select: { id: true },
    });
    if (target === null) {
      throw new NotFoundException(`User '${userId}' not found`);
    }

    const delivered = this.gateway.emitNewNotification(userId, dto);
    return { delivered };
  }
}
