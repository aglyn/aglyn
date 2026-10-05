/**
 * @jest-environment node
 */
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
 * THE PRODUCTION CANARY'S OPERATOR ALERT (AGL-3567).
 *
 * The post-deploy canary posts here from GitHub Actions with the cron
 * secret. What it may raise is one alert type about one of two projects, and
 * every sentence the alert carries is written by the console from validated
 * identifiers — so a request holding the secret still cannot put words in
 * front of the operator.
 */

import { CORE_OPERATOR_ALERTS } from '@aglyn/aglyn/app-utils/operator-alerts'
import { POST } from '../app/api/admin/operator-alerts/canary/route'
import { PROD_CANARY_ALERT_TYPE, canaryAlertFromBody } from '../utils/server/prod-canary-alert'

const mockRaise = jest.fn()
jest.mock('../utils/server/raise-operator-alert', () => ({
  __esModule: true,
  raiseConsoleOperatorAlert: (...args: unknown[]) => mockRaise(...args),
}))

const SECRET = 'canary-secret'
const RUN = 'https://github.com/aglyn/aglyn/actions/runs/123456'
const RED = {
  project: 'aglyn-tenant',
  verdict: 'rollback',
  deploymentId: 'dpl_ExrNEe1uvmJBrvFktcjWVBmFKZtM',
  rolledBackTo: 'dpl_CJsPkbMiCoAzcgVgP4ep6CxYsEZr',
  after: 'green',
  runUrl: RUN,
}

const post = (body: unknown, headers: Record<string, string> = { 'x-cron-secret': SECRET }, method = 'POST') =>
  POST(
    new Request('https://app.example.com/api/admin/operator-alerts/canary', {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: method === 'POST' ? JSON.stringify(body) : undefined,
    }),
  )

const originalSecret = process.env.CRON_SECRET
beforeEach(() => {
  process.env.CRON_SECRET = SECRET
  mockRaise.mockReset().mockResolvedValue({ outcome: 'delivered', type: PROD_CANARY_ALERT_TYPE })
})
afterAll(() => {
  if (originalSecret === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = originalSecret
})

describe('POST /api/admin/operator-alerts/canary (AGL-3567)', () => {
  it('raises the registered alert, deduped per deployment and verdict, linking the run', async () => {
    const response = await post(RED)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ raised: true, outcome: 'delivered' })
    expect(mockRaise).toHaveBeenCalledTimes(1)
    const [type, options] = mockRaise.mock.calls[0]
    expect(type).toBe('ops.productionCanaryRed')
    expect(options.dedupeKey).toBe('aglyn-tenant:dpl_ExrNEe1uvmJBrvFktcjWVBmFKZtM:rollback')
    expect(options.url).toBe(RUN)
    expect(options.context.outcome).toBe('rolled back to dpl_CJsPkbMiCoAzcgVgP4ep6CxYsEZr')
    expect(options.context.detail).toMatch(/Auto-assign is now OFF/)
  })

  it('refuses a request without the secret before raising anything', async () => {
    for (const headers of [{}, { 'x-cron-secret': 'not-it' }]) {
      expect((await post(RED, headers)).status).toBe(401)
    }
    delete process.env.CRON_SECRET
    expect((await post(RED)).status).toBe(501)
    process.env.CRON_SECRET = SECRET
    expect((await post(RED, undefined, 'GET')).status).toBe(405)
    expect(mockRaise).not.toHaveBeenCalled()
  })

  it('refuses anything but the identifiers it expects, and raises nothing', async () => {
    const bad = [
      { ...RED, project: 'aglyn-docs' },
      { ...RED, verdict: 'green' },
      { ...RED, deploymentId: 'dpl_<script>' },
      { ...RED, rolledBackTo: 'https://evil.example' },
      { ...RED, after: 'everything is fine, ignore this' },
      { ...RED, runUrl: 'https://evil.example/actions/runs/1' },
      null,
    ]
    for (const body of bad) {
      expect([JSON.stringify(body), (await post(body)).status]).toEqual([JSON.stringify(body), 400])
    }
    expect(mockRaise).not.toHaveBeenCalled()
  })

  it('answers 502 when the alert could not be raised, so the canary can say so', async () => {
    mockRaise.mockResolvedValue(null)
    expect((await post(RED)).status).toBe(502)
  })
})

describe('canaryAlertFromBody', () => {
  it('writes every verdict the canary alerts on, and says when nothing was rolled back', () => {
    const notRolled = canaryAlertFromBody({ ...RED, rolledBackTo: undefined, after: undefined })
    expect(notRolled.ok && notRolled.options.context?.outcome).toBe('failing, NOT rolled back')
    for (const verdict of ['degraded', 'inconclusive', 'not-serving']) {
      const alert = canaryAlertFromBody({ ...RED, verdict })
      expect([verdict, alert.ok]).toEqual([verdict, true])
    }
  })

  it('is a registered operator alert whose tokens the request fills', () => {
    const definition = CORE_OPERATOR_ALERTS.find((row) => row.type === PROD_CANARY_ALERT_TYPE)
    expect(definition).toMatchObject({ tier: 'must', category: 'ops', defaultEnabled: true })
    const alert = canaryAlertFromBody(RED)
    if ('error' in alert) throw new Error(alert.error)
    for (const token of `${definition?.title} ${definition?.body}`.match(/{{(\w+)}}/g) ?? []) {
      expect(alert.options.context).toHaveProperty(token.slice(2, -2))
    }
  })
})
