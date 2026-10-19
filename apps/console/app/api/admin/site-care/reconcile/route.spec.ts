/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom, where `Request` is not a
 * constructor.
 *
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
 * `/api/admin/site-care/reconcile` (AGL-3959): the daily comparison of Site
 * Care charges with Stripe. Cron-secret only; a GET is a dry run; a POST
 * records the beat and may raise; a run that could not read a workspace
 * answers 207 so the workflow goes red instead of reading as clean.
 */

export {}

const mockReconcile = jest.fn()
const mockBeat = jest.fn<Promise<void>, [unknown]>(async () => undefined)

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: jest.requireActual('@aglyn/aglyn/app-utils/api-adapter').pluginRequestFromWeb,
}))
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => ({}) }) },
}))
jest.mock('@aglyn/tenant-data-admin/server/site-care-reconcile', () => ({
  __esModule: true,
  reconcileSiteCare: (...args: unknown[]) => mockReconcile(...args),
}))
jest.mock('../../../../../utils/cron-beat', () => ({
  __esModule: true,
  recordCronBeat: (id: unknown) => mockBeat(id),
}))

import { GET, POST, SITE_CARE_RECONCILE_JOB_ID } from './route'

const REPORT = { months: ['2026-10', '2026-09'], orgs: 1, requests: 2, findings: [], alerted: 0, errors: [] }

function request(method: 'GET' | 'POST', secret: string | null = 'cron-secret', query = '') {
  return new Request(`https://console.test/api/admin/site-care/reconcile${query}`, {
    method,
    headers: secret ? { 'x-cron-secret': secret } : {},
  })
}

const saved = process.env.CRON_SECRET
beforeEach(() => {
  jest.clearAllMocks()
  process.env.CRON_SECRET = 'cron-secret'
  mockReconcile.mockResolvedValue(REPORT)
})
afterAll(() => {
  if (saved === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = saved
})

describe('the reconcile cron', () => {
  it('is not scheduled without a secret, and refuses a wrong one', async () => {
    delete process.env.CRON_SECRET
    expect((await POST(request('POST'))).status).toBe(501)
    process.env.CRON_SECRET = 'cron-secret'
    expect((await POST(request('POST', 'wrong'))).status).toBe(401)
    expect((await POST(request('POST', null))).status).toBe(401)
    expect(mockReconcile).not.toHaveBeenCalled()
  })

  it('runs a GET dry, with no beat', async () => {
    const response = await GET(request('GET'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ dryRun: true, ...REPORT })
    expect(mockReconcile).toHaveBeenCalledWith({}, { dryRun: true })
    expect(mockBeat).not.toHaveBeenCalled()
  })

  it('records the beat and raises on a POST', async () => {
    const response = await POST(request('POST'))
    expect(response.status).toBe(200)
    expect(mockBeat).toHaveBeenCalledWith(SITE_CARE_RECONCILE_JOB_ID)
    expect(mockReconcile).toHaveBeenCalledWith({}, { dryRun: false })
  })

  it('answers 207 when a workspace could not be read', async () => {
    mockReconcile.mockResolvedValue({ ...REPORT, errors: ['org-1: Stripe is down'] })
    expect((await POST(request('POST'))).status).toBe(207)
  })
})
