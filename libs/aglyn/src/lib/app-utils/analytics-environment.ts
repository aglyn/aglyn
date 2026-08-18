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
 * Whether THIS BUILD is allowed to report to Google Analytics at all
 * (AGL-2067).
 *
 * ## The hole this closes
 *
 * Neither app gated GA on the deployment environment. The console called
 * `initializeAnalytics` unconditionally and `apps/console/.env.development.local`
 * points at the PRODUCTION measurement id, so every `next dev` session produced
 * real `session_start` / `first_visit` / `page_view` hits in the live property;
 * the tenant runtime mounted its tag wherever the resolved host carried an id,
 * which on a preview deploy of `aglyn.com` is our own.
 *
 * That is not hypothetical. `docs/ANALYTICS.md` records the archived Marketing
 * property's entire year-to-date history as 30 views / 6 users, ~24 of them
 * `/signin` on Vercel PREVIEW urls of the console. Preview traffic reaching a
 * production property is most of what that property ever recorded.
 *
 * `apps/docs` already got this right — the Docusaurus gtag plugin returns null
 * unless `NODE_ENV === 'production'` — so this is the same rule, made
 * available to the two apps that lacked it.
 *
 * ## Why this is better than the stamp for the dev case
 *
 * `traffic_type: 'internal'` only helps once Zach creates the GA4 data filter,
 * and a filter is not retroactive: a hit that ships today is counted today.
 * Not emitting at all needs nobody's click and cannot be got wrong later.
 *
 * ## The three signals, and why the default leans LOUD
 *
 * - `NODE_ENV !== 'production'` — every `next dev`, every jest run, every
 *   local e2e. Never emits.
 * - `deployEnv` is `preview` or `development` — a Vercel preview build has
 *   `NODE_ENV === 'production'` (it is a production build), so nothing else
 *   catches it. `VERCEL_ENV` is server-only, so each app maps it into the
 *   client bundle through its `next.config` `env` block; assuming Vercel's
 *   "automatically expose system environment variables" setting is on would
 *   be a gate that silently is not there.
 * - `deployEnv` unknown with `NODE_ENV === 'production'` — **emits.** That is
 *   the self-host case (Docker + bring-your-own-Firebase), which points at the
 *   operator's own Firebase project and their own GA property. Defaulting
 *   those to silence would break a customer's analytics to protect ours, which
 *   is the worse failure; our own builds are the ones that carry the marker.
 *
 * ## The escape hatch
 *
 * `NEXT_PUBLIC_ANALYTICS_ALLOW_NONPROD=1` re-enables emission where the rules
 * above would silence it, for the times someone genuinely needs to exercise
 * the taxonomy against GA DebugView. It is deliberately paired with
 * `analyticsEnvironmentForcesInternal`, so a build using it stamps
 * `traffic_type: 'internal'` on everything unconditionally — the hatch cannot
 * become the leak it exists beside.
 */

/** The env var that re-enables analytics where this module would silence it. */
export const ANALYTICS_ALLOW_NONPROD_ENV = 'NEXT_PUBLIC_ANALYTICS_ALLOW_NONPROD'

/** The deploy-environment values that are never our production surface. */
const NON_PRODUCTION_DEPLOY_ENVS = new Set(['preview', 'development'])

export interface AnalyticsEnvironment {
  /** `process.env.NODE_ENV`. */
  nodeEnv?: string | null
  /** `VERCEL_ENV`, mapped into the client bundle by each app's next.config. */
  deployEnv?: string | null
  /** The escape hatch's raw value. */
  allowNonProduction?: string | null
}

/**
 * The build's own environment.
 *
 * Read through `process.env` at CALL time rather than captured at module load,
 * so a spec can drive every branch — the alternative is a module constant that
 * can only ever be observed in one state, which is the shape of a check that
 * cannot fail.
 */
export function readAnalyticsEnvironment(): AnalyticsEnvironment {
  return {
    nodeEnv: process.env.NODE_ENV,
    deployEnv: process.env.NEXT_PUBLIC_DEPLOY_ENV,
    allowNonProduction: process.env[ANALYTICS_ALLOW_NONPROD_ENV],
  }
}

/** Whether this build is one of our real production deployments. */
function isProductionSurface(env: AnalyticsEnvironment): boolean {
  if (env.nodeEnv !== 'production') return false
  const deployEnv = (env.deployEnv || '').toLowerCase()
  return !NON_PRODUCTION_DEPLOY_ENVS.has(deployEnv)
}

/** Whether the escape hatch is set to something meaning "yes". */
function allowsNonProduction(env: AnalyticsEnvironment): boolean {
  const raw = (env.allowNonProduction || '').trim().toLowerCase()
  return raw !== '' && raw !== '0' && raw !== 'false' && raw !== 'off'
}

/**
 * Whether this build may load a Google Analytics tag and send hits at all.
 *
 * The one question both apps ask. `false` means the tag is never created —
 * not created and then suppressed — because a resident tag re-creates `_ga`
 * and reports on its own (the AGL-1608 lesson), and because "no tag" is the
 * only state that needs no filter to be true.
 */
export function analyticsMayEmit(
  env: AnalyticsEnvironment = readAnalyticsEnvironment(),
): boolean {
  return isProductionSurface(env) || allowsNonProduction(env)
}

/**
 * Whether every hit from this build must carry `traffic_type: 'internal'`
 * regardless of who is signed in or what the browser opted into.
 *
 * True only for a non-production build running with the escape hatch on —
 * i.e. exactly the builds that emit *because someone asked them to*, which are
 * by definition ours. Keeps the hatch from reopening the hole.
 */
export function analyticsEnvironmentForcesInternal(
  env: AnalyticsEnvironment = readAnalyticsEnvironment(),
): boolean {
  return !isProductionSurface(env) && allowsNonProduction(env)
}

export default analyticsMayEmit
