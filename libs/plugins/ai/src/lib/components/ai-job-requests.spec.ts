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

const mockCalls: Array<{ url: string; body: Record<string, unknown> }> = []

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  __esModule: true,
  authorizedFetch: async (_user: unknown, url: string, init: { body: string }) => {
    mockCalls.push({ url, body: JSON.parse(init.body) })
    return { ok: true, status: 200, json: async () => ({ job: null }) }
  },
}))

import { resumeAiJobRequest } from './ai-job-requests'

const job = { id: 'job-1', hostId: 'host-1' }

describe('resumeAiJobRequest', () => {
  beforeEach(() => {
    mockCalls.length = 0
  })

  it('sends the plan switches the owner turned off, so the door can honour them', async () => {
    await resumeAiJobRequest(null, 'org-1', job, { plan: { addPage: false, pictures: false } })
    expect(mockCalls).toHaveLength(1)
    expect(mockCalls[0].url).toBe('/api/ai/jobs/job-1/resume')
    expect(mockCalls[0].body['plan']).toEqual({ addPage: false, pictures: false })
  })

  it('sends a switch left on as on, and only the switches given', async () => {
    await resumeAiJobRequest(null, 'org-1', job, { plan: { addPage: true } })
    expect(mockCalls[0].body['plan']).toEqual({ addPage: true })
  })

  it('sends no plan when there is none to answer', async () => {
    await resumeAiJobRequest(null, 'org-1', job, { finish: 'improve', wording: true })
    expect(mockCalls[0].body).not.toHaveProperty('plan')
    expect(mockCalls[0].body).toMatchObject({ orgId: 'org-1', hostId: 'host-1', finish: 'improve', wording: true })
  })
})
