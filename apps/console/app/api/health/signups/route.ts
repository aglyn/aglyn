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
 * The OLD path for `/api/health/signup-volume` (AGL-2583).
 *
 * The check was renamed to what it measures, because "signups: ok" reads as
 * "people can sign up" and means "no abuse wave" — a gap that let AGL-2581
 * refuse every account creation on the platform for three days with this
 * endpoint green. The path moved with it.
 *
 * This file exists so that rename cost nobody an outage. The GCP uptime check
 * (already named `signup-volume`), the GitHub uptime probe, the docs status
 * page and anything a self-hoster wired up all keep working unchanged; the
 * body they get back is the new one, service `console-signup-volume`, with
 * the renamed checks.
 *
 * NOT a redirect, deliberately. A monitor that refuses to follow a `3xx` —
 * which this repo's own probe does, for good reason (AGL-786) — would report
 * a redirect as an outage, so the old path answers the question itself.
 *
 * The segment config is DECLARED here rather than re-exported. Next reads
 * `dynamic` and `revalidate` statically per route file, and a re-export is
 * not something it can follow — the alias would quietly become a cacheable
 * health check, which is the first way a health check learns to lie.
 */
// lockdown-423: exempt — infrastructure monitoring probe; no org-scoped action.

export { GET, HEAD } from '../signup-volume/route'

/** Never prerender, never revalidate. */

export const dynamic = 'force-dynamic'
export const revalidate = 0
