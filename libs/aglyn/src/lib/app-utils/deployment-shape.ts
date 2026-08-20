/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Which SHAPE this runtime is: a deployment, or a developer's machine
 * (AGL-2177, AGL-2180).
 *
 * ## Why this needs a name
 *
 * `process.env.VERCEL` was doing duty as "is this a real deployment" in four
 * places, and Aglyn's cloud is not the only deployment shape the product
 * supports. On a self-host container `docker/*.Dockerfile` sets
 * `AGLYN_STANDALONE=1` and never sets `VERCEL`, so every one of those checks
 * read a production install as a developer's laptop:
 *
 *  - `apps/tenant/middleware.ts` resolved no host at all and 307'd every
 *    visitor to `app.aglyn.com` — the serving half of self-hosting, inert
 *    (AGL-2177).
 *  - `apps/console/app/api/domains/verify/route.ts` enabled its DEV soft-pass,
 *    so any domain carrying any CNAME to anywhere verified — the AGL-733
 *    defect, reinstated on every self-host install.
 *  - `apps/tenant/.../load-page-data.ts` never redirected a platform subdomain
 *    to its connected custom domain, so every site served at two addresses.
 *
 * The question those checks are asking is not "are we on Vercel". Naming it
 * separately is what stops the next one from reaching for the vendor variable
 * again.
 *
 * ## The two predicates are not interchangeable
 *
 * {@link isDeployedRuntime} is the broad one, and it is what a branch about
 * *any* deployment wants. But a security relaxation must not key off it, and
 * that distinction is the whole of AGL-2180: a check that loosens because it
 * cannot find a hosting vendor's environment variable is failing open on an
 * axis unrelated to the thing it is protecting. For those, use
 * {@link isDevelopmentRuntime}, which keys on `NODE_ENV` — the variable that
 * actually means "this is not production", is set by every runtime including
 * containers, and cannot be absent by accident on a production build.
 *
 * ## Not importable from an edge bundle
 *
 * `apps/tenant/middleware.ts` keeps its own local copy of the deployed
 * predicate, for the same reason it keeps a local `PLATFORM_GENERATOR_NAME`:
 * middleware runs in the edge runtime, and every middleware in this repo
 * imports only app-local constants precisely so a server-only graph never gets
 * dragged into an edge bundle. The copy is kept honest by an assertion in
 * `apps/tenant/specs/selfhost-host-resolution.spec.ts` rather than by hope.
 */

/**
 * True when this process is a real deployment — Aglyn's cloud, or an
 * operator's own container — as opposed to a developer's machine.
 *
 * Use for behaviour that should be live wherever the product is actually
 * serving. Do NOT use to decide whether a security check may be relaxed; see
 * {@link isDevelopmentRuntime}.
 */
export function isDeployedRuntime(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return Boolean(env['VERCEL']) || env['AGLYN_STANDALONE'] === '1'
}

/**
 * True only on a PRODUCTION deployment — Vercel production, or an operator's
 * container running in production.
 *
 * Narrower than {@link isDeployedRuntime} on purpose, and the difference is a
 * preview. The canonical custom-domain redirect keys on this: a preview
 * deployment that bounced a reviewer onto the customer's live site would be
 * useless, and a dev machine that did it would be baffling — so "any
 * deployment" is the wrong question there even though it is the right one for
 * host resolution.
 *
 * That distinction was caught by `canonical-domain-redirect.spec.ts` refusing
 * a broader predicate, which is the test suite doing its job: the first
 * attempt at AGL-2180 used {@link isDeployedRuntime} here and would have
 * started redirecting reviewers off every preview build.
 */
export function isProductionDeployment(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env['VERCEL_ENV'] === 'production') return true
  return env['AGLYN_STANDALONE'] === '1' && env['NODE_ENV'] === 'production'
}

/**
 * What to call this deployment's environment in a health report (AGL-2436).
 *
 * Both health routes read `process.env.VERCEL_ENV ?? 'development'`, so an
 * operator's production container reported `"environment": "development"` —
 * to them, and to whatever monitoring they point at it. A health endpoint is
 * the one surface whose entire job is to say what is running, and it was
 * saying the opposite for every deployment that is not ours.
 *
 * `VERCEL_ENV` still wins where it exists, because it distinguishes a preview
 * from production and nothing else can. Off Vercel the answer comes from the
 * predicates above rather than from the absence of a vendor's variable.
 */
export function deploymentEnvironmentLabel(
  env: Record<string, string | undefined> = process.env,
): string {
  const vercel = env['VERCEL_ENV']
  if (vercel) return vercel
  if (isProductionDeployment(env)) return 'production'
  if (isDeployedRuntime(env)) return 'deployment'
  return 'development'
}

/**
 * True only on a development runtime.
 *
 * The predicate a relaxation is allowed to key on. `NODE_ENV` is set to
 * `production` by every production build in this repo — Next sets it, and
 * both Dockerfiles set it explicitly — so unlike a vendor variable it cannot
 * be quietly absent on a real install and hand a production deployment the
 * developer's rules.
 */
export function isDevelopmentRuntime(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env['NODE_ENV'] !== 'production'
}

/**
 * Build metadata that is unset, in every spelling this repo produces.
 *
 * `libs/shared/data/enums/src/lib/global.ts` renders unset build metadata as
 * the literal string `'NULL'`, and a Docker `ARG` referenced with no value
 * hands the same text through the build. Treating those as a real answer is
 * how a health endpoint ends up reporting that it is running commit "NULL".
 */
const UNSTAMPED = new Set(['', 'NULL', 'null', 'undefined'])

function stamped(value: string | undefined): string | null {
  const trimmed = String(value ?? '').trim()
  return UNSTAMPED.has(trimmed) ? null : trimmed
}

/**
 * Which BUILD answered, on any deployment shape (AGL-2091).
 *
 * Every `/api/health*` route read `VERCEL_GIT_COMMIT_SHA` directly, which is
 * unset everywhere except Aglyn's cloud — so a self-hosted install's health
 * body said `"commit": null`, and the operator's only way to say what they
 * were running was to guess. The endpoint whose entire job is to describe the
 * running build described nobody else's.
 *
 * The precedence deliberately matches the console footer's (AGL-2181), so the
 * two surfaces cannot disagree about the same build:
 *
 *  1. `BUILD_ID` — an explicit stamp, which is what a self-host operator sets
 *     when they cut their own build and want their own identifier back.
 *  2. `COMMIT_REF` — already resolved from four candidates by
 *     `with-aglyn.nextjs.config.js` and already exported from `global.ts`; it
 *     had no consumers at all until this one.
 *  3. `VERCEL_GIT_COMMIT_SHA` — Aglyn's cloud, unchanged.
 *
 * Shortened to seven characters, the form `/api/health` has always reported,
 * so an existing uptime series stays comparable across the change.
 */
export function deploymentCommitRef(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const ref =
    stamped(env['BUILD_ID']) ??
    stamped(env['COMMIT_REF']) ??
    stamped(env['VERCEL_GIT_COMMIT_SHA'])
  return ref === null ? null : ref.slice(0, 7)
}

/**
 * Which VERSION of the platform this is (AGL-2091).
 *
 * The number a self-hoster quotes in a bug report, and the one that answers
 * "has the fix reached me yet". It needs no operator configuration:
 * `with-aglyn.nextjs.config.js` reads it out of the root `package.json` and
 * inlines it as `PACKAGE_VERSION`, so a container built from a release tag
 * reports that release the first time it starts — unlike the commit, which an
 * operator has to stamp if they want it.
 *
 * Null rather than `'NULL'` when a build missed the define: a health body that
 * admits it does not know is honest, and one that reports a version of "NULL"
 * teaches whoever reads it to ignore the field.
 */
export function platformVersion(
  env: Record<string, string | undefined> = process.env,
): string | null {
  return stamped(env['PACKAGE_VERSION'])
}
