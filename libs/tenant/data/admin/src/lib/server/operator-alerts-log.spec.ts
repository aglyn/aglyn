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
 * Operator alerts reach Cloud Logging (AGL-3683), so a Cloud Monitoring
 * policy can page email and Slack on them.
 */

let target: { token: string; projectId: string } | null = null
jest.mock('./client-error-report', () => ({
  beaconLoggingTarget: async () => target,
}))

import type { RenderedOperatorAlert } from './operator-alerts'
import { OPERATOR_ALERT_LOG_ID, writeOperatorAlertLog } from './operator-alerts-log'

const alert: RenderedOperatorAlert = {
  type: 'ai.jobFailed',
  label: 'An AI job failed',
  tier: 'should',
  category: 'ops',
  title: 'An AI site job failed',
  body: 'AI job j1 (site) in workspace o1 failed at step site: upstream 529.',
  link: '/admin/orgs/o1',
  notificationType: 'system.operatorAlert',
  orgId: 'o1',
}

let fetchMock: jest.Mock
beforeEach(() => {
  target = { token: 'tok', projectId: 'aglyn-main' }
  fetchMock = jest.fn(async () => ({ ok: true, status: 200 }))
  global.fetch = fetchMock as unknown as typeof fetch
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => jest.restoreAllMocks())

describe('writeOperatorAlertLog', () => {
  it('writes one entry to the operator-alerts log, labelled by type, at the tier’s severity', async () => {
    expect(await writeOperatorAlertLog(alert)).toBe(true)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://logging.googleapis.com/v2/entries:write')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok' })
    const body = JSON.parse(init.body)
    expect(body.logName).toBe(`projects/aglyn-main/logs/${OPERATOR_ALERT_LOG_ID}`)
    expect(body.entries).toHaveLength(1)
    expect(body.entries[0]).toMatchObject({
      severity: 'WARNING',
      labels: { type: 'ai.jobFailed', tier: 'should', category: 'ops' },
      jsonPayload: { type: 'ai.jobFailed', title: 'An AI site job failed', orgId: 'o1', link: '/admin/orgs/o1' },
    })
    expect(body.entries[0].jsonPayload.environment).toEqual(expect.any(String))
  })

  it('a must-know is an error', async () => {
    await writeOperatorAlertLog({ ...alert, tier: 'must' })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).entries[0].severity).toBe('ERROR')
  })

  it('writes nothing without a credential, and never throws when Logging is down', async () => {
    target = null
    expect(await writeOperatorAlertLog(alert)).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    target = { token: 'tok', projectId: 'p' }
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'))
    expect(await writeOperatorAlertLog(alert)).toBe(false)
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403 })
    expect(await writeOperatorAlertLog(alert)).toBe(false)
  })
})
