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

import { FakeFirestore } from '../testing/fake-firestore'

let mockDb: FakeFirestore
const mockVerify = jest.fn()
const mockOrg = jest.fn()

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: jest.requireActual('../testing/fake-firestore').FAKE_FIELD_VALUE,
  Timestamp: { fromMillis: (ms: number) => ({ toMillis: () => ms }) },
}))
jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => {
  class EmailNotVerifiedError extends Error {}
  return {
    EmailNotVerifiedError,
    firebaseAdmin: { app: () => ({ firestore: () => mockDb }) },
    verifyConsoleIdToken: (token: string) => mockVerify(token),
  }
})
jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  getOrgForHost: (hostId: string) => mockOrg(hostId),
}))

import {
  registerPluginResourceDraftWriter,
  type PluginResourceDraftWriter,
} from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { registerPluginTextGenerator } from '@aglyn/aglyn/plugin-manager/plugin-text-generation'
import {
  funnelsActHandler,
  funnelsDeleteHandler,
  funnelsProposeHandler,
  funnelsResultsHandler,
  funnelsSaveHandler,
} from './funnels-api'

type Handler = typeof funnelsSaveHandler

async function call(handler: Handler, body: Record<string, unknown>, token: string | null = 'tok') {
  const res: any = {
    code: 0,
    body: undefined,
    status(code: number) {
      this.code = code
      return this
    },
    json(payload: unknown) {
      this.body = payload
    },
  }
  await handler(
    {
      method: 'POST',
      body,
      query: {},
      headers: token ? { authorization: `Bearer ${token}` } : {},
      cookies: {},
    } as never,
    res,
  )
  return res as { code: number; body: any }
}

const FUNNEL = {
  name: 'Pricing to contact',
  steps: [
    { type: 'page', key: '/pricing', match: 'exact' },
    { type: 'form', key: 'f1' },
  ],
}

function site(role: string | null, extra: Record<string, unknown> = {}) {
  mockDb = new FakeFirestore()
    .seed('hosts/h1', {
      memberRoles: role ? { u1: role } : {},
      screens: { s1: '/pricing', s2: '/contact' },
      ...extra,
    })
    .seed('hosts/h1/forms/f1', { displayName: 'Contact' })
}

beforeEach(() => {
  mockVerify.mockReset().mockResolvedValue({ uid: 'u1' })
  mockOrg.mockReset().mockResolvedValue({ orgId: 'o1', org: { plan: 'pro' } })
  site('admin')
})

describe('the funnels doors’ gates (AGL-3605)', () => {
  it('refuses a request with no token', async () => {
    expect((await call(funnelsSaveHandler, { hostId: 'h1', funnel: FUNNEL }, null)).code).toBe(401)
  })

  it('refuses a refused token', async () => {
    mockVerify.mockRejectedValue(new Error('bad'))
    expect((await call(funnelsResultsHandler, { hostId: 'h1', funnelId: 'x' })).code).toBe(401)
  })

  it('refuses someone who is not a member of the site', async () => {
    site(null)
    expect((await call(funnelsResultsHandler, { hostId: 'h1', funnelId: 'x', from: '2026-10-01', to: '2026-10-02' })).code).toBe(403)
  })

  it.each(['author', 'viewer'])('lets an %s read results but not change funnels', async (role) => {
    site(role)
    expect((await call(funnelsSaveHandler, { hostId: 'h1', funnel: FUNNEL })).code).toBe(403)
    expect((await call(funnelsDeleteHandler, { hostId: 'h1', funnelId: 'x' })).code).toBe(403)
    expect((await call(funnelsProposeHandler, { hostId: 'h1', brief: 'x' })).code).toBe(403)
  })

  it('refuses a workspace whose plan has no per-page analytics', async () => {
    mockOrg.mockResolvedValue({ orgId: 'o1', org: { plan: 'starter' } })
    const response = await call(funnelsSaveHandler, { hostId: 'h1', funnel: FUNNEL })
    expect(response.code).toBe(403)
    expect(response.body.reason).toBe('entitlement')
    expect(
      (await call(funnelsResultsHandler, { hostId: 'h1', funnelId: 'x', from: '2026-10-01', to: '2026-10-02' })).code,
    ).toBe(403)
  })
})

describe('saving and deleting (AGL-3605)', () => {
  it('saves a checked funnel, labels steps from the site and switches recording on once', async () => {
    const first = await call(funnelsSaveHandler, { hostId: 'h1', funnel: FUNNEL })
    expect(first.code).toBe(200)
    expect(first.body.recordingChanged).toBe(true)
    expect(mockDb.docs.get('hosts/h1')?.['funnelRecording']).toBe(true)
    const saved = mockDb.docs.get(`hosts/h1/funnels/${first.body.funnelId}`)
    expect(saved?.['steps'][1]).toEqual({ type: 'form', key: 'f1', label: 'Contact' })
    expect(saved?.['createdBy']).toBe('u1')

    mockDb.docs.get('hosts/h1')!['funnelRecording'] = true
    const second = await call(funnelsSaveHandler, { hostId: 'h1', funnel: FUNNEL })
    expect(second.body.recordingChanged).toBe(false)
  })

  it('refuses a step the site does not have, naming the step', async () => {
    const response = await call(funnelsSaveHandler, {
      hostId: 'h1',
      funnel: { ...FUNNEL, steps: [FUNNEL.steps[0], { type: 'page', key: '/gone' }] },
    })
    expect(response.code).toBe(400)
    expect(response.body.error).toMatch(/^Step 2:/)
  })

  it('refuses a twenty-first funnel', async () => {
    for (let index = 0; index < 20; index += 1) mockDb.seed(`hosts/h1/funnels/f${index}`, FUNNEL)
    expect((await call(funnelsSaveHandler, { hostId: 'h1', funnel: FUNNEL })).code).toBe(409)
  })

  it('refuses an edit of a funnel that does not exist', async () => {
    expect((await call(funnelsSaveHandler, { hostId: 'h1', funnelId: 'nope', funnel: FUNNEL })).code).toBe(404)
  })

  it('switches recording off when the last funnel goes, and not before', async () => {
    site('editor', { funnelRecording: true })
    mockDb.seed('hosts/h1/funnels/a', FUNNEL).seed('hosts/h1/funnels/b', FUNNEL)
    expect((await call(funnelsDeleteHandler, { hostId: 'h1', funnelId: 'a' })).body.recordingChanged).toBe(false)
    const last = await call(funnelsDeleteHandler, { hostId: 'h1', funnelId: 'b' })
    expect(last.body.recordingChanged).toBe(true)
    expect(mockDb.docs.get('hosts/h1')?.['funnelRecording']).toBe(false)
  })
})

describe('results (AGL-3605)', () => {
  it('computes a saved funnel over a range', async () => {
    mockDb.seed('hosts/h1/funnels/f1', { ...FUNNEL, updatedAt: { toMillis: () => 5 } })
    const at = Date.parse('2026-10-01T10:00:00Z')
    mockDb.seed('hosts/h1/funnelJourneys/v1', {
      startedAt: { toMillis: () => at },
      steps: [{ t: 'page', k: '/pricing', at }, { t: 'form', k: 'f1', at: at + 60_000 }],
    })
    const response = await call(funnelsResultsHandler, { hostId: 'h1', funnelId: 'f1', from: '2026-10-01', to: '2026-10-02' })
    expect(response.code).toBe(200)
    expect(response.body.result).toMatchObject({ entered: 1, completed: 1, overall: 1 })
    expect(response.body.result.steps[1].medianMsFromPrevious).toBe(60_000)
  })

  it('refuses a range wider than the visits are kept', async () => {
    mockDb.seed('hosts/h1/funnels/f1', FUNNEL)
    expect((await call(funnelsResultsHandler, { hostId: 'h1', funnelId: 'f1', from: '2026-01-01', to: '2026-10-02' })).code).toBe(400)
  })
})

describe('Create with AI (AGL-3605)', () => {
  it('answers a draft checked against the site, through the workspace’s generator', async () => {
    const generate = jest.fn().mockResolvedValue({
      ok: true,
      text: JSON.stringify({ name: 'Draft', steps: [{ type: 'page', key: '/pricing' }, { type: 'form', key: 'f1' }, { type: 'form', key: 'ghost' }] }),
      model: 'm',
      usage: { inputTokens: 1, outputTokens: 1 },
    })
    registerPluginTextGenerator({ generate }, { pluginId: 'ai' })
    const response = await call(funnelsProposeHandler, { hostId: 'h1', brief: 'pricing then contact' })
    expect(response.code).toBe(200)
    expect(response.body.draft.steps).toHaveLength(2)
    expect(response.body.dropped).toHaveLength(1)
    expect(generate.mock.calls[0][0]).toMatchObject({ orgId: 'o1', hostId: 'h1', uid: 'u1', purpose: 'funnels-propose' })
    expect(generate.mock.calls[0][0].prompt).toContain('f1 — Contact')
    expect(mockDb.writes).toEqual([])
  })

  it('passes a generator’s refusal through as it stands', async () => {
    registerPluginTextGenerator(
      { generate: async () => ({ ok: false, status: 402, reason: 'quota', error: 'Out of credits' }) },
      { pluginId: 'ai' },
    )
    const response = await call(funnelsProposeHandler, { hostId: 'h1', brief: 'x' })
    expect(response).toMatchObject({ code: 402, body: { error: 'Out of credits', reason: 'quota' } })
  })
})

describe('Act on this drop-off (AGL-3605)', () => {
  const NOW = Date.now()
  let writer: jest.Mocked<PluginResourceDraftWriter>

  function withFunnel(extra: Record<string, unknown> = {}) {
    mockDb.seed('hosts/h1/funnels/fx', { ...FUNNEL, ...extra })
  }

  beforeEach(() => {
    resetPluginServicesForTests()
    writer = {
      refusal: jest.fn().mockResolvedValue(null),
      check: jest.fn().mockReturnValue({ ok: true, facts: {} }),
      read: jest.fn().mockResolvedValue(null),
      write: jest.fn().mockImplementation(async (request) => ({
        ok: true,
        replayed: false,
        id: request.id,
        name: request.name,
        versionId: null,
        facts: {},
      })),
    }
    registerPluginResourceDraftWriter('automation', writer, { pluginId: 'workflows' })
    withFunnel()
  })

  const act = (body: Record<string, unknown> = {}) =>
    call(funnelsActHandler, { hostId: 'h1', funnelId: 'fx', step: 1, afterHours: 24, action: 'email', ...body })

  it('drafts the automation switched off through the automation writer, and watches the step', async () => {
    mockDb.seed('hosts/h1/funnelJourneys/recent', { personEmail: 'ada@example.com', identifiedAt: NOW - 60_000 })
    const response = await act()
    expect(response.code).toBe(200)
    expect(writer.write).toHaveBeenCalledTimes(1)
    const request = writer.write.mock.calls[0][0]
    expect(request).toMatchObject({ orgId: 'o1', hostId: 'h1', uid: 'u1' })
    expect((request.content['action'] as any).trigger.event).toBe('funnelLeft')
    expect(response.body).toMatchObject({ automationId: request.id, replayed: false })
    expect(mockDb.docs.get('hosts/h1/funnels/fx')?.['dropOffWatches']).toEqual([{ step: 1, afterHours: 24 }])
    // A person identified within the wait is looked at on the next tick.
    expect(mockDb.docs.get('hosts/h1/funnelJourneys/recent')?.['dropOffCheckAt']).toEqual(expect.any(Number))
  })

  it('keeps one watch per step and wait however many automations start on it', async () => {
    withFunnel({ dropOffWatches: [{ step: 1, afterHours: 24 }] })
    expect((await act({ action: 'task' })).code).toBe(200)
    expect(mockDb.docs.get('hosts/h1/funnels/fx')?.['dropOffWatches']).toEqual([{ step: 1, afterHours: 24 }])
  })

  it('passes the writer’s refusal through, and writes nothing', async () => {
    writer.refusal.mockResolvedValue({ status: 403, error: 'Automations are not included on this workspace’s plan.' })
    const response = await act()
    expect(response).toMatchObject({ code: 403, body: { error: 'Automations are not included on this workspace’s plan.' } })
    expect(writer.write).not.toHaveBeenCalled()
    expect(mockDb.docs.get('hosts/h1/funnels/fx')).not.toHaveProperty('dropOffWatches')
  })

  it('refuses a step with no step after it, a wait out of range and an unknown action', async () => {
    expect((await act({ step: 2 })).code).toBe(400)
    expect((await act({ afterHours: 0 })).code).toBe(400)
    expect((await act({ action: 'sms' })).code).toBe(400)
    expect(writer.write).not.toHaveBeenCalled()
  })

  it('answers that automations are unavailable when no plugin writes them', async () => {
    resetPluginServicesForTests()
    expect((await act()).code).toBe(404)
  })

  it.each(['author', 'viewer'])('is not for an %s', async (role) => {
    site(role)
    withFunnel()
    expect((await act()).code).toBe(403)
  })
})
