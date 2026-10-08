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

import type { OperatorAlertTier } from '@aglyn/aglyn/app-utils/operator-alerts'
import { deploymentEnvironmentLabel } from '@aglyn/aglyn/app-utils/deployment-shape'
import { beaconLoggingTarget } from './client-error-report'
import type { RenderedOperatorAlert } from './operator-alerts'

/**
 * Every operator alert that fires is also written to Cloud Logging
 * (AGL-3683), so the platform's Cloud Monitoring alert policies can page on
 * it and route it to their channels (email, Slack) beside the uptime checks.
 * Vercel stdout never reaches GCP Logging, so a `console.error` is not
 * enough. This writes through the same admin credential the error beacon
 * uses, which `/api/health/error-beacon` already probes.
 *
 * One entry per alert that fires, after its dedupe. That is a handful a day,
 * so it needs no budget. An install with no admin credential writes nothing.
 * Never throws.
 */
export const OPERATOR_ALERT_LOG_ID = 'operator-alerts'

const WRITE_TIMEOUT_MS = 5_000

/** A must-know is an error, a should-know a warning, routine a notice. */
const TIER_SEVERITY: Record<OperatorAlertTier, string> = {
  must: 'ERROR',
  should: 'WARNING',
  low: 'NOTICE',
}

export async function writeOperatorAlertLog(alert: RenderedOperatorAlert): Promise<boolean> {
  try {
    const target = await beaconLoggingTarget()
    if (!target) return false
    const response = await fetch('https://logging.googleapis.com/v2/entries:write', {
      method: 'POST',
      headers: { Authorization: `Bearer ${target.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        logName: `projects/${target.projectId}/logs/${OPERATOR_ALERT_LOG_ID}`,
        resource: { type: 'global' },
        entries: [
          {
            severity: TIER_SEVERITY[alert.tier] ?? 'WARNING',
            // The alert policy's documentation renders these, so the page
            // says what broke without opening the console.
            labels: { type: alert.type, tier: alert.tier, category: alert.category },
            jsonPayload: {
              message: `${alert.title}: ${alert.body}`,
              type: alert.type,
              title: alert.title,
              body: alert.body,
              link: alert.link || undefined,
              orgId: alert.orgId,
              hostId: alert.hostId,
              // A developer's laptop on platform credentials writes here
              // too; the policies match production only.
              environment: deploymentEnvironmentLabel(),
            },
          },
        ],
      }),
      signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
    })
    if (!response.ok) console.error(`[operator-alerts] cloud logging answered ${response.status}`)
    return response.ok
  } catch (error) {
    console.error('[operator-alerts] cloud logging unreachable', error)
    return false
  }
}
