# Validation Guidelines

Two complementary validation systems. Pick the right one per boundary.

- **`class-validator`** + **`class-transformer`** — DTOs inside NestJS controllers (`apps/api`).
- **Zod** — env vars, static-config parsing, `apps/web` forms and API route handlers.

- **Packages**: `class-validator` `^0.15`, `class-transformer` `^0.5`, `zod` `^4.3`
- **Official docs**: https://github.com/typestack/class-validator, https://github.com/typestack/class-transformer, https://zod.dev

---

## When to read this

Before accepting any external input — HTTP body/query/param, env var, cookie payload, webhook, deep-link param, cross-service message — or before weakening an existing DTO/Zod schema.

---

## Division of responsibility

| Boundary                                    | Validator                    | Why                                                                                 |
| ------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------- |
| NestJS controllers / WebSocket gateways     | `class-validator` + DTO      | First-class NestJS pipe integration, reflection-based decorators map 1:1 to OpenAPI |
| Env vars in `apps/api`                      | Zod                          | `ConfigModule.forRoot({ validate })` hook, no decorators needed on plain objects    |
| `apps/web` forms                            | Zod + `@hookform/resolvers`  | See [forms-guidelines.md](forms-guidelines.md)                                      |
| `apps/web` route handlers (`route.ts`)      | Zod                          | The library's handlers already validate auth payloads; anything we add uses Zod     |
| Library-supplied DTOs (`RegisterDto`, etc.) | Re-exported from the library | Do not reshape — keeps the frontend's types stable                                  |

Using both in the same layer is almost always a smell.

---

## DTOs (class-validator + class-transformer)

```ts
// apps/api/src/projects/dto/create-project.dto.ts
import { Transform, Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @MinLength(1)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @IsString({ each: true })
  tags: string[] = [];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  priority?: number;
}
```

### Global pipe

Set once in `main.ts`:

```ts
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    stopAtFirstError: false,
  }),
);
```

- `whitelist: true` — strips unknown properties.
- `forbidNonWhitelisted: true` — throws `400` when the client sends extras (mass-assignment guard).
- `forbidUnknownValues: true` — rejects payloads that don't match a class metatype.
- `transform: true` — instantiates the DTO class, runs `class-transformer`. Without it, decorators don't fire.
- `enableImplicitConversion: false` — force explicit `@Type(() => Number)`; implicit conversion silently hides type mistakes.

### DTO rules

1. One DTO per input shape. `UpdateXxxDto` may `extends PartialType(CreateXxxDto)` (`@nestjs/mapped-types`) but do not conflate with the response DTO.
2. Never annotate a DTO with `@Exclude()` to hide fields — a DTO is input. Output shapes live in separate response classes.
3. Every field has a validator; every optional field also has `@IsOptional()`. Missing one = silent pass-through.
4. Nested objects use `@ValidateNested() + @Type(() => Child)`. Without `@Type`, the child class isn't instantiated.
5. Arrays: `@IsArray()` + `@IsString({ each: true })` (or the type-appropriate decorator + `{ each: true }`).
6. Strings that feed SQL `LIKE` or regex: validate length + charset at the DTO, not in the service.

### Error shape

Default error shape from the pipe:

```json
{
  "statusCode": 400,
  "message": ["name must be longer than or equal to 1 characters"],
  "error": "Bad Request"
}
```

Map to the library's `AUTH_ERROR_CODES` pattern for auth routes so the frontend's error handler remains uniform. Do not invent a parallel error shape.

---

## Zod at boundaries

Use for env parsing and non-NestJS entry points. Schemas live next to the code that owns them.

```ts
// apps/api/src/config/env.schema.ts
import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  MFA_ENCRYPTION_KEY: z
    .string()
    .regex(/^[A-Za-z0-9+/=]+$/)
    .refine((v) => Buffer.from(v, 'base64').length === 32, '32-byte base64 required'),
  WEB_ORIGIN: z.string().url(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Env = z.infer<typeof envSchema>;
```

```ts
// apps/api/src/app.module.ts
ConfigModule.forRoot({
  isGlobal: true,
  cache: true,
  validate: (raw) => envSchema.parse(raw),
});
```

- `parse` throws aggregated errors on boot — the app does not start with invalid env.
- Strictness: no `.passthrough()`, no `.catchall(z.unknown())`. Unknown env vars are ignored by Node; don't invite shape drift.
- Prefer `z.coerce.number()` over `Number(env.PORT)` — the schema is the single source.

### Zod rules

1. **One schema per logical input**; don't reuse a form schema for an API handler.
2. **Infer TS types from schemas** — never hand-type the same shape twice. `type X = z.infer<typeof xSchema>`.
3. **`.safeParse` at boundaries**, `.parse` only when a throw is the intended control flow (e.g., env at boot).
4. **No `.any()`, no `.unknown()` without an immediate refinement**. Both are escape hatches that leak raw input further down the stack.
5. **Branded IDs** for cross-layer typing: `z.string().uuid().brand<'UserId'>()`. Forces explicit casting at the API edge.

---

## Cross-cutting rules

- **Errors surface user-facing messages through i18n (frontend) or `AUTH_ERROR_CODES` (backend)**, never the raw Zod/class-validator message. Error messages from validators are for developers.
- **Do not re-validate what the type system already guarantees.** A service method receiving `CreateProjectDto` after the global pipe does not `validate()` again.
- **Refine at the boundary, not 3 layers in.** A controller re-parsing query strings inside a service means the service is coupled to HTTP — move the parsing up to the controller.
- **Type narrowing after validation**: `parsed.data` (Zod) and the DTO instance (class-validator) are already narrowed. Don't cast back to `any` downstream.

---

## Common pitfalls

1. **`@Body() body: any`** — bypasses every DTO rule. Always `@Body() body: SomeDto`.
2. **`transform: false`** on the global pipe — decorators silently no-op for request objects.
3. **Missing `@IsOptional()` on an optional field** — `undefined` fails `@IsString()`. The field becomes secretly required.
4. **Reusing `CreateXxxDto` for `PATCH`** — `@IsString()` rejects the missing field. Use `PartialType(CreateXxxDto)`.
5. **Zod `.object({}).passthrough()` on user input** — extra fields leak to downstream serializers; use `.strict()` or remove the passthrough.
6. **Hand-written TS type next to a Zod schema** — they drift. `z.infer` is the source of truth.
7. **Using Zod inside a NestJS controller** instead of a DTO — works, but forgoes DTO discovery (OpenAPI, Nest's built-in transformer) and mixes validation systems. Use the right tool per boundary.

---

## References

- class-validator: https://github.com/typestack/class-validator
- class-transformer: https://github.com/typestack/class-transformer
- NestJS pipes: https://docs.nestjs.com/pipes
- Zod: https://zod.dev
- `AUTH_ERROR_CODES`: [nest-auth-guidelines.md](nest-auth-guidelines.md)
