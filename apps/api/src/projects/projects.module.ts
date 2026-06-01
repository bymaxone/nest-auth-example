/**
 * @file projects.module.ts
 * @description NestJS module for the toy `Project` demo domain.
 *
 * Imports `PrismaModule` for database access in `ProjectsService`.
 * Library guards and decorators are available globally via `APP_GUARD`
 * providers in `AppModule` — no need to import `AuthModule` here.
 *
 * @layer projects
 */

import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';

/**
 * Self-contained module for project endpoints and business logic.
 *
 * @public
 */
@Module({
  imports: [PrismaModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
