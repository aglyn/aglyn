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
 * The operator alert the post-deploy production canary raises (AGL-3567).
 *
 * `tools/scripts/prod-canary.mjs` runs in GitHub Actions the moment a tenant
 * or console production deploy is READY, and rolls a broken one back. Slack
 * `#ci` hears about it from the runner; this is the other half — the staff
 * bell and the operator email — reached through
 * `POST /api/admin/operator-alerts/canary` with the cron secret.
 *
 * The caller supplies only identifiers, each validated against a fixed
 * shape; every sentence the alert carries is written here. A request that
 * holds the cron secret can therefore raise this one alert type, about one
 * of two projects, and nothing it says reaches a reader unvalidated.
 */

import type { RaiseOperatorAlertOptions } from '@aglyn/tenant-data-admin/server/operator-alerts'

export const PROD_CANARY_ALERT_TYPE = 'ops.productionCanaryRed'

const PROJECTS = new Set(['aglyn-tenant', 'aglyn-console'])
const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]{8,64}$/
const RUN_URL = /^https:\/\/github\.com\/aglyn\/aglyn\/actions\/runs\/\d+(\/attempts\/\d+)?$/
const AFTER = new Set(['green', 'recovered', 'rollback', 'degraded', 'inconclusive', 'not serving'])

/** The verdicts that reach the operator, in the words the alert uses. */
const OUTCOMES: Record<string, (input: CanaryAlertInput) => { outcome: string; detail: string }> = {
  rollback: (input) =>
    input.rolledBackTo
      ? {
          outcome: `rolled back to ${input.rolledBackTo}`,
          detail:
            `Deployment ${input.deploymentId} stopped rendering uncached pages on several sites, ` +
            `so production was rolled back to ${input.rolledBackTo}` +
            (input.after ? `; the canary then read it as ${input.after}.` : '.') +
            ' Auto-assign is now OFF: promote the next good release by hand (RELEASING.md step 0).',
        }
      : {
          outcome: 'failing, NOT rolled back',
          detail:
            `Deployment ${input.deploymentId} stopped rendering uncached pages on several sites ` +
            'and the canary could not roll it back. Roll it back in Vercel now.',
        },
  // A candidate graded by its own URL before production served it (AGL-3571):
  // nothing to roll back, and the one thing to say is "do not promote it".
  'candidate-red': (input) => ({
    outcome: 'candidate fails — do NOT promote',
    detail:
      `Deployment ${input.deploymentId} stopped rendering pages on several sites when the canary ` +
      'rendered them on its own URL. Production does not serve it, so nothing was rolled back. ' +
      'Do not promote it; fix forward and let the next deploy be graded.',
  }),
  degraded: (input) => ({
    outcome: 'failing on some sites',
    detail:
      `After deployment ${input.deploymentId}, pages kept failing on some sites but never on ` +
      'enough at once to roll back. Open the run and read which hosts.',
  }),
  inconclusive: (input) => ({
    outcome: 'could not read production',
    detail:
      `The canary could not see deployment ${input.deploymentId}: bot protection or the ` +
      'network answered instead of the app. Nothing is known about the deploy until it can.',
  }),
  'not-serving': (input) => ({
    outcome: 'new deploy is not serving',
    detail:
      `Deployment ${input.deploymentId} is READY but production does not serve it. After a ` +
      'rollback auto-assign is OFF: promote it by hand (RELEASING.md step 0).',
  }),
}

interface CanaryAlertInput {
  project: string
  verdict: string
  deploymentId: string
  rolledBackTo: string | null
  after: string | null
  runUrl: string
}

export type CanaryAlertRequest =
  | { ok: true; type: typeof PROD_CANARY_ALERT_TYPE; options: RaiseOperatorAlertOptions }
  | { ok: false; error: string }

/** Validate the canary's request and write the alert it raises. */
export function canaryAlertFromBody(body: unknown): CanaryAlertRequest {
  const raw = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const text = (key: string) => (typeof raw[key] === 'string' ? (raw[key] as string) : null)
  const project = text('project')
  const verdict = text('verdict')
  const deploymentId = text('deploymentId')
  const rolledBackTo = text('rolledBackTo')
  const after = text('after')
  const runUrl = text('runUrl')

  if (!project || !PROJECTS.has(project)) return { ok: false, error: 'unknown project' }
  if (!verdict || !OUTCOMES[verdict]) return { ok: false, error: 'not an alerting verdict' }
  if (!deploymentId || !DEPLOYMENT_ID.test(deploymentId)) return { ok: false, error: 'bad deploymentId' }
  if (rolledBackTo !== null && !DEPLOYMENT_ID.test(rolledBackTo)) return { ok: false, error: 'bad rolledBackTo' }
  if (after !== null && !AFTER.has(after)) return { ok: false, error: 'bad after' }
  if (!runUrl || !RUN_URL.test(runUrl)) return { ok: false, error: 'bad runUrl' }

  const input = { project, verdict, deploymentId, rolledBackTo, after, runUrl }
  const { outcome, detail } = OUTCOMES[verdict](input)
  return {
    ok: true,
    type: PROD_CANARY_ALERT_TYPE,
    options: {
      // One alert per deployment and verdict: a re-run of the same red
      // canary is the same event, and a later verdict on it is news.
      dedupeKey: `${project}:${deploymentId}:${verdict}`,
      context: { project, outcome, detail },
      url: runUrl,
    },
  }
}
