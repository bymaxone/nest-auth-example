/**
 * @file audit.module.ts
 * @description Module bundling the audit log viewer's controller and
 * read-only service. The lib's lifecycle hooks (`AppAuthHooks`) handle
 * the WRITE side of the audit ledger — this module only reads.
 *
 * @layer audit
 */

import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module.js';
import { AuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';

/**
 * Self-contained module for the audit log read-only surface.
 *
 * @public
 */
@Module({
  imports: [PrismaModule],
  controllers: [AuditController],
  providers: [AuditService],
})
export class AuditModule {}
