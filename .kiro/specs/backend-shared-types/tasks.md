# Implementation Plan: backend-shared-types

## Overview

This plan delivers the AccessiBU backend/API tier and the shared TypeScript type contract across **two commits, each shipped as its own pull request into `main` from a single feature branch** (never pushed directly to `main`).

- **Commit 1 — Shared Type Contract** (`src/types/`, importable via `@/types`): seven files authored in strict dependency order (`geo → hazard → ai → routing → database → api → index`) plus a minimal test harness. This PR lands **first** so the frontend/UI and AI/DB teammates can review the contract before any implementation depends on it.
- **Commit 2 — Backend Skeleton** (follow-up PR): Supabase Edge Functions (Deno) built around the contract — typed/zod-validated env config, typed Supabase + Gemini client wrappers, domain services, and the three Edge Functions.

The design uses concrete TypeScript, so all tasks implement against the design's low-level code as written. Every Expo/Supabase/Gemini-touching task in commit 2 begins by verifying the API against current docs (per `AGENTS.md`) and ends by running `npx oxlint --deny-warnings` + `npx tsc --noEmit`. Dependencies are installed only via `npx expo install`.

The commit-1/commit-2 boundary is explicit below: do **not** start commit-2 tasks until the commit-1 PR has been opened.

## Tasks

### Commit 1 — Shared Type Contract (lands first as PR into `main`)

- [x] 1. Create feature branch and author geographic primitives (`src/types/geo.ts`)
  - Create the feature branch `feat/backend-shared-types` off `main` and check it out (never work on `main` directly)
  - Author `src/types/geo.ts` with `Coordinates { readonly latitude; readonly longitude }` (latitude declared first)
  - Add branded `BuildingId` and `FloorId` (`string & { readonly __brand }`), structurally distinct from `string` and each other
  - Add app-friendly `BuildingFootprint` (buildingId, name, floors, outline in app-friendly order, centroid)
  - Add the GeoJSON boundary layer: `GeoJsonPosition` as `readonly [longitude, latitude]`, `GeoJsonPoint` (`type: 'Point'`), `GeoJsonPolygon` (`type: 'Polygon'`) with a doc comment that each linear ring is closed (first position equals last)
  - Keep the file pure types with no runtime value; verify with `npx tsc --noEmit`
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 2. Author the hazard domain model (`src/types/hazard.ts`)
  - [x] 2.1 Define centralized `as const` arrays and derived unions
    - Add `HAZARD_CATEGORIES`, `HAZARD_SEVERITY_LABELS` (`low`, `moderate`, `high`, `critical` in order), and `REPORT_STATUSES` (`submitted`, `ai_classified`, `community_confirmed`, `resolved`, `dismissed`) as the single source of truth
    - Derive `KnownHazardCategory`, `HazardSeverityLabel`, and `ReportStatus` from those arrays via `(typeof ...)[number]`
    - Define the discriminated `HazardCategory` (`kind` field) with the `'other'` escape hatch requiring a non-optional `otherDescription` and forbidding `otherDescription` on known categories; define branded `HazardSeverityScore` and the `Hazard` entity importing from `./geo`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

  - [ ]* 2.2 Write type-level assertion that `'other'` requires `otherDescription`
    - **Property 4: Escape hatch integrity**
    - **Validates: Requirements 2.2, 2.3, 2.4**
    - Add a `@ts-expect-error` assertion that a `kind: 'other'` value missing `otherDescription` fails to type-check

- [x] 3. Install zod and author the AI classification contract (`src/types/ai.ts`)
  - [x] 3.1 Install zod via `npx expo install zod`
    - Use `npx expo install zod` (NOT `npm`/`yarn`/`pnpm`/`bun add`) so the resolved version satisfies the Expo SDK 58 compatible range
    - If `npx expo install` reports a version incompatibility, halt and surface the error rather than editing `package.json` dependency entries by hand
    - _Requirements: 8.2, 8.3_

  - [x] 3.2 Author `src/types/ai.ts` with the request/result types and single zod schema
    - Define `HazardClassificationRequest` carrying only `imageUrl` (signed URL / storage path) plus optional `reporterHints` and `location`; expose no raw-bytes field
    - Define `HazardClassificationResult` (category, severityLabel, severityScore, confidence, rationale, isUncertain)
    - Define `hazardClassificationResultSchema` reusing the `hazard.ts` const arrays via `z.enum`, and add the compile-time non-drift guard asserting the inferred type is assignable to `HazardClassificationResult`
    - Import from `./geo` and `./hazard` only; verify with `npx tsc --noEmit`
    - _Requirements: 3.1, 3.2, 3.3, 3.6_

  - [ ]* 3.3 Write type-level assertion for schema/contract non-drift
    - **Property 3: Schema/contract non-drift**
    - **Validates: Requirements 3.6**
    - Mirror the `ai.ts` guard as a test-only assertion that `HazardClassificationResultParsed` is assignable to `HazardClassificationResult`

- [x] 4. Author the accessible routing contract (`src/types/routing.ts`)
  - Define `NODE_KINDS`/`RouteNodeKind`, `TRAVERSAL_MODES`/`TraversalMode`, `NodeAccessibility`, `RouteGraphNode`, and `RouteEdge` (`from`/`to` sharing the node-id type, numeric cost, traversal mode)
  - Define `AvoidancePolicy` (`severityThreshold` label, numeric `radiusMeters`, `mode: 'soft_penalty' | 'hard_block'`), `RouteConstraints`, and `RouteRequest` with a non-optional `avoidance`
  - Define the `RouteResponse` union discriminated by `status`: `route_found` (ordered `path`, `totalCost`, `bypassedNodes`) and `no_accessible_route` (`bypassedNodes` only, no path/totalCost)
  - Exclude the A*/Dijkstra algorithm (commit-2 scope); import from `./geo` and `./hazard` only; verify with `npx tsc --noEmit`
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [x] 5. Author the Supabase row types (`src/types/database.ts`)
  - Add a coordination header comment noting these hand-written rows are the source of truth until `supabase gen types` stabilizes
  - Define `HazardRow`, `ReportRow`, `RouteNodeRow`, `BuildingRow`, `ConfirmationRow`, and `VoteRow` with snake_case keys, `timestamptz` columns typed as `string`, and nullable columns typed `| null` exactly as the DB returns them
  - Define each `Insert` variant omitting `id`, `created_at`, `updated_at`, and every other generated column (equal to the full row when no generated columns exist), and each `Update` variant as a `Partial` of the Insert with no extra fields
  - Verify with `npx tsc --noEmit`
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

- [x] 6. Author the API and transport contract (`src/types/api.ts`)
  - Define `APP_ERROR_CODES` (exactly the seven codes) and `AppError` (`code`, `message`, optional `details`)
  - Define `Result<T, E = AppError>` discriminated on `ok` (success carries `data` and no `error`; failure carries `error` and no `data`)
  - Define transport-neutral DTOs for `submit-report`, `get-hazards`, and `request-route` (request + response each), with no HTTP/framework field, type, or import
  - Add the `ok()` and `err()` constructors returning the corresponding discriminated members; import from `./geo`, `./hazard`, `./ai`, `./routing`
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [ ]* 6.1 Write type-level assertion for `Result` exhaustiveness/narrowing
    - **Property 6: Result exhaustiveness**
    - **Validates: Requirements 6.1, 6.2**
    - Assert that branching on `ok` narrows to `data` on `true` and `error` on `false`, rejecting access to the other member

- [x] 7. Author the curated barrel and run contract gates (`src/types/index.ts`)
  - Re-export every public type via `export type` and every public runtime value (zod schema, const arrays, `ok`/`err`) via value exports, resolving each identifier to a single declaration
  - Do not export any internal compile-time guard (e.g. `_schemaMatchesContract`)
  - Confirm the import graph follows `geo → hazard → ai → routing → database → api → index` with zero cycles, and that `@/types` resolves to `src/types/index.ts`
  - Run `npx tsc --noEmit` and `npx oxlint --deny-warnings`; both MUST exit zero with no errors
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 8.1_

  - [ ]* 7.1 Write type-level assertion for barrel curation
    - **Property 10: Barrel curation**
    - **Validates: Requirements 7.3**
    - Assert no internal guard identifier is importable from `@/types`

- [x] 8. Set up the test harness, then commit, push, and open the commit-1 PR
  - [x] 8.1 Set up the ecosystem-standard test runner via `npx expo install`
    - Install the Expo SDK 58 standard runner (e.g. `jest-expo`/Jest, or Vitest if the repo already leans that way) using `npx expo install` for any added dev dependency
    - _Requirements: 9.1_

  - [x] 8.2 Add type-level assertions and zod schema unit tests
    - Type-level: schema non-drift, `Result` narrowing, `'other'` requires `otherDescription`, and `Insert` variants reject generated columns (`@ts-expect-error` on `id`/`created_at`)
    - **Property 9: Insert/Update omit generated columns** — **Validates: Requirements 5.4**
    - Runtime zod tests: well-formed object parses `success: true`; `category: 'volcano'` fails; `severityScore` of `150` and `-1` fail; `confidence: 1.5` fails; empty `rationale` fails
    - _Requirements: 9.2, 9.3, 9.4, 9.5_

  - [ ]* 8.3 Write property test for severity and confidence bounds
    - **Property 5: Severity and confidence bounds**
    - **Validates: Requirements 3.4, 3.5**
    - Assert `hazardClassificationResultSchema.safeParse` succeeds iff all fields are in range (category, severityLabel, 0–100 score, 0–1 confidence, non-empty rationale, boolean isUncertain)

  - [x] 8.4 Run gates, commit, push the feature branch, and open the commit-1 PR
    - Run `npx oxlint --deny-warnings` and `npx tsc --noEmit`; block the PR and surface errors if either is non-zero
    - Commit all of `src/types/` plus the test harness; push the feature branch with `git push -u` (never to `main`; reject/surface any direct-to-`main` push)
    - Open the commit-1 type-contract PR into `main`; do NOT open the commit-2 PR until this PR is opened
    - _Requirements: 8.4, 8.5, 8.7, 8.8, 8.9, 8.10_

- [x] 9. Checkpoint — commit-1 contract complete
  - Ensure all tests pass and both gates are clean, ask the user if questions arise. Do not begin commit-2 tasks until the commit-1 PR has been opened.

### Commit 2 — Backend Skeleton (follow-up PR, Supabase Edge Functions / Deno)

- [x] 10. Implement typed, zod-validated env config (commit-2 / follow-up)
  - VERIFY FIRST: confirm Supabase Edge Function environment/secret access against current Supabase docs before coding
  - Author `config/env.ts` with `loadEnv(raw)` parsing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `GEMINI_API_KEY` via zod, failing fast on missing/malformed values
  - Keep `GEMINI_API_KEY` server-only; ensure it is never bundled into the Expo client (read only in Edge Function env)
  - End by running `npx oxlint --deny-warnings` and `npx tsc --noEmit`
  - _Requirements: 8.6, 8.7_

- [x] 11. Implement the Supabase and Gemini client wrappers (commit-2 / follow-up)
  - [x] 11.1 Implement the typed Supabase client wrapper (`clients/supabase.ts`)
    - VERIFY FIRST: confirm the Supabase JS client + Edge Function usage against current Supabase docs
    - Implement `SupabaseGateway` (insertReport, insertHazard, hazardsInRadius, createSignedUrl) typed against the `database.ts` rows, returning `Result`
    - End by running `npx oxlint --deny-warnings` and `npx tsc --noEmit`
    - _Requirements: 8.7_

  - [x] 11.2 Implement the Gemini client wrapper (`clients/gemini.ts`)
    - VERIFY FIRST: confirm the GenAI JS/TS SDK's zod-response-schema usage against current docs (ai.google.dev)
    - Implement `GeminiGateway.classifyHazard` sending the signed URL + prompt, passing `hazardClassificationResultSchema` as the response schema, `safeParse`-ing the result, and mapping failures to `AppError{ code: 'ai_unavailable' | 'internal_error' }`; never handle raw image bytes
    - End by running `npx oxlint --deny-warnings` and `npx tsc --noEmit`
    - _Requirements: 3.1, 8.6, 8.7_

- [x] 12. Implement the domain services (commit-2 / follow-up)
  - [x] 12.1 Implement `hazardService` and `aiService`
    - VERIFY FIRST: confirm any Supabase/GenAI calls against current docs
    - Implement submit-report orchestration (persist report → classify → persist classification) and get-hazards queries; `aiService` owns prompt construction and the `isUncertain` policy
    - End by running `npx oxlint --deny-warnings` and `npx tsc --noEmit`
    - _Requirements: 8.7_

  - [x] 12.2 Implement `routingService` (A*/Dijkstra honoring `AvoidancePolicy`)
    - Build the graph from `RouteNodeRow`/edges; implement `soft_penalty` (reweight) and `hard_block` (prune edges within radius at/above threshold); return the discriminated `RouteResponse`
    - End by running `npx oxlint --deny-warnings` and `npx tsc --noEmit`
    - _Requirements: 4.2, 4.4, 4.5_

  - [ ]* 12.3 Write unit tests for routing avoidance and hazard lifecycle
    - Test `soft_penalty` vs `hard_block` outcomes and `no_accessible_route`; test hazard lifecycle status transitions
    - _Requirements: 4.4, 2.7_

- [x] 13. Wire the three Supabase Edge Functions (commit-2 / follow-up)
  - VERIFY FIRST: confirm Edge Function structure/deploy and secret handling against current Supabase docs before coding
  - Implement `submit-report`, `get-hazards`, and `request-route`, each validating its DTO with zod, delegating to a service, and returning a `Result` envelope; keep the Gemini key in Supabase secrets
  - End by running `npx oxlint --deny-warnings` + `npx tsc --noEmit`, then commit, push the feature branch, and open the commit-2 follow-up PR into `main`
  - _Requirements: 6.5, 8.6, 8.7, 8.8, 8.9_

- [x] 14. Final checkpoint — backend skeleton complete
  - Ensure all tests pass and both gates are clean, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP; core implementation tasks are never optional.
- The commit-1 / commit-2 boundary is explicit: the type contract (Tasks 1–8) is committed, pushed, and PR'd into `main` for teammate review **before** any commit-2 skeleton task (Tasks 10–13) begins.
- Each task references the specific requirement clauses it satisfies for traceability.
- Property tests validate the design's Correctness Properties; type-level assertions are compile-time checks via `npx tsc --noEmit`.
- Dependencies are installed only via `npx expo install`; `npx oxlint --deny-warnings` + `npx tsc --noEmit` gate task completion. Commit-2 API-touching tasks verify against current docs before coding.
- Pushes always target the feature branch, never `main`.
- Commits are broken into small, single-purpose logical pieces so each is easy to review in isolation (e.g. dependency install separate from the code that uses it; one component/service per commit). Commits are pushed incrementally to the feature branch and roll up into the single commit-2 PR.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2", "3.1"] },
    { "id": 3, "tasks": ["3.2", "4"] },
    { "id": 4, "tasks": ["3.3", "5"] },
    { "id": 5, "tasks": ["6"] },
    { "id": 6, "tasks": ["6.1", "7"] },
    { "id": 7, "tasks": ["7.1", "8.1"] },
    { "id": 8, "tasks": ["8.2"] },
    { "id": 9, "tasks": ["8.3", "8.4"] },
    { "id": 10, "tasks": ["10"] },
    { "id": 11, "tasks": ["11.1", "11.2"] },
    { "id": 12, "tasks": ["12.1", "12.2"] },
    { "id": 13, "tasks": ["12.3", "13"] }
  ]
}
```
