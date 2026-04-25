/**
 * @file notifications.controller.ts
 * @description Dev-only controller for pushing test notifications through the
 * `NotificationsGateway`. NEVER registered in production builds.
 *
 * The route is gated by `JwtAuthGuard` (global) and `@Roles('ADMIN')` so that
 * only authenticated tenant admins can trigger pushes during demos and e2e tests.
 *
 * Covers FCM row #24 (WebSocket auth + `WsJwtGuard`) — this endpoint is the
 * production trigger for the demo loop: admin calls this endpoint, the gateway
 * emits to all sockets owned by `userId`, the client receives the toast.
 *
 * @layer notifications
 * @see docs/DEVELOPMENT_PLAN.md §Phase 10 P10-2
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
import { CurrentUser, Roles } from '@bymax-one/nest-auth';
import type { DashboardJwtPayload } from '@bymax-one/nest-auth';

import type { Env } from '../config/env.schema.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsGateway } from './notifications.gateway.js';
import { NotifyDto } from './dto/notify.dto.js';

/**
 * Response shape returned by `POST /api/debug/notify/:userId`.
 */
interface NotifyResponse {
  /** Number of WebSocket sockets that received the notification. */
  delivered: number;
}

/**
 * Dev-only notifications push controller.
 *
 * Registered in `NotificationsModule` only when `NODE_ENV !== 'production'`.
 * Applies belt-and-suspenders protection: the constructor guard rejects requests
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
   * @param admin - JWT payload of the authenticated admin (provides `tenantId`).
   * @param dto - Validated notification payload (`title` and `body`).
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
    // Belt-and-suspenders: NotificationsModule already excludes this controller
    // from production, but we guard here too in case of accidental mis-wiring.
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
