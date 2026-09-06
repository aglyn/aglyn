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
 * `POST /api/crm/deal-stage` moves a deal and tells the automations
 * (AGL-2598).
 *
 * Four contracts:
 *
 *  1. THE GATES REFUSE. No session is 401; a member without `data.manage`
 *     is 403; a deal another site cannot see is 403. None of those writes.
 *  2. A MOVE WRITES THE STAGE AND EMITS `dealStageChanged` with the flat
 *     payload — including the stage the deal LEFT, which is what a filter
 *     like `previousStageId == "proposal-sent"` needs.
 *  3. `status: 'won'` and `status: 'lost'` resolve the pipeline's closing
 *     stage themselves, stamp `closedAtMs`, and emit `dealWon` / `dealLost`;
 *     a loss keeps the reason and puts it on the event.
 *  4. A STAGE THE PIPELINE DOES NOT HAVE is 400, and a drop onto the stage
 *     the deal is already in is a no-op that fires nothing.
 *
 * The Admin SDK, the org resolver and the event emitter are doubled; the
 * route's own resolution — roles, permission, scope, stage lookup — runs
 * for real.
 */

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { delete: () => '__delete' },
}))

const emitted: Array<{
  hostId: string
  event: string
  payload: Record<string, unknown>
}> = []
jest.mock('@aglyn/tenant-runtime', () => ({
  emitHostEvent: async (
    hostId: string,
    event: string,
    payload: Record<string, unknown>,
  ) => {
    emitted.push({ hostId, event, payload })
    return { alerts: [] }
  },
}))

const state = {
  member: { role: 'editor', allHosts: true } as Record<string, unknown> | null,
  permitted: true,
  deals: {} as Record<string, Record<string, unknown>>,
  pipelines: {} as Record<string, Record<string, unknown>>,
  updates: [] as Array<{ id: string; patch: Record<string, unknown> }>,
}

const docHandle = (store: Record<string, Record<string, unknown>>, id: string) => ({
  get: async () => ({
    exists: Boolean(store[id]),
    data: () => store[id],
  }),
  update: async (patch: Record<string, unknown>) => {
    state.updates.push({ id, patch })
    Object.assign(store[id], patch)
  },
})

const fakeFirestore = {
  collection: (name: string) => {
    expect(name).toBe('orgs')
    return {
      doc: (orgId: string) => {
        expect(orgId).toBe('org-1')
        return {
          collection: (sub: string) => ({
            doc: (id: string) =>
              docHandle(sub === 'deals' ? state.deals : state.pipelines, id),
          }),
        }
      },
    }
  },
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async (token: string) => {
          if (token !== 'good') throw new Error('bad token')
          return { uid: 'u1' }
        },
      }),
      firestore: () => fakeFirestore,
    }),
  },
  getOrgForHost: async (hostId: string) =>
    hostId === 'shop' || hostId === 'other-shop'
      ? { orgId: 'org-1', org: {} }
      : null,
  resolveOrgMembership: async () =>
    state.member ? { orgId: 'org-1', member: state.member } : null,
  memberHasOrgPermission: async () => state.permitted,
  consentGroupForSite: async (hostId: string) => ({
    hostId,
    groupId: hostId,
    name: null,
    hostIds: [hostId],
    declared: false,
  }),
}))

import { DEFAULT_DEAL_STAGES } from '@aglyn/aglyn'
import { resolvePluginApiRoute } from '@aglyn/aglyn/server'
import { registerCrmConsoleApi } from './server'
import { crmDealStageHandler } from './server-deal-stage'

async function call(
  body: Record<string, unknown>,
  options: { method?: string; token?: string | null } = {},
) {
  let status = 0
  let answer: any
  const headers: Record<string, unknown> = {}
  const res: any = {
    status: (code: number) => {
      status = code
      return res
    },
    json: (value: unknown) => {
      answer = value
    },
    send: (value: unknown) => {
      answer = value
    },
    setHeader: (name: string, value: unknown) => {
      headers[name] = value
    },
    redirect: () => undefined,
    end: () => undefined,
  }
  const token = options.token === undefined ? 'good' : options.token
  await crmDealStageHandler(
    {
      method: options.method ?? 'POST',
      query: {},
      body,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      cookies: {},
      socket: {},
    },
    res,
  )
  return { status, body: answer, headers }
}

beforeEach(() => {
  emitted.length = 0
  state.updates.length = 0
  state.member = { role: 'editor', allHosts: true }
  state.permitted = true
  state.pipelines = {
    default: { name: 'Sales', stages: [...DEFAULT_DEAL_STAGES], isDefault: true },
  }
  state.deals = {
    d1: {
      title: 'Roaster upgrade',
      pipelineId: 'default',
      stageId: 'proposal-sent',
      status: 'open',
      amountCents: 250_000,
      currency: 'usd',
      ownerUid: 'u9',
      contactId: 'c1',
      visibleTo: ['host:shop'],
      hostId: 'shop',
    },
  }
})

describe('the deal-stage route (AGL-2598)', () => {
  it('is registered under crm/deal-stage', () => {
    registerCrmConsoleApi()
    expect(resolvePluginApiRoute('crm/deal-stage')).toBe(crmDealStageHandler)
  })

  it('refuses a GET, a missing session, and a member without data.manage', async () => {
    const get = await call({ hostId: 'shop', dealId: 'd1', stageId: 'negotiation' }, { method: 'GET' })
    expect(get.status).toBe(405)
    expect(get.headers['Allow']).toBe('POST')

    const anonymous = await call(
      { hostId: 'shop', dealId: 'd1', stageId: 'negotiation' },
      { token: null },
    )
    expect(anonymous.status).toBe(401)

    state.permitted = false
    const unpermitted = await call({ hostId: 'shop', dealId: 'd1', stageId: 'negotiation' })
    expect(unpermitted.status).toBe(403)

    state.permitted = true
    state.member = { role: 'viewer', allHosts: true }
    const viewer = await call({ hostId: 'shop', dealId: 'd1', stageId: 'negotiation' })
    expect(viewer.status).toBe(403)

    expect(state.updates).toEqual([])
    expect(emitted).toEqual([])
  })

  it('refuses a deal the calling site cannot see', async () => {
    const { status, body } = await call({
      hostId: 'other-shop',
      dealId: 'd1',
      stageId: 'negotiation',
    })
    expect(status).toBe(403)
    expect(body.error).toMatch(/not visible/)
    expect(state.updates).toEqual([])
    expect(emitted).toEqual([])
  })

  it('moves a deal to a stage and emits dealStageChanged with the stage it left', async () => {
    const { status, body } = await call({
      hostId: 'shop',
      dealId: 'd1',
      stageId: 'negotiation',
    })
    expect(status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      dealId: 'd1',
      stageId: 'negotiation',
      status: 'open',
      previousStageId: 'proposal-sent',
      event: 'dealStageChanged',
    })

    expect(state.updates).toHaveLength(1)
    const patch = state.updates[0].patch
    expect(patch['stageId']).toBe('negotiation')
    expect(patch['status']).toBe('open')
    expect(typeof patch['stageChangedAtMs']).toBe('number')
    expect(patch['closedAtMs']).toBeNull()
    // A reopened or moved deal carries no stale loss reason.
    expect(patch['lostReason']).toBe('__delete')

    expect(emitted).toEqual([
      {
        hostId: 'shop',
        event: 'dealStageChanged',
        payload: {
          dealId: 'd1',
          title: 'Roaster upgrade',
          amountCents: 250_000,
          currency: 'usd',
          stageId: 'negotiation',
          previousStageId: 'proposal-sent',
          ownerUid: 'u9',
          contactId: 'c1',
          companyId: '',
        },
      },
    ])
  })

  it('wins through status, stamping closedAtMs and emitting dealWon', async () => {
    const { status, body } = await call({ hostId: 'shop', dealId: 'd1', status: 'won' })
    expect(status).toBe(200)
    expect(body).toMatchObject({ stageId: 'won', status: 'won', event: 'dealWon' })
    const patch = state.updates[0].patch
    expect(patch['status']).toBe('won')
    expect(typeof patch['closedAtMs']).toBe('number')
    expect(emitted[0].event).toBe('dealWon')
    expect(emitted[0].payload['stageId']).toBe('won')
    expect(emitted[0].payload['previousStageId']).toBe('proposal-sent')
  })

  it('loses through status, keeping the reason and putting it on dealLost', async () => {
    const { status, body } = await call({
      hostId: 'shop',
      dealId: 'd1',
      status: 'lost',
      lostReason: 'Went with a competitor',
    })
    expect(status).toBe(200)
    expect(body).toMatchObject({ stageId: 'lost', status: 'lost', event: 'dealLost' })
    const patch = state.updates[0].patch
    expect(patch['status']).toBe('lost')
    expect(patch['lostReason']).toBe('Went with a competitor')
    expect(emitted[0].event).toBe('dealLost')
    expect(emitted[0].payload['lostReason']).toBe('Went with a competitor')
  })

  it('refuses a stage the pipeline does not have, writing nothing', async () => {
    const { status } = await call({ hostId: 'shop', dealId: 'd1', stageId: 'demo' })
    expect(status).toBe(400)
    expect(state.updates).toEqual([])
    expect(emitted).toEqual([])
  })

  it('treats a drop onto the current stage as a no-op that fires nothing', async () => {
    const { status, body } = await call({
      hostId: 'shop',
      dealId: 'd1',
      stageId: 'proposal-sent',
    })
    expect(status).toBe(200)
    expect(body.event).toBeNull()
    expect(state.updates).toEqual([])
    expect(emitted).toEqual([])
  })
})
