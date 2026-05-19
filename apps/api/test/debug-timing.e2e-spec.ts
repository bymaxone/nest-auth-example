process.env['NODE_ENV'] = 'test';
process.env['DATABASE_URL'] = 'postgresql://postgres:postgres@localhost:55432/example_app_test';
process.env['REDIS_URL'] = 'redis://127.0.0.1:56379';
process.env['SMTP_HOST'] = 'localhost';
process.env['SMTP_PORT'] = '51025';
process.env['EMAIL_PROVIDER'] = 'mailpit';
process.env['WEB_ORIGIN'] = 'http://localhost:3000';
process.env['API_PORT'] = '4001';
process.env['PASSWORD_RESET_METHOD'] = 'token';
process.env['LOG_LEVEL'] = 'info';
process.env['JWT_SECRET'] =
  'test-only-jwt-secret-must-be-at-least-64-characters-for-schema-validation-ok';
process.env['MFA_ENCRYPTION_KEY'] = 'dGVzdC1lbmNyeXB0aW9uLWtleS0zMmJ5dGVzLW9rPT0=';

// Verify process.env was set BEFORE imports are processed
console.log('[PRE-IMPORT] REDIS_URL =', process.env['REDIS_URL']);

import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import cookieParser from 'cookie-parser';
import * as supertest from 'supertest';
import type { Agent } from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AuthExceptionFilter } from '../src/auth/auth-exception.filter.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Debug env vars', () => {
  let app: INestApplication;
  let agent: Agent;

  beforeAll(async () => {
    console.log('[BEFORE-ALL] process.env.REDIS_URL =', process.env['REDIS_URL']);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    const config = moduleRef.get<ConfigService>(ConfigService);
    console.log('[BEFORE-ALL] ConfigService REDIS_URL =', config.get('REDIS_URL'));
    console.log('[BEFORE-ALL] ConfigService DATABASE_URL =', config.get('DATABASE_URL'));
    console.log('[BEFORE-ALL] ConfigService LOG_LEVEL =', config.get('LOG_LEVEL'));

    const prisma = moduleRef.get<PrismaService>(PrismaService);
    await prisma.$executeRaw`
      INSERT INTO "Tenant" (id, name, slug, "createdAt", "updatedAt")
      VALUES ('acme', 'Acme Corp', 'acme', NOW(), NOW())
      ON CONFLICT (id) DO NOTHING
    `;

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new AuthExceptionFilter());
    app.useWebSocketAdapter(new WsAdapter(app));
    await app.listen(0);

    agent = supertest.agent(app.getHttpServer());
  }, 60000);

  afterAll(async () => {
    await app.close();
  }, 60000);

  it('env vars are correct', () => {
    expect(process.env['REDIS_URL']).toBe('redis://127.0.0.1:56379');
  });

  it('POST /register responds', async () => {
    const email = `debug-${Date.now()}@example.test`;
    const t = Date.now();
    const res = await agent
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .set('X-Tenant-Id', 'acme')
      .send({ email, password: 'P@ssw0rd12345', name: 'Debug User', tenantId: 'acme' });
    console.log(`[DEBUG] /register: ${Date.now() - t}ms, status=${res.status}`);
    expect(res.status).toBeLessThan(500);
  }, 15000);
});
