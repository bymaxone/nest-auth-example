/**
 * @file realtime.module.ts
 * @description Binds {@link USER_CONNECTION_PORT} to the notifications gateway.
 *
 * This module is the seam that keeps `users/` and `platform/` from importing
 * `notifications/`: they import this shared module and inject the port, while
 * the choice of implementation lives here alone.
 *
 * @layer realtime
 */

import { Module } from '@nestjs/common';

import { NotificationsModule } from '../notifications/notifications.module.js';
import { NotificationsGateway } from '../notifications/notifications.gateway.js';
import { USER_CONNECTION_PORT } from './user-connection.port.js';

/**
 * Shared module exposing the user-connection port.
 *
 * @public
 */
@Module({
  imports: [NotificationsModule],
  providers: [{ provide: USER_CONNECTION_PORT, useExisting: NotificationsGateway }],
  exports: [USER_CONNECTION_PORT],
})
export class RealtimeModule {}
