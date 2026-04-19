# NestJS Guidelines

Server-side framework for `apps/api`.

- **Package**: `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`
- **Version**: `^11.1.x`
- **HTTP adapter**: Express 5 (required by `@bymax-one/nest-auth`)
- **Runtime**: Node.js `>=24`, ES modules (`"type": "module"`)
- **Official docs**: https://docs.nestjs.com

---

## When to read this

Before creating or modifying anything under `apps/api/src/`: modules, controllers, services, guards, pipes, interceptors, exception filters, decorators, `main.ts`, or `app.module.ts`.

---

## Module boundaries

NestJS composes features as `@Module` classes. Keep them small and purpose-built.

```ts
// apps/api/src/projects/projects.module.ts
import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';

@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
```

**Rules**:

- One module per domain folder (`tenants/`, `projects/`, `platform/`, `notifications/`).
- Infrastructure modules (`prisma/`, `redis/`, `config/`, `health/`) live at `apps/api/src/` top level.
- `AppModule` imports other modules — it never contains business logic.
- `exports` only what siblings actually need. Do not export a `*Service` "just in case".
- ESM: all relative imports use the explicit `.js` extension (`./projects.service.js`) even when the source is `.ts` — Node 24 ESM requires it.

---

## Dependency injection

Use constructor injection with `readonly` properties. Never instantiate with `new`.

```ts
@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: Logger,
  ) {}
}
```

- Prefer class tokens; string/symbol tokens only when an interface is injected (e.g., `IEmailProvider`).
- For injected interfaces, define a const token in a sibling `tokens.ts`:
  ```ts
  export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
  ```
  then `@Inject(EMAIL_PROVIDER) private readonly email: IEmailProvider`.
- Avoid `forwardRef` — a circular dependency means one of the two modules needs to be split.

---

## Controllers are thin

Controllers map HTTP → service call → response. They never perform business logic, never touch Prisma/Redis directly.

```ts
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @Roles('owner', 'admin', 'member')
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.projects.listForTenant(user.tenantId);
  }

  @Post()
  @Roles('owner', 'admin')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateProjectDto) {
    return this.projects.create(user.tenantId, user.id, dto);
  }
}
```

- Return plain objects or promises — Nest handles serialization.
- Never `res.send()` or `res.json()` unless streaming; rely on the default Express/Nest pipeline.
- Decorate with `@Roles`, `@Public`, `@SkipMfa`, `@CurrentUser` from `@bymax-one/nest-auth` — do not redefine them locally.

---

## DTO validation

Every request body/param/query goes through a DTO validated by `class-validator` + `class-transformer`. See [validation-guidelines.md](validation-guidelines.md) for the full ruleset.

```ts
import { IsEmail, IsString, MinLength } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEmail()
  ownerEmail!: string;
}
```

Enable the global validation pipe in `main.ts`:

```ts
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
  }),
);
```

- `whitelist: true` strips unknown props.
- `forbidNonWhitelisted: true` throws 400 on unknown props — prevents mass-assignment.
- Never `transform: false` — DTOs arrive as plain objects otherwise and decorators from `class-validator` silently pass.

---

## Guards, interceptors, pipes, filters

Layered request pipeline — know which one to reach for.

| Concern                        | Use                 | Example                                                    |
| ------------------------------ | ------------------- | ---------------------------------------------------------- |
| AuthN / AuthZ / route metadata | `CanActivate` guard | `JwtAuthGuard`, `RolesGuard`, `MfaRequiredGuard` (library) |
| Transforming/validating input  | `PipeTransform`     | `ValidationPipe`, `ParseUUIDPipe`                          |
| Wrapping response / logging    | `NestInterceptor`   | `LoggingInterceptor`, `CacheInterceptor`                   |
| Uniform error response         | `ExceptionFilter`   | `HttpExceptionFilter`, `PrismaExceptionFilter`             |

**Do not** duplicate the library's guards. Register `JwtAuthGuard` and `RolesGuard` globally via `APP_GUARD` — the library documents the ordering.

```ts
// apps/api/src/app.module.ts
providers: [
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
  { provide: APP_GUARD, useClass: UserStatusGuard },
  { provide: APP_GUARD, useClass: MfaRequiredGuard },
],
```

Order matters: JWT → status → MFA → roles. Any change must be an ADR.

---

## Configuration

`@nestjs/config` is the only way to read `process.env`. Every value is validated with Zod at startup — boot aborts on failure. See [environment-guidelines.md](environment-guidelines.md).

```ts
ConfigModule.forRoot({
  isGlobal: true,
  validate: (raw) => envSchema.parse(raw), // Zod schema
  cache: true,
  expandVariables: false,
});
```

Inject `ConfigService<Env, true>` (strict mode). `process.env` direct reads only inside the startup bootstrap.

---

## main.ts bootstrap

Every app gets the same hardening. Keep this block in sync across any fork.

```ts
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger)); // nestjs-pino

  app.enableShutdownHooks();
  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: config.getOrThrow<string>('WEB_ORIGIN'),
    credentials: true,
  });

  const port = config.getOrThrow<number>('PORT');
  await app.listen(port);
}

bootstrap().catch((err) => {
  console.error(err); // bootstrap crash only — normal logs go through pino
  process.exit(1);
});
```

- `enableShutdownHooks` — runs `OnApplicationShutdown` (Prisma disconnect, Redis quit).
- `credentials: true` — required for cookie-mode JWT.
- `bufferLogs: true` + `app.useLogger` — hands control to `nestjs-pino` before the first request.

---

## Async providers

Use `useFactory` when a provider needs config at construction time (Redis, Prisma client with custom logging).

```ts
{
  provide: RedisService,
  useFactory: (config: ConfigService<Env, true>) => {
    return new RedisService(config.getOrThrow('REDIS_URL'));
  },
  inject: [ConfigService],
}
```

Mark them `Injectable()` when possible — factories are only for genuinely external state.

---

## Exception handling

Throw the nearest matching built-in: `BadRequestException`, `UnauthorizedException`, `ForbiddenException`, `NotFoundException`, `ConflictException`, `UnprocessableEntityException`. The library throws from `@bymax-one/nest-auth` — do **not** wrap or re-throw those; let them bubble.

Custom errors only when you need a unique HTTP status or error code:

```ts
throw new HttpException(
  { code: 'TENANT_OVER_QUOTA', message: 'Project limit reached' },
  HttpStatus.PAYMENT_REQUIRED,
);
```

Use `AUTH_ERROR_CODES` from the library for auth-domain failures so the frontend's error map keeps working.

---

## Testing

- Unit: `@nestjs/testing` `Test.createTestingModule`, mock providers with `.overrideProvider(X).useValue(fake)`.
- E2E: `supertest` against a real Nest instance + real Postgres/Redis (`docker-compose.test.yml` or testcontainers). See [testing-guidelines.md](testing-guidelines.md).

```ts
const moduleRef = await Test.createTestingModule({
  imports: [ProjectsModule],
})
  .overrideProvider(PrismaService)
  .useValue(prismaStub)
  .compile();
```

---

## Common pitfalls

1. **Returning ORM entities directly** — they include timestamps, internal flags, sometimes hashes. Return a mapped DTO or use `ClassSerializerInterceptor` with `@Exclude` on sensitive fields.
2. **Missing `await app.close()`** in e2e teardown — leaks Prisma + Redis connections, test suite hangs.
3. **`throw new Error()`** inside a handler — becomes a 500 with no code. Use a Nest HTTP exception.
4. **Manual `@Inject('SOMETHING')` with string tokens** — typo-prone. Export a `Symbol` or a `const` token from a `tokens.ts`.
5. **Business logic in a guard** — guards answer yes/no for route access; side effects belong in services.
6. **Forgetting `cookie-parser`** — cookie-mode JWT silently fails; `req.cookies` is `undefined`.
7. **Enabling `transform: true` without DTOs** — `@Body() body: any` combined with transform silently loses everything.

---

## References

- NestJS docs: https://docs.nestjs.com
- Fundamentals → Dependency injection: https://docs.nestjs.com/fundamentals/dependency-injection
- Techniques → Configuration: https://docs.nestjs.com/techniques/configuration
- Security → Authentication: https://docs.nestjs.com/security/authentication
- `@bymax-one/nest-auth`: [nest-auth-guidelines.md](nest-auth-guidelines.md)
