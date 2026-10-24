# Requirements Document

## Introduction

AccessiBU is a crowdsourced campus hazard-reporting and accessible-navigation app for Boston University, built on a shared Expo SDK 58 repository under strict TypeScript. This feature, **backend-shared-types**, delivers the backend/API tier and the shared TypeScript type contract that three teams (backend/API, frontend/UI, AI/DB) depend on to build in parallel without integration drift.

These requirements are derived from the approved `design.md` (design-first workflow). The work ships in two commits delivered as two separate pull requests into `main` from a feature branch:

- **Commit 1 — Shared Type Contract**: seven files under `src/types/` (`geo.ts`, `hazard.ts`, `ai.ts`, `routing.ts`, `database.ts`, `api.ts`, `index.ts`), importable via `@/types`, plus a minimal test harness. This PR lands first for teammate review of the contract.
- **Commit 2 — Backend Skeleton**: Supabase Edge Functions (Deno) built around the contract — typed/zod-validated env config, a typed Supabase client wrapper, a Gemini 1.5 Flash Vision client wrapper, hazard/ai/routing services, and three Edge Functions (`submit-report`, `get-hazards`, `request-route`). This is a follow-up PR.

The requirements below are written in EARS format and are structured so the ten Correctness Properties in the design document can each cite a requirement.

## Glossary

- **Type_Contract**: The shared TypeScript surface under `src/types/`, importable via `@/types`, that all three teams depend on at compile time.
- **Coordinates**: The app-friendly geographic shape `{ latitude: number; longitude: number }`, latitude first, used by the majority of application code.
- **GeoJSON_Layer**: The boundary-only geographic types (`GeoJsonPoint`, `GeoJsonPolygon`) whose positions are ordered `[longitude, latitude]`, used only at the database boundary.
- **Branded_Id**: A nominal string type (`BuildingId`, `FloorId`) carrying a compile-time brand so a plain string cannot be passed where a validated identifier is expected.
- **Hazard_Category**: A discriminated union of a closed set of known categories plus an `'other'` escape hatch that requires a free-text `otherDescription`.
- **Severity_Label**: An ordinal textual severity, one of `low`, `moderate`, `high`, `critical`.
- **Severity_Score**: A numeric severity on a 0-100 scale (branded nominal number).
- **Report_Lifecycle**: The ordered status set for a report/hazard: `submitted`, `ai_classified`, `community_confirmed`, `resolved`, `dismissed`.
- **Const_Array_Source**: A centralized `as const` array (for categories, severity labels, statuses, etc.) that is the single source of truth for both the derived union type and the zod enum.
- **Signed_URL**: A short-lived Supabase Storage URL (or a storage path the server will sign) that grants temporary read access to an image without exposing raw bytes.
- **Classification_Schema**: The single zod schema (`hazardClassificationResultSchema`) used both to constrain Gemini's structured output and to validate the returned JSON at the boundary.
- **Avoidance_Policy**: A per-request routing configuration consisting of a severity threshold, a radius in meters, and a mode of `soft_penalty` or `hard_block`.
- **Route_Response**: A union discriminated by `status`, either `route_found` (with path, total cost, bypassed nodes) or `no_accessible_route` (with bypassed nodes).
- **Row_Type**: A hand-written snake_case TypeScript type mirroring a Supabase/Postgres table row, with `timestamptz` columns typed as `string` and nullable columns typed `| null`.
- **Insert_Variant**: A derived row type that omits database-generated columns (`id`, `created_at`, `updated_at`, and other generated columns).
- **Result_Envelope**: The discriminated union `Result<T, E>` representing either a success (`ok: true`, `data`) or a failure (`ok: false`, `error`).
- **App_Error**: The error object `{ code, message, details? }` whose `code` belongs to a closed error-code union.
- **DTO**: A transport-neutral data-transfer object for an API operation, independent of HTTP or runtime framework.
- **Barrel**: The curated `index.ts` that re-exports the public `@/types` surface.
- **Edge_Function**: A Supabase Deno Edge Function serving an API operation.

## Requirements

### Requirement 1: Geographic primitives with dual representation

**User Story:** As a developer on any of the three teams, I want geographic data represented one way for application code and another way at the database boundary, so that most code stays human-readable while the database boundary matches GeoJSON conventions without ambiguity.

#### Acceptance Criteria

1. THE Type_Contract SHALL define a Coordinates type containing a numeric `latitude` field constrained to the inclusive range -90 to 90 and a numeric `longitude` field constrained to the inclusive range -180 to 180, with `latitude` declared first.
2. THE Type_Contract SHALL define a GeoJSON_Layer in which each position is an ordered pair `[longitude, latitude]` (longitude first).
3. THE Type_Contract SHALL define `GeoJsonPoint` with `type: 'Point'` and `GeoJsonPolygon` with `type: 'Polygon'`, where the polygon coordinates are one or more linear rings using the GeoJSON_Layer position ordering and each ring's first and last positions are equal (closed ring).
4. THE Type_Contract SHALL define `BuildingId` and `FloorId` as Branded_Id types that are structurally distinct from a plain `string` and from each other, such that a plain `string` cannot be assigned to either without an explicit cast.
5. WHERE a value is typed as Coordinates and another as a GeoJSON_Layer position, THE Type_Contract SHALL keep the two shapes structurally distinct so that assigning either where the other is expected fails type-checking in both directions.

### Requirement 2: Hazard domain model

**User Story:** As a backend developer, I want a precise hazard domain model with a closed category set, an escape hatch, dual severity representation, and a defined lifecycle, so that hazards are classified and tracked consistently across all teams.

#### Acceptance Criteria

1. THE Type_Contract SHALL define a Const_Array_Source for the closed set of known hazard categories and derive the known-category union type from that array so the union contains exactly the array's string literals and no additional members.
2. THE Type_Contract SHALL define Hazard_Category as a union discriminated by a `kind` field whose assignable values are exactly the known categories plus `'other'`.
3. WHERE a Hazard_Category value has `kind` equal to `'other'`, THE Type_Contract SHALL require a non-optional `otherDescription` field of type `string` with length 1 to 200 characters inclusive.
4. WHERE a Hazard_Category value has `kind` equal to a known category, THE Type_Contract SHALL NOT permit an `otherDescription` field.
5. THE Type_Contract SHALL define Severity_Label as a union derived from a Const_Array_Source containing exactly `low`, `moderate`, `high`, and `critical`, in that declared order, with no additional members.
6. THE Type_Contract SHALL define Severity_Score as a branded numeric type for the inclusive range 0 to 100 that is not assignable from a plain `number` without explicit conversion.
7. THE Type_Contract SHALL define the Report_Lifecycle as a union derived from a Const_Array_Source containing exactly `submitted`, `ai_classified`, `community_confirmed`, `resolved`, and `dismissed`, with no additional members.
8. WHERE a hazard category or severity list is needed by another file in the Type_Contract, THE Type_Contract SHALL derive that list from the same Const_Array_Source such that no category or severity literal is declared in more than one source location.

### Requirement 3: AI / Gemini classification contract

**User Story:** As a backend developer, I want a typed Gemini Vision contract that passes only a signed URL and is validated by a single schema, so that image bytes never reach the model and the model's output cannot drift from the hand-written result type.

#### Acceptance Criteria

1. THE Type_Contract SHALL define `HazardClassificationRequest` with a required non-empty `imageUrl` string carrying a Signed_URL or storage path, and SHALL NOT expose any field carrying raw image bytes (including `Buffer`, `Uint8Array`, `ArrayBuffer`, `Blob`, or a base64 image payload).
2. THE Type_Contract SHALL define `HazardClassificationResult` with `category` (a known category or `'other'`), `severityLabel` (a Severity_Label), `severityScore` (numeric, 0 to 100 inclusive), `confidence` (numeric, 0 to 1 inclusive), `rationale` (string, 1 to 500 characters inclusive), and `isUncertain` (boolean).
3. THE Type_Contract SHALL define the Classification_Schema as a single zod schema named `hazardClassificationResultSchema`, reused as both Gemini's response schema and the boundary validator, deriving its `category` and `severityLabel` enums from the hazard Const_Array_Source.
4. WHEN the Classification_Schema parses a candidate object, THE Classification_Schema SHALL succeed if and only if `severityScore` is within 0 to 100 inclusive, `confidence` is within 0 to 1 inclusive, `category` is a known category or `'other'`, `severityLabel` is a valid Severity_Label, `rationale` is a string of length 1 to 500 inclusive, and `isUncertain` is a boolean.
5. IF the Classification_Schema parses an object with a missing or out-of-range field, THEN THE Classification_Schema SHALL reject it, identify the offending field, and yield no parsed value.
6. THE Type_Contract SHALL include a compile-time guard asserting the type inferred from the Classification_Schema is assignable to the hand-written `HazardClassificationResult`, such that divergence fails `npx tsc --noEmit`.

### Requirement 4: Accessible routing contract

**User Story:** As a frontend or backend developer, I want typed routing data shapes with a configurable avoidance policy and a discriminated response, so that accessible navigation can be requested and rendered consistently while the routing algorithm remains a separate concern.

#### Acceptance Criteria

1. THE Type_Contract SHALL define `RouteGraphNode` with an `id`, a Coordinates position, a FloorId, a node kind, and accessibility attributes, and SHALL define `RouteEdge` with `from` and `to` fields typed as the same node-identifier type, a numeric cost, and a traversal mode.
2. THE Type_Contract SHALL define Avoidance_Policy containing a `severityThreshold` Severity_Label, a numeric `radiusMeters`, and a `mode` whose assignable values are exactly `soft_penalty` or `hard_block`, such that a value outside that set fails type-checking.
3. THE Type_Contract SHALL define `RouteRequest` carrying an origin Coordinates, a destination Coordinates, an accessibility-constraints field, and a non-optional Avoidance_Policy.
4. THE Type_Contract SHALL define Route_Response as a union discriminated by `status`, with a `route_found` variant carrying an ordered path, a total cost, and bypassed nodes, and a `no_accessible_route` variant carrying bypassed nodes and no path or total-cost field.
5. WHEN code branches on the `status` discriminant of a Route_Response, THE Route_Response SHALL narrow so the path and total cost are reachable only on the `route_found` variant.
6. THE Type_Contract SHALL define only the routing data shapes and SHALL NOT include the A*/Dijkstra algorithm implementation, which is delivered by the commit-2 routing service.

### Requirement 5: Database row types

**User Story:** As a backend and DB developer, I want hand-written snake_case Supabase row types with Insert/Update variants, so that queries are checked against an agreed schema until generated types stabilize.

#### Acceptance Criteria

1. THE Type_Contract SHALL define Row_Type definitions for exactly the six tables `HazardRow`, `ReportRow`, `RouteNodeRow`, `BuildingRow`, `ConfirmationRow`, and `VoteRow`, where every column key is written in snake_case.
2. THE Type_Contract SHALL type every `timestamptz` column as `string`.
3. THE Type_Contract SHALL type every column the database can return as null with a union that includes `null`, and SHALL omit `null` from the type of every column the database never returns as null.
4. WHERE a Row_Type has one or more database-generated columns, THE Type_Contract SHALL define an Insert_Variant that omits `id`, `created_at`, `updated_at`, and every other database-generated column, and retains all remaining columns.
5. WHERE a Row_Type has no database-generated columns, THE Type_Contract SHALL define an Insert_Variant equal to the full Row_Type.
6. THE Type_Contract SHALL define each Update variant as a type in which every field of the corresponding Insert_Variant is optional and no additional fields are present.
7. THE Type_Contract SHALL define `ConfirmationRow` and `VoteRow` Row_Type definitions, each with its Insert_Variant and Update variant, as part of the same contract as the other four Row_Type definitions.

### Requirement 6: API and transport contract

**User Story:** As a developer exchanging data between the frontend and backend, I want a transport-neutral result envelope, a closed error-code set, and typed DTOs, so that success and failure are handled exhaustively regardless of runtime.

#### Acceptance Criteria

1. THE Type_Contract SHALL define Result_Envelope as a union discriminated by the boolean `ok` field, where the success member has `ok` equal to `true` and carries a `data` field and no `error` field, and the failure member has `ok` equal to `false` and carries an `error` field of type App_Error and no `data` field.
2. WHEN code branches on the `ok` discriminant of a Result_Envelope, THE Result_Envelope SHALL narrow so the `true` branch exposes `data` and rejects access to `error`, and the `false` branch exposes `error` and rejects access to `data`, leaving no unhandled member.
3. THE Type_Contract SHALL define App_Error with a `code` field drawn from a closed string-literal union containing exactly `validation_error`, `not_found`, `ai_unavailable`, `db_error`, `unauthorized`, `rate_limited`, and `internal_error`, a required `message` string, and an optional `details` field.
4. IF a value assigns to App_Error a `code` outside the seven defined literals, THEN THE Type_Contract SHALL reject the assignment as a compile-time type error.
5. THE Type_Contract SHALL define transport-neutral DTOs for each of the `submit-report`, `get-hazards`, and `request-route` operations, with each operation declaring both its request DTO and its response DTO, and with no field, type, or import referencing an HTTP or framework construct.
6. THE Type_Contract SHALL provide an `ok` constructor returning a success Result_Envelope carrying the supplied `data`, and an `err` constructor returning a failure Result_Envelope carrying the supplied App_Error, where each constructor's return type is the corresponding discriminated member.

### Requirement 7: Curated barrel export

**User Story:** As a consumer of the contract, I want to import everything from `@/types`, so that I depend on a stable public surface and never reach into internal files or internal guards.

#### Acceptance Criteria

1. THE Barrel SHALL re-export every public type declared across the Type_Contract files (geo, hazard, ai, routing, database, api) using `export type` declarations.
2. THE Barrel SHALL re-export every public runtime value declared across the Type_Contract files, including zod schemas, const arrays, and helper constructors, using value exports.
3. THE Barrel SHALL NOT export any internal compile-time guard, including the schema/contract assignment guard, such that no guard identifier is reachable from an `import ... from '@/types'` statement.
4. WHEN a consumer imports an identifier from `@/types`, THE Barrel SHALL resolve that identifier to a single declaration, with no duplicate or conflicting re-export of the same identifier name.
5. WHERE a file in the Type_Contract imports from another file in the contract, THE Type_Contract SHALL import only from files earlier in the dependency order `geo → hazard → ai → routing → database → api → index`, such that the import graph contains zero cycles.
6. IF a Type_Contract file imports from a file equal to or later than itself in the dependency order, THEN THE Type_Contract SHALL fail type-check with an error indicating the disallowed import direction.

### Requirement 8: Engineering and delivery constraints

**User Story:** As a maintainer, I want strict typing, SDK-compatible dependency installation, passing gates, a server-only AI key, and a staged branch workflow, so that the contract and skeleton are safe to merge and the teams can review the contract before implementation depends on it.

#### Acceptance Criteria

1. THE Type_Contract SHALL be authored under strict TypeScript with `strict: true` enabled in `tsconfig.json`, and `npx tsc --noEmit` SHALL complete with zero type errors.
2. WHEN zod is added as a dependency, THE backend-shared-types delivery SHALL install it via `npx expo install zod` so the resolved version satisfies the installed Expo SDK's compatible version range.
3. IF `npx expo install zod` resolves a version outside the Expo SDK's compatible range, THEN THE backend-shared-types delivery SHALL halt dependency installation and surface a version-incompatibility error, leaving existing `package.json` dependency entries unchanged.
4. WHEN the commit-1 pull request is prepared, THE backend-shared-types delivery SHALL run `npx oxlint --deny-warnings` and `npx tsc --noEmit` and confirm both exit with a zero exit code and zero errors before the pull request is opened.
5. IF either `npx oxlint --deny-warnings` or `npx tsc --noEmit` exits non-zero or reports one or more errors, THEN THE backend-shared-types delivery SHALL block opening the commit-1 pull request and surface the reported errors.
6. THE backend-shared-types delivery SHALL keep the Gemini API key server-only and SHALL NOT include the key in any file, environment variable, or asset bundled into the Expo client application.
7. THE backend-shared-types delivery SHALL implement the backend skeleton as Supabase Edge Functions, keeping the shared type definitions identical regardless of the backend runtime choice.
8. WHEN changes are pushed, THE backend-shared-types delivery SHALL push to a feature branch and SHALL NOT push directly to `main`.
9. IF a push targets the `main` branch directly, THEN THE backend-shared-types delivery SHALL reject the push and surface an error indicating direct pushes to `main` are not permitted.
10. THE backend-shared-types delivery SHALL open the commit-1 type-contract pull request into `main` and SHALL NOT open the commit-2 backend-skeleton pull request until the commit-1 pull request has been opened.

### Requirement 9: Type-contract test harness

**User Story:** As a reviewer of the contract, I want a minimal test harness with compile-time assertions and schema unit tests, so that the contract's guarantees are verified automatically within commit 1.

#### Acceptance Criteria

1. THE test harness SHALL use the ecosystem-standard test runner for Expo SDK 58, installed via `npx expo install`.
2. THE test harness SHALL include type-level assertions that the Classification_Schema inferred type is assignable to `HazardClassificationResult`, that a Result_Envelope narrows on its `ok` discriminant, that the `'other'` Hazard_Category requires `otherDescription`, and that Insert_Variant types reject generated columns.
3. WHEN a well-formed classification object is parsed by the Classification_Schema, THE test harness SHALL assert the parse succeeds.
4. IF a classification object with an invalid category is parsed by the Classification_Schema, THEN THE test harness SHALL assert the parse fails.
5. IF a classification object with a `severityScore` outside 0 to 100 inclusive or a `confidence` outside 0 to 1 inclusive is parsed by the Classification_Schema, THEN THE test harness SHALL assert the parse fails.
