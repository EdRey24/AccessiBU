# Supabase Edge Functions (Deno)

These functions run in the Supabase **Deno** Edge runtime — NOT the Expo/TS app
bundle. They are intentionally excluded from the app's `tsc`/`oxlint` gates
(`tsconfig.json` `exclude` + `.oxlintignore`) because they use Deno-only globals
(`Deno.env`) and `npm:`/relative Deno import specifiers the app toolchain does
not resolve. They are type-checked and linted by the Deno/Supabase toolchain
instead.

## Layout

```
supabase/functions/
  _shared/            reusable glue (imported by RELATIVE path; no cross-fn deps)
    services.ts       loadEnv + build the domain services from Deno env
    validate.ts       parse+validate a JSON body against a DTO zod schema
  submit-report/      index.ts + deno.json
  get-hazards/        index.ts + deno.json
  request-route/      index.ts + deno.json
  .env.example        local secrets template (.env itself is gitignored)
```

Each function is a thin handler that:

1. validates its request DTO with a zod schema from `@/server/http/dto-schemas`,
2. builds the gateways/services from env (`@/server/*`, the shared source of
   truth — no service logic is reimplemented here),
3. delegates to the appropriate service, and
4. returns the shared `Result<T>` envelope as JSON via
   `@/server/http/result-response` (200 ok; 400/401/404/429/503/500 by error
   code).

The `@/...` specifiers resolve through each function's `deno.json` import map
(`"@/": "../../../src/"`), so the Deno functions reuse the app's shared
types/services unchanged.

### Module resolution note

The app modules import each other **extensionless** (`@/types`,
`@/server/...`). The Supabase Edge Runtime ships a TypeScript-aware resolver
that resolves these extensionless specifiers through the import map, the same
way the Expo/Metro bundler does for the app. The `_shared/*` helpers, which are
imported by relative path rather than through the alias, use explicit `.ts`
extensions as Deno requires. Validate locally with
`supabase functions serve <name>` (needs Docker); a bare `deno check` outside
the Supabase runtime will not apply this resolver.

## Request contract

Per current Supabase docs, each `index.ts` exports a default object with an
async `fetch(req): Response` handler (Web `Request`/`Response`).

## Secrets (verified against current Supabase docs)

- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected into Edge Functions
  by the platform.
- `GEMINI_API_KEY` is a **custom server-only secret** (its name must not start
  with `SUPABASE_`). Set it locally in `supabase/functions/.env` (gitignored) or
  in production with:

  ```sh
  supabase secrets set --env-file supabase/functions/.env
  ```

  It is read only inside the Edge runtime and never bundled into the Expo client.

## Deploy

```sh
supabase functions deploy submit-report get-hazards request-route
```
