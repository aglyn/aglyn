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
 *  5. A WIN MAKES THE CONTACT A CUSTOMER (AGL-2641): the transition into
 *     `won` floors the linked contact's stage at `customer` in the facet of
 *     the deal's site, never demotes a later stage, announces
 *     `contactStageChanged` only when the stage moved, and leaves the
 *     contact alone on every other transition.
 *
 * The Admin SDK, the org resolver and the event emitter are doubled; the
 * route's own resolution — roles, permission, scope, stage lookup — and the
 * stage floor itself run for real.
 */

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { delete: () => '__delete', serverTimestamp: () => '__now' },
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
  contacts: {} as Record<string, Record<string, unknown>>,
  updates: [] as Array<{ id: string; patch: Record<string, unknown> }>,
  /** Every write to a contact — the customer floor's, and nothing else's (AGL-2641). */
  contactUpdates: [] as Array<{ id: string; patch: Record<string, unknown> }>,
  /** What the org resolver answers the ORG variant (AGL-2634). */
  orgPermissions: {} as Record<string, unknown>,
  orgLines: [] as Array<{ orgId: string; actor: unknown; action: string; target: unknown }>,
  /** The org document both variants read; Starter is the lowest plan carrying the CRM suite. */
  org: { plan: 'starter' } as Record<string, unknown>,
}

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async () => state.orgPermissions,
}))

const docHandle = (
  store: Record<string, Record<string, unknown>>,
  id: string,
  sink: Array<{ id: string; patch: Record<string, unknown> }>,
) => {
  const ref = {
    id,
    get: async () => ({
      id,
      exists: Boolean(store[id]),
      data: () => store[id],
      ref,
    }),
    update: async (patch: Record<string, unknown>) => {
      sink.push({ id, patch })
      Object.assign(store[id], patch)
    },
  }
  return ref
}

const fakeFirestore = {
  collection: (name: string) => {
    expect(name).toBe('orgs')
    return {
      doc: (orgId: string) => {
        expect(orgId).toBe('org-1')
        return {
          collection: (sub: string) => ({
            doc: (id: string) =>
              sub === 'contacts'
                ? docHandle(state.contacts, id, state.contactUpdates)
                : docHandle(sub === 'deals' ? state.deals : state.pipelines, id, state.updates),
          }),
        }
      },
    }
  },
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  // The REAL floor (AGL-2641), over the contacts store above: what the
  // route proves is that it calls it, on the right site, on a win alone.
  floorContactLifecycleStage: jest.requireActual(
    '@aglyn/tenant-data-admin/server/contact-lifecycle-floor',
  ).floorContactLifecycleStage,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async (token: string) => {
          // A support engineer's token, which the org variant admits.
          if (token === 'staff') return { uid: 'staff-1', staff: true }
          if (token !== 'good') throw new Error('bad token')
          return { uid: 'u1' }
        },
      }),
      firestore: () => fakeFirestore,
    }),
  },
  getOrgForHost: async (hostId: string) =>
    hostId === 'shop' || hostId === 'other-shop'
      ? { orgId: 'org-1', org: state.org }
      : null,
  resolveOrgMembership: async () =>
    state.member ? { orgId: 'org-1', member: state.member } : null,
  memberHasOrgPermission: async () => state.permitted,
  getOrgDoc: async (orgId: string) =>
    orgId === 'org-1' ? { $id: 'org-1', ...state.org } : null,
  logOrgActivity: async (orgId: string, actor: unknown, action: string, target: unknown) => {
    state.orgLines.push({ orgId, actor, action, target })
  },
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
  state.contactUpdates.length = 0
  state.orgLines.length = 0
  state.org = { plan: 'starter' }
  state.member = { role: 'editor', allHosts: true }
  state.permitted = true
  state.orgPermissions = {
    orgId: 'org-1',
    role: 'editor',
    isOwner: false,
    permissions: { 'data.manage': true },
    orgWide: true,
    hostRole: 'editor',
  }
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
  // The deal's contact: a prospect the shop holds, one stage short of a sale.
  state.contacts = {
    c1: {
      email: 'maya@example.com',
      hostId: 'shop',
      visibleTo: ['host:shop'],
      facets: { shop: { sources: { form: true }, interactions: [], lifecycleStage: 'sales-qualified' } },
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

  /*
   * THE CUSTOMER FLOOR (AGL-2641). A won deal is a purchase the business
   * decided on, and the contact's stage says so from this write on.
   */
  it('makes the contact a customer on a win — the site’s facet, then contactStageChanged', async () => {
    const { body } = await call({ hostId: 'shop', dealId: 'd1', status: 'won' })
    expect(state.contactUpdates).toEqual([
      { id: 'c1', patch: { 'facets.shop.lifecycleStage': 'customer', updatedAt: '__now' } },
    ])
    expect(body.customer).toEqual({ contactId: 'c1', lifecycleStage: 'customer', advanced: true })
    // The cause first, then its effect, both to the deal's own site.
    expect(emitted.map((entry) => [entry.hostId, entry.event])).toEqual([
      ['shop', 'dealWon'],
      ['shop', 'contactStageChanged'],
    ])
    expect(emitted[1].payload).toEqual({
      contactId: 'c1',
      email: 'maya@example.com',
      lifecycleStage: 'customer',
      previousStage: 'sales-qualified',
    })
  })

  it.each(['customer', 'evangelist', 'other'])(
    'never demotes a contact already at %s, and announces no stage change',
    async (stage) => {
      ;(state.contacts['c1']['facets'] as any).shop.lifecycleStage = stage
      const { body } = await call({ hostId: 'shop', dealId: 'd1', status: 'won' })
      expect(state.contactUpdates).toEqual([])
      expect(body.customer).toEqual({ contactId: 'c1', lifecycleStage: stage, advanced: false })
      expect(emitted.map((entry) => entry.event)).toEqual(['dealWon'])
    },
  )

  it('leaves the contact alone on a move, a loss and a reopen', async () => {
    await call({ hostId: 'shop', dealId: 'd1', stageId: 'negotiation' })
    const lost = await call({ hostId: 'shop', dealId: 'd1', status: 'lost', lostReason: 'Budget' })
    const reopened = await call({ hostId: 'shop', dealId: 'd1', stageId: 'qualified' })
    expect(state.contactUpdates).toEqual([])
    expect(lost.body.customer).toBeNull()
    expect(reopened.body.customer).toBeNull()
    expect(emitted.map((entry) => entry.event)).toEqual([
      'dealStageChanged',
      'dealLost',
      'dealStageChanged',
    ])
  })

  it('wins a deal that names no contact, or whose contact is gone, with customer null', async () => {
    delete state.deals['d1']['contactId']
    const orphan = await call({ hostId: 'shop', dealId: 'd1', status: 'won' })
    expect(orphan.status).toBe(200)
    expect(orphan.body.customer).toBeNull()
    state.deals['d1'] = { ...state.deals['d1'], stageId: 'qualified', status: 'open', contactId: 'gone' }
    const missing = await call({ hostId: 'shop', dealId: 'd1', status: 'won' })
    expect(missing.status).toBe(200)
    expect(missing.body.customer).toBeNull()
    expect(state.contactUpdates).toEqual([])
    expect(emitted.map((entry) => entry.event)).toEqual(['dealWon', 'dealWon'])
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

/**
 * THE ORGANIZATION VARIANT (AGL-2634): `orgId` in the body instead of a
 * site. Authorized by the org — an org-wide member holding `data.manage`,
 * never a site collaborator — with no site to check the deal's visibility
 * against, because an org-wide member reads every row. The event still
 * goes to the deal's OWN site, which is where its automations live; the
 * line goes to the org's feed, which is the feed the act was performed in.
 */
describe('the deal-stage route at the organization level (AGL-2634)', () => {
  const ORG = { orgId: 'org-1', dealId: 'd1' }

  it('moves a deal another site captured, emits for the deal’s own site, and logs the org line', async () => {
    // No site role at all — the org variant does not consult one.
    state.member = null
    const { status, body } = await call({ ...ORG, stageId: 'negotiation' })
    expect(status).toBe(200)
    expect(body).toMatchObject({ ok: true, stageId: 'negotiation', event: 'dealStageChanged' })
    expect(state.updates[0].patch['stageId']).toBe('negotiation')
    expect(emitted).toHaveLength(1)
    expect(emitted[0].hostId).toBe('shop')
    expect(state.orgLines).toEqual([
      {
        orgId: 'org-1',
        actor: { uid: 'u1', email: null },
        action: 'Moved deal to Negotiation',
        target: { type: 'deal', id: 'd1', name: 'Roaster upgrade' },
      },
    ])
  })

  it('names the win and the loss in the org line', async () => {
    // A contact already a customer: the win raised nobody, and the line says only the win.
    ;(state.contacts['c1']['facets'] as any).shop.lifecycleStage = 'customer'
    await call({ ...ORG, status: 'won' })
    expect(state.orgLines[0].action).toBe('Marked deal won')
    state.deals['d1']['stageId'] = 'proposal-sent'
    state.deals['d1']['status'] = 'open'
    await call({ ...ORG, status: 'lost', lostReason: 'Budget cut' })
    expect(state.orgLines[1].action).toBe('Marked deal lost')
    expect(emitted.map((entry) => entry.event)).toEqual(['dealWon', 'dealLost'])
  })

  it('refuses a site-scoped member and an org-wide one without data.manage, writing nothing', async () => {
    state.orgPermissions = { ...state.orgPermissions, orgWide: false, hostRole: 'admin' }
    expect((await call({ ...ORG, stageId: 'negotiation' })).status).toBe(403)
    state.orgPermissions = {
      ...state.orgPermissions,
      orgWide: true,
      permissions: { 'data.manage': false },
    }
    expect((await call({ ...ORG, stageId: 'negotiation' })).status).toBe(403)
    expect(state.updates).toEqual([])
    expect(emitted).toEqual([])
    expect(state.orgLines).toEqual([])
  })

  it('moves a deal no site captured, with no event to emit and the org line still written', async () => {
    delete state.deals['d1']['hostId']
    state.deals['d1']['visibleTo'] = ['org']
    const { status, body } = await call({ ...ORG, stageId: 'negotiation' })
    expect(status).toBe(200)
    expect(body.event).toBe('dealStageChanged')
    expect(emitted).toEqual([])
    expect(state.orgLines).toHaveLength(1)
  })

  it('floors the contact in the deal’s own site’s facet on an org-level win, and the line says so', async () => {
    state.member = null
    const { body } = await call({ ...ORG, status: 'won' })
    expect(state.contactUpdates).toEqual([
      { id: 'c1', patch: { 'facets.shop.lifecycleStage': 'customer', updatedAt: '__now' } },
    ])
    expect(body.customer).toEqual({ contactId: 'c1', lifecycleStage: 'customer', advanced: true })
    expect(emitted.map((entry) => [entry.hostId, entry.event])).toEqual([
      ['shop', 'dealWon'],
      ['shop', 'contactStageChanged'],
    ])
    expect(state.orgLines[0].action).toBe('Marked deal won — contact now a customer')
  })

  it('wins a deal no site captured through the contact’s own site — no dealWon, but the stage still moves', async () => {
    delete state.deals['d1']['hostId']
    state.deals['d1']['visibleTo'] = ['org']
    const { body } = await call({ ...ORG, status: 'won' })
    expect(body.customer).toEqual({ contactId: 'c1', lifecycleStage: 'customer', advanced: true })
    expect(state.contactUpdates[0].patch).toHaveProperty(['facets.shop.lifecycleStage'], 'customer')
    // Nobody hears the win, but the site that holds the person hears the stage change.
    expect(emitted.map((entry) => [entry.hostId, entry.event])).toEqual([
      ['shop', 'contactStageChanged'],
    ])
    expect(state.orgLines[0].action).toBe('Marked deal won — contact now a customer')
  })

  it('answers a no-op with no line, and an unknown deal with 404', async () => {
    expect((await call({ ...ORG, stageId: 'proposal-sent' })).status).toBe(200)
    expect(state.orgLines).toEqual([])
    expect((await call({ orgId: 'org-1', dealId: 'nope', stageId: 'negotiation' })).status).toBe(404)
  })
})

/**
 * THE PLAN (AGL-2787). Deals are the CRM suite's, included from Starter, at
 * either level. The plan is asked once the caller is authorized, and of the
 * workspace, so staff acting at the organization level are refused as a
 * member is. A refused move writes, floors, announces and logs nothing.
 */
describe('the plan (AGL-2787)', () => {
  const expectRefused = (answer: { status: number; body: any }) => {
    expect(answer.status).toBe(403)
    expect(answer.body).toMatchObject({ reason: 'plan_required', code: 'crm' })
    expect(answer.body.error).toMatch(/part of the CRM suite/)
    expect(answer.body.error).toMatch(/Included from Starter/)
  }
  const expectNothingMoved = () => {
    expect(state.updates).toEqual([])
    expect(state.contactUpdates).toEqual([])
    expect(emitted).toEqual([])
    expect(state.orgLines).toEqual([])
  }

  it('refuses a Free workspace under a site, for a move and a win alike', async () => {
    state.org = { plan: 'free' }
    expectRefused(await call({ hostId: 'shop', dealId: 'd1', stageId: 'negotiation' }))
    expectRefused(await call({ hostId: 'shop', dealId: 'd1', status: 'won' }))
    expectNothingMoved()
  })

  it('refuses a Free workspace at the organization level', async () => {
    state.org = { plan: 'free' }
    expectRefused(await call({ orgId: 'org-1', dealId: 'd1', stageId: 'negotiation' }))
    expectRefused(await call({ orgId: 'org-1', dealId: 'd1', status: 'won' }))
    expectNothingMoved()
  })

  it('refuses staff acting inside a Free workspace the same way', async () => {
    state.org = { plan: 'free' }
    state.orgPermissions = { ...state.orgPermissions, orgWide: false, permissions: {} }
    expectRefused(
      await call({ orgId: 'org-1', dealId: 'd1', stageId: 'negotiation' }, { token: 'staff' }),
    )
    expectNothingMoved()
  })

  it('tells a member without data.manage about the permission, not the plan', async () => {
    state.org = { plan: 'free' }
    state.permitted = false
    const { status, body } = await call({ hostId: 'shop', dealId: 'd1', stageId: 'negotiation' })
    expect(status).toBe(403)
    expect(body).toEqual({ error: 'Moving a deal requires the "Manage data" permission.' })
  })

  it('admits Starter, the lowest plan that carries the suite, at both levels', async () => {
    state.org = { plan: 'starter' }
    expect((await call({ hostId: 'shop', dealId: 'd1', stageId: 'negotiation' })).status).toBe(200)
    expect((await call({ orgId: 'org-1', dealId: 'd1', stageId: 'qualified' })).status).toBe(200)
    expect(state.updates).toHaveLength(2)
  })
})
