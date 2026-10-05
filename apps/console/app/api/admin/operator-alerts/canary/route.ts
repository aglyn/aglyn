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
 * THE PRODUCTION CANARY'S OPERATOR ALERT (AGL-3567). The post-deploy canary
 * in GitHub Actions posts here when a deploy fails it — rolled back or not —
 * so the red reaches the staff bell and the operator email, not only Slack.
 * See `utils/server/prod-canary-alert.ts` for what the caller may say.
 */

// lockdown-423: exempt — server-internal caller (x-cron-secret), no user caller; it alerts the
// operator that production failed after a deploy, which no workspace lock may silence.

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import { isCronAuthorized } from '../../../../../utils/cron-auth'
import { raiseConsoleOperatorAlert } from '../../../../../utils/server/raise-operator-alert'
import { canaryAlertFromBody } from '../../../../../utils/server/prod-canary-alert'

async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  if (!process.env.CRON_SECRET) {
    return Response.json({ error: 'Not configured (CRON_SECRET).' }, { status: 501 })
  }
  if (!isCronAuthorized(headers)) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  const alert = canaryAlertFromBody(body)
  if ('error' in alert) return Response.json({ error: alert.error }, { status: 400 })
  const result = await raiseConsoleOperatorAlert(alert.type, alert.options)
  return Response.json(
    { raised: Boolean(result), outcome: result?.outcome ?? null },
    { status: result ? 200 : 502 },
  )
}

export const dynamic = 'force-dynamic'
export { handler as POST }
export const maxDuration = 30
