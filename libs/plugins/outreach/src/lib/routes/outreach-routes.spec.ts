/**
 * @jest-environment node
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

import { activityTypeLabel } from '@aglyn/aglyn/app-utils/activity-presenter'
import { personKey } from '@aglyn/aglyn/app-utils/person-key'
import { isPluginActivityTargetType } from '@aglyn/aglyn/plugin-manager/plugin-activity-actions'
import type { PluginRecordActivityRequest } from '@aglyn/aglyn/plugin-manager/plugin-record-timeline'
import type {
  PluginTextGenerationRequest,
  PluginTextGenerationResult,
  PluginTextGenerator,
} from '@aglyn/aglyn/plugin-manager/plugin-text-generation'
import type { DecodedIdToken } from 'firebase-admin/auth'
import { OUTREACH_USE_PERMISSION } from '../constants/bundle-common'
import { outreachDoNotContactKey } from '../engine/do-not-contact'
import { outreachLocalDay } from '../mailboxes/mailbox-settings'
import type { OutreachEmailStep, OutreachTaskStep } from '../model/outreach.types'
import { FakeGmail } from '../runtime/fixtures/fake-gmail'
import type { OutreachRecordEmailStamp } from '../runtime/runtime-deps'
import { createOutreachDoNotContactDomainsRoute, OUTREACH_DO_NOT_CONTACT_DOMAIN_ACTIVITY } from './do-not-contact-routes'
import { createOutreachCurateRoutes, OUTREACH_CURATION_PURPOSE, outreachCuratedActivity } from './curate-routes'
import { createOutreachEnrollRoutes, type OutreachEnrollRouteDeps } from './enroll-routes'
import type { TrackingHostRecord } from '@aglyn/shared-util-email'
import {
  createOutreachLinkDomainsRoute,
  OUTREACH_LINK_DOMAIN_ACTIVITY,
  type OutreachTrackingHosts,
} from './link-domain-routes'
import { createOutreachEnrollmentActionRoute } from './enrollment-routes'
import { createOutreachPreviewRoute } from './preview-routes'
import { OUTREACH_SEQUENCE_ACTIVITY_TARGET } from './route-deps'
import type { OutreachRouteGateDeps } from './route-gate'
import { createOutreachSequenceRoutes, OUTREACH_SEQUENCE_ACTIVITY } from './sequence-routes'
import { createOutreachStepTestRoute, type OutreachStepTestDeps } from './step-test-routes'

/**
 * The sequence, enroll, enrollment and preview routes (AGL-2980), end to end
 * against an in-memory document store. Every route runs for real — the
 * engine's validator, gates, state machine and composer included — and only
 * the platform's edges are stubbed: the token verifier, the permission
 * resolver, the lockdown verdict, the activity log and the saved-view sweep.
 */

// ── In-memory Firestore ─────────────────────────────────────────────────────

type Data = Record<string, unknown>
type Docs = Map<string, Data>

const isObject = (value: unknown): value is Data =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype

/** A deep copy of plain data; anything else (a sentinel) is kept as it is. */
function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clone) as T
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)])) as T
  return value
}

const fieldOf = (data: Data | undefined, field: string) =>
  field.split('.').reduce<unknown>((node, part) => (isObject(node) ? node[part] : undefined), data)

/** Writes `value` at a dotted path, making the maps along it. */
function setField(data: Data, field: string, value: unknown): void {
  const parts = field.split('.')
  let node: Data = data
  for (const part of parts.slice(0, -1)) {
    const held = node[part]
    node[part] = isObject(held) ? { ...held } : {}
    node = node[part] as Data
  }
  node[parts[parts.length - 1]] = value
}

/** The ids a real `FieldValue.arrayUnion` carries, or `null` for any other value. */
const arrayUnionElements = (value: unknown): string[] | null =>
  value && typeof value === 'object' && value.constructor?.name === 'ArrayUnionTransform'
    ? ((value as { elements: unknown[] }).elements ?? []).map(String)
    : null

/** Whether a value is a real `FieldValue.delete()` (the cleared copy, AGL-3324). */
const isDeleteSentinel = (value: unknown): boolean =>
  Boolean(value) && typeof value === 'object' && (value as object).constructor?.name === 'DeleteTransform'

/** Removes the field at a dotted path, leaving the maps along it. */
function deleteField(data: Data, field: string): void {
  const parts = field.split('.')
  let node: Data = data
  for (const part of parts.slice(0, -1)) {
    const held = node[part]
    if (!isObject(held)) return
    node[part] = { ...held }
    node = node[part] as Data
  }
  delete node[parts[parts.length - 1]]
}

function fakeFirestore(docs: Docs) {
  let autoId = 0
  const snapshot = (path: string) => {
    const data = docs.get(path)
    return {
      id: path.slice(path.lastIndexOf('/') + 1),
      ref: doc(path),
      exists: data !== undefined,
      data: () => (data === undefined ? undefined : clone(data)),
      get: (field: string) => fieldOf(data, field),
    }
  }
  const write = {
    set: (path: string, data: Data, options?: { merge?: boolean }) =>
      docs.set(path, options?.merge ? { ...(docs.get(path) ?? {}), ...clone(data) } : clone(data)),
    update: (path: string, data: Data) => {
      const current = docs.get(path)
      if (!current) throw Object.assign(new Error(`NOT_FOUND ${path}`), { code: 5 })
      const next = { ...current }
      for (const [field, value] of Object.entries(data)) {
        // A real `FieldValue.arrayUnion` (the enroll stamp, AGL-3254) is
        // applied as the database would; a dotted path lands at depth.
        if (isDeleteSentinel(value)) {
          deleteField(next, field)
          continue
        }
        const union = arrayUnionElements(value)
        const held = fieldOf(next, field)
        const stored = union
          ? [...(Array.isArray(held) ? held : []), ...union.filter((id) => !(Array.isArray(held) && held.includes(id)))]
          : clone(value)
        setField(next, field, stored)
      }
      docs.set(path, next)
    },
    create: (path: string, data: Data) => {
      if (docs.has(path)) throw Object.assign(new Error(`ALREADY_EXISTS ${path}`), { code: 6 })
      docs.set(path, clone(data))
    },
    delete: (path: string) => void docs.delete(path),
  }
  /** `[field, value]` for equality, or `[field, values, 'array-contains-any']`. */
  type Filter = [string, unknown] | [string, unknown[], 'array-contains-any']
  /** The order a query asked for: by id, or by one field's value (a Leads view reads by `lastSeenAtMs`). */
  type Order = { field: string; desc: boolean } | null
  const query = (path: string, filters: Filter[], order: Order, max: number, after: string | null): any => ({
    where: (field: string, op: string, value: unknown) => {
      /*
       * `array-contains-any` is how a scoped read narrows an org collection by
       * `visibleTo` (AGL-3275), so the double has to model it — a fake that
       * ignored the clause would pass a Leads view that served one agency
       * client another client's people.
       */
      if (op === 'array-contains-any') {
        if (!Array.isArray(value)) throw new Error('array-contains-any wants an array')
        return query(path, [...filters, [field, value, 'array-contains-any']], order, max, after)
      }
      if (op !== '==') throw new Error(`unsupported operator ${op}`)
      return query(path, [...filters, [field, value]], order, max, after)
    },
    orderBy: (field: string, direction: 'asc' | 'desc' = 'asc') =>
      query(path, filters, { field, desc: direction === 'desc' }, max, after),
    limit: (count: number) => query(path, filters, order, count, after),
    startAfter: (last: { id: string }) => query(path, filters, order, max, last.id),
    get: async () => {
      const keys = [...docs.keys()]
        .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
        .filter((key) =>
          filters.every(([field, value, op]) => {
            const held = fieldOf(docs.get(key), field)
            if (op !== 'array-contains-any') return held === value
            const tokens = Array.isArray(held) ? held : []
            return (value as unknown[]).some((wanted) => tokens.includes(wanted))
          }),
        )
        .sort()
      if (order && order.field !== '__name__') {
        const value = (key: string) => Number(fieldOf(docs.get(key), order.field) ?? 0)
        keys.sort((a, b) => (order.desc ? value(b) - value(a) : value(a) - value(b)))
      }
      const found = keys
        .filter((key) => after === null || key.slice(path.length + 1) > after)
        .slice(0, max)
        .map(snapshot)
      return { docs: found, size: found.length, empty: !found.length }
    },
  })
  function doc(path: string): any {
    const parentPath = path.slice(0, path.lastIndexOf('/'))
    return {
      id: path.slice(path.lastIndexOf('/') + 1),
      path,
      get parent() {
        return collection(parentPath)
      },
      collection: (name: string) => collection(`${path}/${name}`),
      get: async () => snapshot(path),
      set: async (data: Data, options?: { merge?: boolean }) => write.set(path, data, options),
      update: async (data: Data) => write.update(path, data),
      create: async (data: Data) => write.create(path, data),
      delete: async () => write.delete(path),
    }
  }
  function collection(path: string): any {
    const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null
    return {
      ...query(path, [], null, Number.POSITIVE_INFINITY, null),
      id: path.slice(path.lastIndexOf('/') + 1),
      path,
      parent: parentPath ? doc(parentPath) : null,
      doc: (id?: string) => doc(`${path}/${id ?? `auto-${(autoId += 1)}`}`),
    }
  }
  return {
    collection,
    getAll: async (...refs: Array<{ path: string }>) => refs.map((ref) => snapshot(ref.path)),
    batch: () => {
      const writes: Array<() => void> = []
      return {
        update: (ref: { path: string }, data: Data) => void writes.push(() => write.update(ref.path, data)),
        create: (ref: { path: string }, data: Data) => void writes.push(() => write.create(ref.path, data)),
        set: (ref: { path: string }, data: Data) => void writes.push(() => write.set(ref.path, data)),
        commit: async () => writes.forEach((apply) => apply()),
      }
    },
    runTransaction: async (run: (transaction: any) => Promise<unknown>) => {
      const writes: Array<() => void> = []
      const result = await run({
        get: async (ref: { path: string }) => snapshot(ref.path),
        update: (ref: { path: string }, data: Data) => void writes.push(() => write.update(ref.path, data)),
        set: (ref: { path: string }, data: Data) => void writes.push(() => write.set(ref.path, data)),
      })
      writes.forEach((apply) => apply())
      return result
    },
  } as unknown as FirebaseFirestore.Firestore
}

// ── The organization ────────────────────────────────────────────────────────

const ORG = 'org-outreach'
const HOST = 'host-shop'
const OTHER_HOST = 'host-elsewhere'
const OWNER = 'uid-owner'
const REP = 'uid-rep'
const AT = Date.parse('2026-09-15T15:00:00Z') // a Tuesday, 10:00 in Chicago
const MAILBOX = 'mbx-rep'
const OWNER_MAILBOX = 'mbx-owner'

const org = (path: string) => `orgs/${ORG}/${path}`

interface Member {
  role: string
  orgWide: boolean
  permissions: Record<string, boolean>
}

let docs: Docs
let members: Record<string, Member>
let activity: Array<{ action: string; target: unknown }>
let viewEmails: string[]
/** What the enroll route credited to a campaign (AGL-3254). */
let credits: Array<{ hostId: string; campaignIds: readonly string[]; outcome: string; atMs: number }>
/** What the routes stamped on the person's record (AGL-3245). */
let stamped: OutreachRecordEmailStamp[]

const gate: OutreachRouteGateDeps = {
  verifyIdToken: async (uid) => ({ uid, email: `${uid}@example.com`, email_verified: true }) as unknown as DecodedIdToken,
  resolveOrgPermissions: async (uid, context) => {
    const member = members[uid]
    return member
      ? { orgId: context.orgId, isOwner: ['owner', 'admin'].includes(member.role), ...member }
      : { orgId: context.orgId, role: null, isOwner: false, orgWide: false, permissions: {} }
  },
  holdsOrgCatalogPermission: async (uid, _orgId, key) => members[uid]?.permissions[key] === true,
  readOrg: async () => ({ plan: 'pro', entitlements: { features: { outreach: true } } }),
  lockdownRefusal: async () => null,
}

/**
 * The MX table the routes resolve against (AGL-3326), by domain: a list of
 * exchanges, or `null` for a domain the resolver says has none. A domain
 * not in it is hosted on a plain exchange of its own.
 */
let mx: Record<string, Array<{ exchange: string; priority: number }> | null>

const deps = (): OutreachEnrollRouteDeps => ({
  firestore: () => fakeFirestore(docs),
  gate,
  now: () => AT,
  random: () => 0.5,
  resolveMx: async (domain) => {
    const records = domain in mx ? mx[domain] : [{ exchange: `mx.${domain}`, priority: 10 }]
    if (records === null) throw Object.assign(new Error(`queryMx ENODATA ${domain}`), { code: 'ENODATA' })
    return records
  },
  logOrgActivity: async (_orgId, _actor, action, target) => {
    activity.push({ action, target })
  },
  crmViewEmails: async () => ({ emails: viewEmails, complete: true }),
  creditCampaign: async (input) => {
    credits.push(input)
  },
  stampRecordEmailState: async (stamp) => {
    stamped.push(stamp)
  },
  // The record system (AGL-3274): what the enroll files on the person.
  timeline: () => ({
    async logActivity(request) {
      filed.push(request)
      return { ok: true, id: `a${filed.length}`, created: true }
    },
    async createTask() {
      return { ok: true, id: 't1', created: true }
    },
  }),
  // The workspace's text generator (AGL-3324): a fake on the seam's shape,
  // or none, as each curate test arms it.
  textGenerator: () => generator,
})

/** What the curate route asks the generator, and what it answers (AGL-3324). */
let generator: PluginTextGenerator | null = null
let generated: PluginTextGenerationRequest[] = []
/** Arms a generator that answers `text` for every ask. */
function armGenerator(text: string | (() => PluginTextGenerationResult)) {
  generator = {
    generate: async (request) => {
      generated.push(request)
      if (typeof text === 'function') return text()
      return { ok: true, text, model: 'test-model', usage: { inputTokens: 100, outputTokens: 40 } }
    },
  }
}

/** What the enroll route filed on the person's record (AGL-3274). */
let filed: PluginRecordActivityRequest[] = []

const OFFICE = { days: [1, 2, 3, 4, 5], startMinute: 9 * 60, endMinute: 17 * 60 }

const firstEmail: OutreachEmailStep = {
  id: 'step-a',
  kind: 'email',
  delayBusinessDays: 0,
  subject: 'Your second location, {{contact.firstName}}',
  replyInThread: false,
  body: 'Hi {{contact.firstName}},\n\n{{enrollment.personalLine}}\n\n{{sender.firstName}}',
  templateId: null,
}
const call: OutreachTaskStep = { id: 'step-b', kind: 'task', taskKind: 'call', title: 'Call', delayBusinessDays: 1 }
const followUp: OutreachEmailStep = {
  id: 'step-c',
  kind: 'email',
  delayBusinessDays: 3,
  subject: '',
  replyInThread: true,
  body: 'Following up, {{contact.firstName}}.',
  templateId: null,
}

const draft = (overrides: Record<string, unknown> = {}) => ({
  name: 'Second locations',
  hostId: HOST,
  mailboxId: MAILBOX,
  steps: [firstEmail, call, followUp],
  settings: { window: null, allowedCountries: ['US'], allowCustomers: false },
  ...overrides,
})

const contact = (id: string, fields: Data) => {
  docs.set(org(`contacts/${id}`), {
    visibleTo: [`host:${HOST}`],
    ...fields,
  })
}

/** A contact the shop captured through a form, in the United States. */
const warm = (id: string, name: string, email: string) =>
  contact(id, {
    name,
    email,
    facets: { [HOST]: { sources: { form: true }, address: { country: 'US' } } },
  })

/** A contact the shop added itself, at a company in the United States. */
const cold = (id: string, name: string, email: string) => {
  contact(id, {
    name,
    email,
    facets: { [HOST]: { sources: { manual: true }, companyId: 'co-1' } },
  })
}

/** A lead the shop holds (AGL-3234), keyed by its person key, at `orgs/{ORG}/leads` (AGL-3275). */
const lead = (email: string, fields: Data) => {
  const id = personKey(email) as string
  // `visibleTo` names the site (AGL-3275): the collection is org-wide, and a
  // lead with no scope is visible to nobody — including to a Leads view.
  docs.set(`orgs/${ORG}/leads/${id}`, {
    email,
    sources: ['import'],
    submissionCount: 1,
    visibleTo: [`host:${HOST}`],
    ...fields,
  })
  return id
}

beforeEach(() => {
  docs = new Map()
  activity = []
  credits = []
  filed = []
  viewEmails = []
  stamped = []
  mx = {}
  generator = null
  generated = []
  members = {
    [OWNER]: {
      role: 'owner',
      orgWide: true,
      permissions: { [OUTREACH_USE_PERMISSION]: true, 'data.manage': true },
    },
    [REP]: {
      role: 'editor',
      orgWide: true,
      permissions: { [OUTREACH_USE_PERMISSION]: true, 'data.manage': true },
    },
    'uid-reader': { role: 'viewer', orgWide: true, permissions: { [OUTREACH_USE_PERMISSION]: true } },
  }
  docs.set(`hosts/${HOST}`, { orgId: ORG, name: 'Example Shop' })
  docs.set(`hosts/${OTHER_HOST}`, { orgId: 'org-someone-else', name: 'Elsewhere' })
  docs.set(org(`members/${OWNER}`), { role: 'owner', email: 'owner@example.com' })
  docs.set(org(`members/${REP}`), { role: 'editor', email: 'rep@example.com' })
  docs.set(org(`outreachMailboxes/${MAILBOX}`), {
    email: 'rep@example.com',
    sendAs: 'rep@example.com',
    displayName: 'Avery Quinn',
    status: 'connected',
    timezone: 'America/Chicago',
    window: OFFICE,
    connectedByUid: REP,
  })
  docs.set(org(`outreachMailboxes/${OWNER_MAILBOX}`), {
    email: 'owner@example.com',
    sendAs: 'owner@example.com',
    displayName: 'Jordan Lee',
    status: 'connected',
    timezone: 'America/Chicago',
    window: OFFICE,
    connectedByUid: OWNER,
  })
  docs.set(org('companies/co-1'), { name: 'Example Co', address: { country: 'US' } })
  docs.set(org('outreachSettings/compliance'), {
    legalName: 'Example Shop LLC',
    brandName: 'Example Shop',
    postalAddress: '100 Example St\nSpringfield, IL 62701',
    allowedCountries: ['US'],
  })
})

async function post(handler: ReturnType<typeof createOutreachEnrollmentActionRoute>, uid: string, body: Data) {
  const response = await handler(
    new Request('https://console.example.com/api/outreach', {
      method: 'POST',
      headers: { authorization: `Bearer ${uid}`, 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: ORG, ...body }),
    }),
    { params: {} },
  )
  return { status: response.status, body: (await response.json()) as Record<string, any> }
}

const sequences = () => createOutreachSequenceRoutes(deps())
const enroll = () => createOutreachEnrollRoutes(deps())

/** Saves a sequence as the rep and activates it; answers its id. */
async function activeSequence(overrides: Record<string, unknown> = {}): Promise<string> {
  const saved = await post(sequences().save, REP, { sequence: draft(overrides) })
  expect(saved.status).toBe(200)
  const id = saved.body.sequence.id as string
  const activated = await post(sequences().status, REP, { sequenceId: id, action: 'activate' })
  expect(activated.status).toBe(200)
  return id
}

// ── Sequences ───────────────────────────────────────────────────────────────

describe('outreach/sequences/save (AGL-2980)', () => {
  it('creates a draft from the editor’s draft, and logs it', async () => {
    const { status, body } = await post(sequences().save, REP, { sequence: draft() })
    expect(status).toBe(200)
    expect(body.created).toBe(true)
    const stored = docs.get(org(`outreachSequences/${body.sequence.id}`))
    expect(stored).toMatchObject({
      name: 'Second locations',
      hostId: HOST,
      mailboxId: MAILBOX,
      status: 'draft',
      createdAtMs: AT,
      updatedAtMs: AT,
    })
    expect((stored?.['steps'] as unknown[]).length).toBe(3)
    expect(activity).toEqual([
      {
        action: OUTREACH_SEQUENCE_ACTIVITY.create,
        target: { type: 'outreach:sequence', id: body.sequence.id, name: 'Second locations' },
      },
    ])
  })

  /*
   * A sequence joins the org's campaigns (AGL-3254): the ids are stored
   * as picked, `[]` for none, and only the org's live containers pass —
   * whichever sites they are placed on, because a sequence is an org
   * record. Another org's container, a deleted one, and one left at the
   * retired site path are refused.
   */
  it('stores the campaigns picked, and refuses one that is not the org’s live container', async () => {
    docs.set(`orgs/${ORG}/emailCampaigns/founder-icp2`, { name: 'Founder · ICP 2', visibleTo: ['org'] })
    docs.set(`orgs/${ORG}/emailCampaigns/sibling`, { name: 'Sibling push', visibleTo: [`host:${OTHER_HOST}`] })
    docs.set(`orgs/${ORG}/emailCampaigns/gone`, { name: 'Gone', deletedAt: 1 })
    docs.set(`orgs/another-org/emailCampaigns/theirs`, { name: 'Theirs' })
    docs.set(`hosts/${HOST}/emailCampaigns/site-only`, { name: 'Site only' })

    const saved = await post(sequences().save, REP, {
      sequence: draft({ campaignIds: ['founder-icp2', 'founder-icp2', 'sibling'] }),
    })
    expect(saved.status).toBe(200)
    expect(docs.get(org(`outreachSequences/${saved.body.sequence.id}`))?.['campaignIds']).toEqual([
      'founder-icp2',
      'sibling',
    ])
    expect(docs.get(org(`outreachSequences/${(await post(sequences().save, REP, { sequence: draft() })).body.sequence.id}`))?.['campaignIds']).toEqual([])

    for (const campaignId of ['gone', 'theirs', 'site-only', 'nope']) {
      const refused = await post(sequences().save, REP, { sequence: draft({ campaignIds: [campaignId] }) })
      expect(refused.status).toBe(400)
      expect(refused.body.issues.map((issue: { path: string; code: string }) => [issue.path, issue.code])).toEqual([
        ['campaignIds', 'campaign_unknown'],
      ])
    }
  })

  it('files its rows under Outreach’s own namespaced target, which the org feed reads as a Sequence', () => {
    // Core's activity targets name only core's resources; a plugin's rows
    // go through the `pluginId:noun` seam (AGL-2978) instead.
    expect(OUTREACH_SEQUENCE_ACTIVITY_TARGET).toBe('outreach:sequence')
    expect(isPluginActivityTargetType(OUTREACH_SEQUENCE_ACTIVITY_TARGET)).toBe(true)
    expect(activityTypeLabel(OUTREACH_SEQUENCE_ACTIVITY_TARGET)).toBe('Sequence')
  })

  it('refuses what the engine refuses, naming each field', async () => {
    const { status, body } = await post(sequences().save, REP, {
      sequence: draft({ name: '', steps: [{ ...firstEmail, subject: 'Re: hello' }] }),
    })
    expect(status).toBe(400)
    expect(body.reason).toBe('invalid-sequence')
    expect(body.issues.map((entry: { path: string; code: string }) => `${entry.path}:${entry.code}`)).toEqual(
      expect.arrayContaining(['name:name_required', 'steps.0.subject:subject_reply_prefix']),
    )
    expect([...docs.keys()].some((key) => key.includes('outreachSequences'))).toBe(false)
  })

  it('refuses another organization’s site, and a country the organization does not allow', async () => {
    const { body } = await post(sequences().save, REP, {
      sequence: draft({ hostId: OTHER_HOST, settings: { window: null, allowedCountries: ['CA'], allowCustomers: false } }),
    })
    expect(body.issues.map((entry: { code: string }) => entry.code)).toEqual(
      expect.arrayContaining(['host_unknown', 'country_not_in_org']),
    )
  })

  it('sends only from the rep’s own mailbox, unless an owner or admin saves it', async () => {
    const refused = await post(sequences().save, REP, { sequence: draft({ mailboxId: OWNER_MAILBOX }) })
    expect(refused.status).toBe(403)
    expect(refused.body.reason).toBe('permission')
    const admitted = await post(sequences().save, OWNER, { sequence: draft({ mailboxId: MAILBOX }) })
    expect(admitted.status).toBe(200)
  })

  it('returns the warnings a save allows', async () => {
    const { body } = await post(sequences().save, REP, {
      sequence: draft({ steps: [{ ...firstEmail, body: 'Hi {{contact.firstName}}' }] }),
    })
    expect(body.warnings.map((entry: { code: string }) => entry.code)).toEqual(['personal_line_unused'])
  })

  it('keeps the enrolled people’s steps, site and mailbox fixed once anyone is enrolled', async () => {
    const saved = await post(sequences().save, REP, { sequence: draft() })
    const sequenceId = saved.body.sequence.id
    docs.set(org(`outreachEnrollments/${sequenceId}_c-1`), { sequenceId, status: 'active', email: 'x@example.com' })

    const reordered = await post(sequences().save, REP, {
      sequenceId,
      sequence: draft({ steps: [call, firstEmail, followUp] }),
    })
    expect(reordered.body.issues.map((entry: { code: string }) => entry.code)).toContain('steps_locked')
    const moved = await post(sequences().save, OWNER, {
      sequenceId,
      sequence: draft({ mailboxId: OWNER_MAILBOX }),
    })
    expect(moved.body.issues.map((entry: { code: string }) => entry.code)).toContain('mailbox_locked')

    const appended = await post(sequences().save, REP, {
      sequenceId,
      sequence: draft({ steps: [{ ...firstEmail, body: `${firstEmail.body} Thanks.` }, call, followUp, { ...call, id: 'step-d' }] }),
    })
    expect(appended.status).toBe(200)
    expect(appended.body.created).toBe(false)
  })

  it('refuses to edit an archived sequence', async () => {
    const saved = await post(sequences().save, REP, { sequence: draft() })
    await post(sequences().status, REP, { sequenceId: saved.body.sequence.id, action: 'archive' })
    const edit = await post(sequences().save, REP, { sequenceId: saved.body.sequence.id, sequence: draft() })
    expect(edit.status).toBe(409)
    expect(edit.body.reason).toBe('sequence-archived')
  })
})

describe('outreach/sequences/status (AGL-2980)', () => {
  it('will not activate while the organization has no postal address', async () => {
    docs.set(org('outreachSettings/compliance'), { legalName: 'Example Shop LLC', postalAddress: '', allowedCountries: ['US'] })
    const saved = await post(sequences().save, REP, { sequence: draft() })
    const { status, body } = await post(sequences().status, REP, {
      sequenceId: saved.body.sequence.id,
      action: 'activate',
    })
    expect(status).toBe(409)
    expect(body.reason).toBe('activation-refused')
    expect(body.issues.map((entry: { path: string }) => entry.path)).toContain('orgSettings.postalAddress')
    expect(docs.get(org(`outreachSequences/${saved.body.sequence.id}`))?.['status']).toBe('draft')
  })

  it('activates only onto a mailbox that is sending, and says why not in the page’s words', async () => {
    const saved = await post(sequences().save, REP, { sequence: draft() })
    const sequenceId = saved.body.sequence.id
    const activate = () => post(sequences().status, REP, { sequenceId, action: 'activate' })
    const mailbox = org(`outreachMailboxes/${MAILBOX}`)
    const setMailboxStatus = (status: string) => docs.set(mailbox, { ...docs.get(mailbox), status })

    setMailboxStatus('paused')
    const paused = await activate()
    expect(paused.status).toBe(409)
    expect(paused.body).toMatchObject({
      reason: 'activation-refused',
      error: "This sequence's mailbox is paused. Resume it in Mailboxes, then activate the sequence.",
    })
    expect(paused.body.issues).toEqual([expect.objectContaining({ path: 'mailboxId', code: 'mailbox_not_sending' })])

    setMailboxStatus('reconnect_required')
    expect((await activate()).body.error).toBe(
      "Google stopped accepting this sequence's mailbox. Reconnect it in Mailboxes, then activate the sequence.",
    )

    setMailboxStatus('disconnected')
    const gone = await activate()
    expect(gone.body.issues).toEqual([
      expect.objectContaining({
        code: 'mailbox_unknown',
        message: "This sequence's mailbox is no longer connected. Choose another before activating it.",
      }),
    ])
    expect(docs.get(org(`outreachSequences/${sequenceId}`))?.['status']).toBe('draft')

    setMailboxStatus('connected')
    const activated = await activate()
    expect(activated.status).toBe(200)
    expect(activated.body.sequence.status).toBe('active')
  })

  it('asks a sequence of tasks alone for a mailbox too, since its steps fall due in that mailbox’s hours', async () => {
    const saved = await post(sequences().save, REP, { sequence: draft({ mailboxId: '', steps: [call] }) })
    expect(saved.status).toBe(200)
    const refused = await post(sequences().status, REP, { sequenceId: saved.body.sequence.id, action: 'activate' })
    expect(refused.status).toBe(409)
    expect(refused.body.issues).toEqual([
      expect.objectContaining({
        path: 'mailboxId',
        code: 'mailbox_required',
        message: 'Choose the mailbox this sequence sends from before activating it.',
      }),
    ])
  })

  it('activates, pauses and refuses a transition the status does not allow', async () => {
    const saved = await post(sequences().save, REP, { sequence: draft() })
    const sequenceId = saved.body.sequence.id
    const early = await post(sequences().status, REP, { sequenceId, action: 'pause' })
    expect(early.status).toBe(409)
    expect(early.body.reason).toBe('transition-refused')
    expect((await post(sequences().status, REP, { sequenceId, action: 'activate' })).body.sequence.status).toBe('active')
    expect((await post(sequences().status, 'uid-reader', { sequenceId, action: 'pause' })).body.sequence.status).toBe(
      'paused',
    )
    expect(activity.map((entry) => entry.action)).toEqual([
      OUTREACH_SEQUENCE_ACTIVITY.create,
      OUTREACH_SEQUENCE_ACTIVITY.activate,
      OUTREACH_SEQUENCE_ACTIVITY.pause,
    ])
  })

  it('archives, stopping everyone still active or paused and no one else', async () => {
    const saved = await post(sequences().save, REP, { sequence: draft() })
    const sequenceId = saved.body.sequence.id
    const enrollment = (id: string, status: string) =>
      docs.set(org(`outreachEnrollments/${sequenceId}_${id}`), {
        sequenceId,
        status,
        email: `${id}@example.com`,
        nextDueAtMs: AT + 1000,
        stopReason: status === 'finished' ? null : status === 'paused' ? 'manual' : null,
      })
    enrollment('c-1', 'active')
    enrollment('c-2', 'paused')
    enrollment('c-3', 'finished')
    const { body } = await post(sequences().status, REP, { sequenceId, action: 'archive' })
    expect(body.stoppedEnrollments).toBe(2)
    expect(docs.get(org(`outreachEnrollments/${sequenceId}_c-1`))).toMatchObject({
      status: 'stopped',
      stopReason: 'sequence_archived',
      stoppedByUid: REP,
      nextDueAtMs: null,
    })
    expect(docs.get(org(`outreachEnrollments/${sequenceId}_c-3`))?.['status']).toBe('finished')
  })
})

describe('outreach/sequences/delete (AGL-2980)', () => {
  it('deletes a draft nobody was enrolled in, and refuses anything else', async () => {
    const saved = await post(sequences().save, REP, { sequence: draft() })
    const sequenceId = saved.body.sequence.id
    docs.set(org(`outreachEnrollments/${sequenceId}_c-1`), { sequenceId, status: 'stopped' })
    expect((await post(sequences().remove, REP, { sequenceId })).body.reason).toBe('delete-refused')
    docs.delete(org(`outreachEnrollments/${sequenceId}_c-1`))
    expect((await post(sequences().remove, REP, { sequenceId })).status).toBe(200)
    expect(docs.has(org(`outreachSequences/${sequenceId}`))).toBe(false)
    expect(activity.at(-1)?.action).toBe(OUTREACH_SEQUENCE_ACTIVITY.delete)
  })
})

// ── Enrolling ───────────────────────────────────────────────────────────────

describe('outreach/enroll/preview (AGL-2980)', () => {
  it('marks each person eligible, blocked with the gate’s reason, or waiting on the rep', async () => {
    const sequenceId = await activeSequence()
    warm('c-warm', 'Casey Morgan', 'casey.morgan@example.com')
    cold('c-cold', 'Avery Quinn', 'avery.quinn@example.org')
    cold('c-freemail', 'Riley Park', 'casey@gmail.com')
    warm('c-dnc', 'Jordan Lee', 'jordan.lee@example.net')
    warm('c-member', 'Rep Self', 'rep@example.com')
    contact('c-unknown-country', {
      name: 'Sam Rivera',
      email: 'sam.rivera@example.com',
      facets: { [HOST]: { sources: { form: true } } },
    })
    contact('c-hidden', { name: 'Hidden', email: 'hidden@example.com', visibleTo: [`host:${OTHER_HOST}`] })
    docs.set(org(`outreachDoNotContact/${outreachDoNotContactKey('jordan.lee@example.net')}`), { reason: 'manual' })
    // A whole domain on the list (AGL-3244): the gateway at kcorp.example blocked the sender.
    warm('c-blocked-domain', 'Sam Park', 'sam.park@kcorp.example')
    docs.set(org('outreachDoNotContactDomains/kcorp.example'), { domain: 'kcorp.example', reason: 'gateway_block', source: 'runtime' })

    const { status, body } = await post(enroll().preview, REP, {
      sequenceId,
      source: {
        kind: 'contacts',
        contactIds: [
          'c-warm',
          'c-cold',
          'c-freemail',
          'c-dnc',
          'c-member',
          'c-unknown-country',
          'c-hidden',
          'c-gone',
          'c-blocked-domain',
        ],
      },
    })
    expect(status).toBe(200)
    const byId = Object.fromEntries(body.people.map((person: { contactId: string }) => [person.contactId, person]))
    expect(byId['c-warm']).toMatchObject({ status: 'eligible', cold: false, country: 'US', name: 'Casey Morgan' })
    expect(byId['c-cold']).toMatchObject({
      status: 'needs_confirmation',
      cold: true,
      requires: {
        personalLine: true,
        attestations: ['us_business_address', 'published_or_given', 'verified_deliverable'],
      },
    })
    expect(byId['c-unknown-country']).toMatchObject({
      status: 'needs_confirmation',
      requires: { personalLine: false, attestations: ['us_business_address'] },
    })
    const codes = (id: string) => byId[id].blocks.map((block: { code: string }) => block.code)
    expect(byId['c-freemail'].status).toBe('blocked')
    expect(codes('c-freemail')).toEqual(['free_mail'])
    expect(codes('c-dnc')).toEqual(['do_not_contact'])
    expect(byId['c-dnc'].blocks[0].reason).toBe("jordan.lee@example.net is on your organization's do-not-contact list.")
    expect(codes('c-blocked-domain')).toEqual(['do_not_contact_domain'])
    expect(byId['c-blocked-domain'].blocks[0].reason).toBe(
      "sam.park@kcorp.example is at kcorp.example, which is on your organization's do-not-contact list: no address there is emailed.",
    )
    expect(codes('c-member')).toEqual(['workspace_member'])
    expect(codes('c-hidden')).toEqual(['not_in_site'])
    expect(byId['c-hidden'].blocks[0].reason).toBe("This contact isn't in Example Shop's CRM.")
    expect(codes('c-gone')).toEqual(['contact_missing'])
    expect(body).toMatchObject({ total: 9, truncated: false })
  })

  it('blocks a person already in another sequence, or already through this one', async () => {
    const sequenceId = await activeSequence()
    warm('c-busy', 'Casey Morgan', 'casey.morgan@example.com')
    warm('c-done', 'Avery Quinn', 'avery.quinn@example.org')
    docs.set(org('outreachEnrollments/seq-other_c-busy'), {
      sequenceId: 'seq-other',
      contactId: 'c-busy',
      email: 'casey.morgan@example.com',
      status: 'active',
    })
    docs.set(org(`outreachEnrollments/${sequenceId}_c-done`), {
      sequenceId,
      contactId: 'c-done',
      email: 'avery.quinn@example.org',
      status: 'finished',
    })
    const { body } = await post(enroll().preview, REP, {
      sequenceId,
      source: { kind: 'contacts', contactIds: ['c-busy', 'c-done'] },
    })
    expect(body.people.map((person: { blocks: Array<{ code: string }> }) => person.blocks.map((block) => block.code))).toEqual([
      ['already_enrolled'],
      ['already_in_sequence'],
    ])
  })

  it('reads the people a saved Contacts view selects, and refuses a private or unreadable view', async () => {
    const sequenceId = await activeSequence()
    warm('c-1', 'Casey Morgan', 'casey.morgan@example.com')
    viewEmails = ['casey.morgan@example.com', 'nobody@example.com']
    docs.set(org('crmViews/view-shared'), {
      section: 'contacts',
      name: 'Warm leads',
      shared: true,
      ownerUid: OWNER,
      filters: [{ field: 'tags', op: 'contains', value: 'warm' }],
    })
    docs.set(org('crmViews/view-private'), { section: 'contacts', shared: false, ownerUid: OWNER, filters: [] })
    docs.set(org('crmViews/view-unreadable'), {
      section: 'contacts',
      shared: true,
      ownerUid: OWNER,
      filters: [{ field: 'name', op: 'startsWith', value: 'A', label: 'Name' }],
    })
    const read = await post(enroll().preview, REP, { sequenceId, source: { kind: 'view', viewId: 'view-shared' } })
    expect(read.status).toBe(200)
    expect(read.body.people.map((person: { contactId: string }) => person.contactId)).toEqual(['c-1'])
    expect(read.body.total).toBe(2)
    expect(
      (await post(enroll().preview, REP, { sequenceId, source: { kind: 'view', viewId: 'view-private' } })).body.reason,
    ).toBe('view-not-found')
    const unreadable = await post(enroll().preview, REP, {
      sequenceId,
      source: { kind: 'view', viewId: 'view-unreadable' },
    })
    expect(unreadable.body).toMatchObject({ reason: 'view-unsupported' })
    expect(unreadable.body.error).toContain('Name')
  })

  /**
   * A LEAD is enrolled as it is (AGL-3234): judged as the contact it would
   * be — an imported lead is cold, one that wrote in through a form is not,
   * its address decides its country — and named by its own key. A lead
   * already converted, already a contact, or closed is blocked with the
   * reason.
   */
  it('reads the leads a source names, judged as the contact each would be', async () => {
    const sequenceId = await activeSequence()
    const imported = lead('dana@initech.example', {
      name: 'Dana Marsh',
      company: 'Initech',
      jobTitle: 'CMO',
      address: { country: 'US' },
    })
    const wroteIn = lead('sam@initech.example', {
      name: 'Sam Rivera',
      sources: ['form:form-1'],
      address: { country: 'US' },
    })
    const converted = lead('theo@initech.example', { status: 'qualified', convertedContactId: 'c-theo' })
    warm('c-casey', 'Casey Morgan', 'casey.morgan@example.com')
    const held = lead('casey.morgan@example.com', { name: 'Casey Morgan', address: { country: 'US' } })
    const closed = lead('june@initech.example', { status: 'unqualified', unqualifiedReason: 'Not a fit' })

    const { status, body } = await post(enroll().preview, REP, {
      sequenceId,
      source: { kind: 'leads', leadIds: [imported, wroteIn, converted, held, closed, 'nope'] },
    })
    expect(status).toBe(200)
    const byId = Object.fromEntries(body.people.map((person: { personId: string }) => [person.personId, person]))
    expect(byId[imported]).toMatchObject({
      target: 'lead',
      leadId: imported,
      contactId: '',
      name: 'Dana Marsh',
      email: 'dana@initech.example',
      status: 'needs_confirmation',
      cold: true,
      country: 'US',
    })
    expect(byId[wroteIn]).toMatchObject({ status: 'eligible', cold: false })
    const codes = (id: string) => byId[id].blocks.map((block: { code: string }) => block.code)
    expect(codes(converted)).toEqual(['lead_converted'])
    expect(codes(held)).toEqual(['lead_is_contact'])
    expect(codes(closed)).toEqual(['lead_unqualified'])
    expect(codes('nope')).toEqual(['lead_missing'])
  })

  it('reads the people a saved Leads view selects: the site’s open leads by status', async () => {
    const sequenceId = await activeSequence()
    const open = lead('dana@initech.example', { name: 'Dana Marsh', lastSeenAtMs: 3, address: { country: 'US' } })
    const working = lead('sam@initech.example', { status: 'working', lastSeenAtMs: 2, address: { country: 'US' } })
    lead('june@initech.example', { status: 'unqualified', unqualifiedReason: 'No', lastSeenAtMs: 1 })
    docs.set(org('crmViews/view-open-leads'), { section: 'leads', name: 'Open leads', shared: true, ownerUid: OWNER, filters: [] })
    docs.set(org('crmViews/view-working'), {
      section: 'leads',
      name: 'Working',
      shared: true,
      ownerUid: OWNER,
      filters: [{ field: 'status', op: 'equals', value: 'working' }],
    })
    const opened = await post(enroll().preview, REP, { sequenceId, source: { kind: 'view', viewId: 'view-open-leads' } })
    expect(opened.status).toBe(200)
    expect(opened.body.people.map((person: { personId: string }) => person.personId).sort()).toEqual([open, working].sort())
    const worked = await post(enroll().preview, REP, { sequenceId, source: { kind: 'view', viewId: 'view-working' } })
    expect(worked.body.people.map((person: { personId: string }) => person.personId)).toEqual([working])
  })

  /*
   * The mail gateway in front of each domain (AGL-3326): the MX is looked
   * up once and cached on the org for a week, a domain with no MX is
   * blocked, and a gateway that refused this organization twice lately
   * without delivering is shown red, un-ticked by default, and would be
   * held at the send.
   */
  it('reads each domain’s mail gateway from its MX, caches it, blocks no MX, and flags a gateway that refused twice (AGL-3326)', async () => {
    const sequenceId = await activeSequence()
    warm('c-barracuda', 'Kristan Cole', 'kristan@lifespire.example')
    warm('c-google', 'Casey Morgan', 'casey@workspace.example')
    warm('c-nomx', 'Nobody Home', 'nobody@parked.example')
    warm('c-known', 'Sam Park', 'sam@cached.example')
    mx['lifespire.example'] = [{ exchange: 'd78608a.ess.barracudanetworks.com', priority: 10 }]
    mx['workspace.example'] = [
      { exchange: 'alt1.aspmx.l.google.com', priority: 5 },
      { exchange: 'aspmx.l.google.com', priority: 1 },
    ]
    mx['parked.example'] = null
    // A domain looked up yesterday is read from the cache, not the resolver.
    docs.set(org('outreachDomainIntel/cached.example'), {
      domain: 'cached.example',
      mx: ['us-smtp-inbound-1.mimecast.com'],
      gateway: 'mimecast',
      resolvedAtMs: AT - 86_400_000,
    })
    mx['cached.example'] = null
    // Barracuda refused this organization twice this week and delivered nothing.
    const day = (offsetDays: number) => new Date(AT - offsetDays * 86_400_000).toISOString().slice(0, 10)
    docs.set(org('outreachGatewayStats/barracuda'), {
      gateway: 'barracuda',
      sent: 2,
      delivered: 0,
      blocked: 2,
      days: { [day(0)]: { sent: 1, delivered: 0, blocked: 1 }, [day(2)]: { sent: 1, delivered: 0, blocked: 1 } },
    })
    docs.set(org('outreachGatewayStats/mimecast'), {
      gateway: 'mimecast',
      sent: 1,
      delivered: 1,
      blocked: 0,
      days: { [day(1)]: { sent: 1, delivered: 1, blocked: 0 } },
    })

    const { body } = await post(enroll().preview, REP, {
      sequenceId,
      source: { kind: 'contacts', contactIds: ['c-barracuda', 'c-google', 'c-nomx', 'c-known'] },
    })
    const byId = Object.fromEntries(body.people.map((person: { contactId: string }) => [person.contactId, person]))
    expect(byId['c-barracuda']).toMatchObject({
      status: 'eligible',
      gateway: { gateway: 'barracuda', blocked7: 2, delivered7: 0, blocked30: 2, delivered30: 0, hold: true },
    })
    expect(byId['c-google']).toMatchObject({
      status: 'eligible',
      gateway: { gateway: 'google', blocked7: 0, delivered7: 0, hold: false },
    })
    expect(byId['c-known']).toMatchObject({
      status: 'eligible',
      gateway: { gateway: 'mimecast', blocked7: 0, delivered7: 1, hold: false },
    })
    expect(byId['c-nomx']).toMatchObject({ status: 'blocked', gateway: { gateway: 'none', hold: false } })
    expect(byId['c-nomx'].blocks).toEqual([
      { code: 'no_mx', reason: 'parked.example has no MX record, so nobody@parked.example cannot receive mail.' },
    ])
    // The lookups are cached on the org, MX and all, for the next reader.
    expect(docs.get(org('outreachDomainIntel/lifespire.example'))).toMatchObject({
      mx: ['d78608a.ess.barracudanetworks.com'],
      gateway: 'barracuda',
      resolvedAtMs: AT,
    })
    expect(docs.get(org('outreachDomainIntel/workspace.example'))?.['mx']).toEqual([
      'aspmx.l.google.com',
      'alt1.aspmx.l.google.com',
    ])
    expect(docs.get(org('outreachDomainIntel/parked.example'))).toMatchObject({ mx: [], gateway: 'none' })
    expect(docs.get(org('outreachDomainIntel/cached.example'))?.['resolvedAtMs']).toBe(AT - 86_400_000)
  })

  it('asks for Manage data, and an active sequence', async () => {
    const refused = await post(enroll().preview, 'uid-reader', { sequenceId: 'x', source: { kind: 'contacts', contactIds: ['c'] } })
    expect(refused).toMatchObject({ status: 403, body: { reason: 'permission' } })
    const saved = await post(sequences().save, REP, { sequence: draft() })
    const draftOnly = await post(enroll().preview, REP, {
      sequenceId: saved.body.sequence.id,
      source: { kind: 'contacts', contactIds: ['c'] },
    })
    expect(draftOnly.body.reason).toBe('sequence-not-active')
  })
})

describe('outreach/enroll (AGL-2980)', () => {
  it('enrolls a cold contact only with the personal line and all three attestations, stamped', async () => {
    const sequenceId = await activeSequence()
    cold('c-cold', 'Avery Quinn', 'avery.quinn@example.org')
    const bare = await post(enroll().confirm, REP, { sequenceId, people: [{ contactId: 'c-cold' }] })
    expect(bare.body.results[0].outcome).toBe('blocked')
    expect(bare.body.results[0].blocks.map((block: { code: string }) => block.code)).toEqual([
      'attestations_missing',
      'personal_line_missing',
    ])
    expect(bare.body.enrolled).toBe(0)

    const { status, body } = await post(enroll().confirm, REP, {
      sequenceId,
      people: [
        {
          contactId: 'c-cold',
          personalLine: 'Saw the second location open on Main St.',
          attestations: ['us_business_address', 'published_or_given', 'verified_deliverable'],
        },
      ],
    })
    expect(status).toBe(200)
    expect(body.results).toEqual([
      {
        personId: 'c-cold',
        target: 'contact',
        contactId: 'c-cold',
        leadId: null,
        email: 'avery.quinn@example.org',
        outcome: 'enrolled',
        enrollmentId: `${sequenceId}_c-cold`,
      },
    ])
    const stored = docs.get(org(`outreachEnrollments/${sequenceId}_c-cold`))
    expect(stored).toMatchObject({
      sequenceId,
      contactId: 'c-cold',
      contactName: 'Avery Quinn',
      email: 'avery.quinn@example.org',
      hostId: HOST,
      mailboxId: MAILBOX,
      status: 'active',
      stepIndex: 0,
      cold: true,
      personalLine: 'Saw the second location open on Main St.',
      enrolledByUid: REP,
      attestations: {
        us_business_address: { uid: REP, atMs: AT },
        published_or_given: { uid: REP, atMs: AT },
        verified_deliverable: { uid: REP, atMs: AT },
      },
    })
    expect(typeof stored?.['nextDueAtMs']).toBe('number')
    expect(activity.at(-1)).toEqual({
      action: 'Enrolled 1 person in a sequence',
      target: { type: 'outreach:sequence', id: sequenceId, name: 'Second locations' },
    })
  })

  it('enrolling a person past the red gateway chip releases the hold as the member’s say-so (AGL-3326)', async () => {
    const sequenceId = await activeSequence()
    warm('c-barracuda', 'Kristan Cole', 'kristan@lifespire.example')
    mx['lifespire.example'] = [{ exchange: 'd78608a.ess.barracudanetworks.com', priority: 10 }]
    const today = new Date(AT).toISOString().slice(0, 10)
    docs.set(org('outreachGatewayStats/barracuda'), {
      gateway: 'barracuda',
      days: { [today]: { sent: 2, delivered: 0, blocked: 2 } },
    })
    const { body } = await post(enroll().confirm, REP, { sequenceId, people: [{ contactId: 'c-barracuda' }] })
    expect(body.results[0]).toMatchObject({ outcome: 'enrolled' })
    expect(docs.get(org(`outreachEnrollments/${sequenceId}_c-barracuda`))).toMatchObject({
      status: 'active',
      gatewayHold: { gateway: 'barracuda', heldAtMs: null, releasedByUid: REP, releasedAtMs: AT },
    })
  })

  it('checks every gate again rather than trusting the preview', async () => {
    const sequenceId = await activeSequence()
    warm('c-warm', 'Casey Morgan', 'casey.morgan@example.com')
    const preview = await post(enroll().preview, REP, { sequenceId, source: { kind: 'contacts', contactIds: ['c-warm'] } })
    expect(preview.body.people[0].status).toBe('eligible')
    // Between the preview and Confirm, the address unsubscribes from the site.
    docs.set(`hosts/${HOST}/suppressions/${personKey('casey.morgan@example.com')}`, { reason: 'unsubscribe' })
    const { body } = await post(enroll().confirm, REP, { sequenceId, people: [{ contactId: 'c-warm' }] })
    expect(body.results[0]).toMatchObject({ outcome: 'blocked', blocks: [{ code: 'host_suppressed' }] })
    expect(docs.has(org(`outreachEnrollments/${sequenceId}_c-warm`))).toBe(false)
  })

  /*
   * Enrolling joins the sequence's campaigns (AGL-3254): the enrollment
   * stores them as they stood, the lead gains them at the top of its
   * document, the contact inside the site's facet, and `enrolled` is
   * credited once per person to each campaign. A sequence in no campaign
   * stamps and credits nothing.
   */
  it('stamps the sequence’s campaigns on the enrollment, the lead and the contact, and credits the enroll', async () => {
    docs.set(`orgs/${ORG}/emailCampaigns/founder-icp2`, { name: 'Founder · ICP 2', visibleTo: ['org'] })
    docs.set(`orgs/${ORG}/emailCampaigns/founder-icp1`, { name: 'Founder · ICP 1', visibleTo: ['org'] })
    const sequenceId = await activeSequence({ campaignIds: ['founder-icp2', 'founder-icp1'] })
    warm('c-warm', 'Casey Morgan', 'casey.morgan@example.com')
    docs.set(org('contacts/c-warm'), {
      ...docs.get(org('contacts/c-warm')),
      facets: { [HOST]: { sources: { form: true }, address: { country: 'US' }, campaignIds: ['spring'] } },
    })
    const leadId = lead('sam@initech.example', {
      name: 'Sam Rivera',
      sources: ['form:form-1'],
      address: { country: 'US' },
      campaignIds: ['founder-icp1'],
    })

    const { body } = await post(enroll().confirm, REP, {
      sequenceId,
      people: [{ contactId: 'c-warm' }, { leadId }],
    })
    expect(body.enrolled).toBe(2)
    expect(docs.get(org(`outreachEnrollments/${sequenceId}_c-warm`))?.['campaignIds']).toEqual([
      'founder-icp2',
      'founder-icp1',
    ])
    expect(fieldOf(docs.get(org('contacts/c-warm')), `facets.${HOST}.campaignIds`)).toEqual([
      'spring',
      'founder-icp2',
      'founder-icp1',
    ])
    expect(docs.get(`orgs/${ORG}/leads/${leadId}`)?.['campaignIds']).toEqual(['founder-icp1', 'founder-icp2'])
    // Credited under the org that holds the campaigns, which the route
    // already knows — no site-to-org lookup per person.
    expect(credits).toEqual([
      { hostId: HOST, orgId: ORG, campaignIds: ['founder-icp2', 'founder-icp1'], outcome: 'enrolled', atMs: AT },
      { hostId: HOST, orgId: ORG, campaignIds: ['founder-icp2', 'founder-icp1'], outcome: 'enrolled', atMs: AT },
    ])
    /*
     * And each person's record says so (AGL-3274): one note by "Sequences",
     * keyed once per enrollment, naming the sequence and the campaigns it
     * carried them into — on the contact by id, on the lead by its key.
     */
    const entries = [...filed]
      .sort((a, b) => a.dedupeKey!.localeCompare(b.dedupeKey!))
      .map((entry) => [entry.link, entry.dedupeKey, entry.body, entry.byName, entry.kind])
    expect(entries).toEqual(
      [
        [
          { contactId: 'c-warm' },
          `enrolled:${sequenceId}_c-warm`,
          'Enrolled in Second locations\nFiled under Founder · ICP 2, Founder · ICP 1',
          'Sequences',
          'note',
        ],
        [
          { leadId },
          `enrolled:${sequenceId}_${leadId}`,
          'Enrolled in Second locations\nFiled under Founder · ICP 2, Founder · ICP 1',
          'Sequences',
          'note',
        ],
      ].sort((a, b) => String(a[1]).localeCompare(String(b[1]))),
    )
    expect(filed.every((entry) => entry.sourcePluginId === 'outreach' && entry.hostId === HOST && entry.atMs === AT)).toBe(true)
  })

  it('stamps and credits nothing for a sequence in no campaign', async () => {
    const sequenceId = await activeSequence()
    warm('c-warm', 'Casey Morgan', 'casey.morgan@example.com')
    const { body } = await post(enroll().confirm, REP, { sequenceId, people: [{ contactId: 'c-warm' }] })
    expect(body.enrolled).toBe(1)
    expect(docs.get(org(`outreachEnrollments/${sequenceId}_c-warm`))?.['campaignIds']).toEqual([])
    expect(fieldOf(docs.get(org('contacts/c-warm')), `facets.${HOST}.campaignIds`)).toBeUndefined()
    expect(credits).toEqual([])
  })

  it('enrolls a person in a sequence once, ever', async () => {
    const sequenceId = await activeSequence()
    warm('c-warm', 'Casey Morgan', 'casey.morgan@example.com')
    const first = await post(enroll().confirm, REP, { sequenceId, people: [{ contactId: 'c-warm' }] })
    expect(first.body.enrolled).toBe(1)
    docs.set(org(`outreachEnrollments/${sequenceId}_c-warm`), {
      ...docs.get(org(`outreachEnrollments/${sequenceId}_c-warm`)),
      status: 'stopped',
    })
    const again = await post(enroll().confirm, REP, { sequenceId, people: [{ contactId: 'c-warm' }] })
    expect(again.body.results[0].blocks.map((block: { code: string }) => block.code)).toEqual(['already_in_sequence'])
  })

  /**
   * Enrolling a lead (AGL-3234): the enrollment names the lead and no
   * contact, under the lead's own key; the steps read the lead's fields; and
   * once the lead has an enrollment in a sequence, the contact it becomes is
   * refused the same sequence — by address, not by id.
   */
  it('enrolls a lead by its own key, and refuses the same address again as a contact', async () => {
    const sequenceId = await activeSequence()
    const leadId = lead('sam@initech.example', {
      name: 'Sam Rivera',
      sources: ['form:form-1'],
      address: { country: 'US' },
      company: 'Initech',
    })
    const { status, body } = await post(enroll().confirm, REP, { sequenceId, people: [{ leadId }] })
    expect(status).toBe(200)
    expect(body.results[0]).toMatchObject({
      target: 'lead',
      leadId,
      contactId: '',
      outcome: 'enrolled',
      enrollmentId: `${sequenceId}_${leadId}`,
    })
    expect(docs.get(org(`outreachEnrollments/${sequenceId}_${leadId}`))).toMatchObject({
      target: 'lead',
      leadId,
      contactId: '',
      contactName: 'Sam Rivera',
      email: 'sam@initech.example',
      status: 'active',
    })
    // The lead converted; the contact it became is the same person here.
    warm('c-sam', 'Sam Rivera', 'sam@initech.example')
    const again = await post(enroll().preview, REP, { sequenceId, source: { kind: 'contacts', contactIds: ['c-sam'] } })
    expect(again.body.people[0].blocks.map((block: { code: string }) => block.code)).toEqual(['already_in_sequence'])
  })

  it('refuses a sequence whose mailbox is gone, and more people than a batch holds', async () => {
    const sequenceId = await activeSequence()
    const tooMany = await post(enroll().confirm, REP, {
      sequenceId,
      people: Array.from({ length: 51 }, (_, index) => ({ contactId: `c-${index}` })),
    })
    expect(tooMany.body.reason).toBe('invalid-request')
    docs.set(org(`outreachMailboxes/${MAILBOX}`), { ...docs.get(org(`outreachMailboxes/${MAILBOX}`)), status: 'disconnected' })
    const gone = await post(enroll().confirm, REP, { sequenceId, people: [{ contactId: 'c-1' }] })
    expect(gone).toMatchObject({ status: 409, body: { reason: 'mailbox-unavailable' } })
  })
})

// ── Enrollment actions ──────────────────────────────────────────────────────

describe('outreach/enrollments/action (AGL-2980)', () => {
  const action = () => createOutreachEnrollmentActionRoute(deps())
  const seed = (id: string, fields: Data = {}) =>
    docs.set(org(`outreachEnrollments/${id}`), {
      sequenceId: 'seq-1',
      contactId: 'c-1',
      email: 'casey.morgan@example.com',
      status: 'active',
      nextDueAtMs: AT + 60_000,
      stopReason: null,
      ...fields,
    })

  it('pauses and resumes through the engine’s transitions', async () => {
    seed('seq-1_c-1')
    const paused = await post(action(), REP, { enrollmentId: 'seq-1_c-1', action: 'pause' })
    expect(paused.body.enrollment).toMatchObject({
      status: 'paused',
      stopReason: 'manual',
      stoppedByUid: REP,
      nextDueAtMs: AT + 60_000,
    })
    const resumed = await post(action(), REP, { enrollmentId: 'seq-1_c-1', action: 'resume' })
    expect(docs.get(org('outreachEnrollments/seq-1_c-1'))).toMatchObject({
      status: 'active',
      stopReason: null,
      stoppedByUid: null,
      nextDueAtMs: AT + 60_000,
    })
    expect(resumed.body.changed).toBe(true)
  })

  it('resuming an enrollment the engine held for its gateway stamps the release (AGL-3326)', async () => {
    seed('seq-1_c-1', {
      status: 'paused',
      stopReason: 'gateway_blocked_here',
      stoppedAtMs: AT - 60_000,
      gatewayHold: { gateway: 'barracuda', heldAtMs: AT - 60_000, releasedByUid: null, releasedAtMs: null },
    })
    const resumed = await post(action(), REP, { enrollmentId: 'seq-1_c-1', action: 'resume' })
    expect(resumed.body.enrollment).toMatchObject({
      status: 'active',
      stopReason: null,
      gatewayHold: { gateway: 'barracuda', heldAtMs: AT - 60_000, releasedByUid: REP, releasedAtMs: AT },
    })
  })

  it('stops for good, and refuses to resume a stopped enrollment', async () => {
    seed('seq-1_c-1')
    await post(action(), REP, { enrollmentId: 'seq-1_c-1', action: 'stop', detail: 'Asked on a call' })
    expect(docs.get(org('outreachEnrollments/seq-1_c-1'))).toMatchObject({
      status: 'stopped',
      stopReason: 'manual',
      stopDetail: 'Asked on a call',
      nextDueAtMs: null,
    })
    const refused = await post(action(), REP, { enrollmentId: 'seq-1_c-1', action: 'resume' })
    expect(refused).toMatchObject({ status: 409, body: { reason: 'transition-refused' } })
  })

  it('marks do-not-contact: the list entry, this enrollment, and every other open one of the address', async () => {
    seed('seq-1_c-1')
    seed('seq-2_c-1', { sequenceId: 'seq-2', status: 'paused', stopReason: 'manual' })
    seed('seq-3_c-1', { sequenceId: 'seq-3', status: 'finished' })
    const { body } = await post(action(), OWNER, { enrollmentId: 'seq-1_c-1', action: 'do_not_contact' })
    expect(body.stoppedOthers).toBe(1)
    expect(docs.get(org('outreachEnrollments/seq-1_c-1'))).toMatchObject({
      status: 'opted_out',
      stopReason: 'do_not_contact',
      stoppedByUid: OWNER,
    })
    expect(docs.get(org('outreachEnrollments/seq-2_c-1'))?.['status']).toBe('opted_out')
    expect(docs.get(org('outreachEnrollments/seq-3_c-1'))?.['status']).toBe('finished')
    expect(docs.get(org(`outreachDoNotContact/${outreachDoNotContactKey('casey.morgan@example.com')}`))).toMatchObject({
      reason: 'manual',
      source: 'member',
      addedByUid: OWNER,
      enrollmentId: 'seq-1_c-1',
      sequenceId: 'seq-1',
    })
    // And the record the person is says so (AGL-3245).
    expect(stamped).toEqual([
      {
        orgId: ORG,
        email: 'casey.morgan@example.com',
        state: { status: 'do_not_contact', atMs: AT, source: 'member', detail: null, enrollmentId: 'seq-1_c-1' },
      },
    ])
  })

  it('puts a bounced address on the list without moving its final status', async () => {
    seed('seq-1_c-1', { status: 'bounced', stopReason: 'hard_bounce' })
    const { status, body } = await post(action(), REP, { enrollmentId: 'seq-1_c-1', action: 'do_not_contact' })
    expect(status).toBe(200)
    expect(body.changed).toBe(false)
    expect(docs.get(org('outreachEnrollments/seq-1_c-1'))?.['status']).toBe('bounced')
    expect(docs.has(org(`outreachDoNotContact/${outreachDoNotContactKey('casey.morgan@example.com')}`))).toBe(true)
  })

  it('answers 404 for an enrollment that is gone, and 400 for an action it does not know', async () => {
    expect((await post(action(), REP, { enrollmentId: 'seq-1_gone', action: 'pause' })).status).toBe(404)
    expect((await post(action(), REP, { enrollmentId: 'seq-1_c-1', action: 'delete' })).status).toBe(400)
  })

  it('writes each act that moved the enrollment to its history, with who and why (AGL-3332)', async () => {
    seed('seq-1_c-1')
    await post(action(), REP, { enrollmentId: 'seq-1_c-1', action: 'pause', detail: 'Out of office' })
    await post(action(), OWNER, { enrollmentId: 'seq-1_c-1', action: 'resume' })
    // A resume of an active enrollment changes nothing, and writes nothing.
    await post(action(), OWNER, { enrollmentId: 'seq-1_c-1', action: 'resume' })
    const history = [...docs.keys()]
      .filter((key) => key.startsWith(`${org('outreachEnrollments/seq-1_c-1')}/history/`))
      .map((key) => docs.get(key))
    expect(history).toEqual([
      { kind: 'action', atMs: AT, action: 'pause', byUid: REP, detail: 'Out of office' },
      { kind: 'action', atMs: AT, action: 'resume', byUid: OWNER, detail: null },
    ])
  })
})

// ── Preview ─────────────────────────────────────────────────────────────────

describe('outreach/preview (AGL-2980)', () => {
  const preview = () => createOutreachPreviewRoute(deps())

  it('writes the first email to the sample person, with the real footer', async () => {
    const saved = await post(sequences().save, REP, { sequence: draft() })
    const { status, body } = await post(preview(), REP, { sequenceId: saved.body.sequence.id })
    expect(status).toBe(200)
    expect(body.stepIndex).toBe(0)
    expect(body.subject).toBe('Your second location, Casey')
    expect(body.text).toContain('I saw Example Co just opened its second location.')
    expect(body.text).toContain('Avery')
    expect(body.text).toContain(
      'Example Shop LLC · 100 Example St, Springfield, IL 62701\nThis is a sales email from Example Shop.',
    )
    expect(body.error).toBeNull()
  })

  it('writes a later email as a reply in the thread, for a real contact and their line', async () => {
    const saved = await post(sequences().save, REP, { sequence: draft() })
    warm('c-warm', 'Casey Morgan', 'casey.morgan@example.com')
    const { body } = await post(preview(), REP, {
      sequenceId: saved.body.sequence.id,
      contactId: 'c-warm',
      personalLine: 'Loved the new storefront.',
      stepIndex: 2,
    })
    expect(body.subject).toBe('Re: Your second location, Casey')
    expect(body.text.startsWith('Following up, Casey.')).toBe(true)
  })

  it('says why an email cannot be written while the organization has no postal address', async () => {
    docs.set(org('outreachSettings/compliance'), { legalName: 'Example Shop LLC', allowedCountries: ['US'] })
    const saved = await post(sequences().save, REP, { sequence: draft() })
    const { body } = await post(preview(), REP, { sequenceId: saved.body.sequence.id })
    expect(body.error).toMatchObject({ code: 'missing_postal_address' })
  })

  it('asks for Manage data only to read a real contact', async () => {
    const saved = await post(sequences().save, REP, { sequence: draft() })
    const sequenceId = saved.body.sequence.id
    expect((await post(preview(), 'uid-reader', { sequenceId })).status).toBe(200)
    expect((await post(preview(), 'uid-reader', { sequenceId, contactId: 'c-1' })).status).toBe(403)
    contact('c-hidden', { name: 'Hidden', email: 'hidden@example.com', visibleTo: [`host:${OTHER_HOST}`] })
    expect((await post(preview(), REP, { sequenceId, contactId: 'c-hidden' })).body.reason).toBe('contact-not-found')
  })
})

// ── A test of one step (AGL-3325) ───────────────────────────────────────────

describe('outreach/steps/test (AGL-3325)', () => {
  let gmail: FakeGmail
  let limited: boolean
  const testDeps = (): OutreachStepTestDeps => ({
    openMailbox: async () => ({ ok: true, client: gmail, credential: {} as never }),
    consumeRateLimit: async () => ({ allowed: !limited }),
    clickLinkUrl: (linkId, trackingOrigin) =>
      `${trackingOrigin ?? 'https://console.example.com/api/outreach/l'}/${linkId}`,
    clickLinkOrigin: async () => 'https://links.example.com',
  })
  const test = (overrides: Partial<OutreachStepTestDeps> = {}) =>
    createOutreachStepTestRoute(deps(), { ...testDeps(), ...overrides })
  const header = (name: string) =>
    gmail.sent[0]?.headers.find((entry) => entry.name.toLowerCase() === name.toLowerCase())?.value ?? ''
  /** The sent body, its quoted-printable soft breaks removed. */
  const sentBody = () => gmail.sent[0].body.replace(/=\r\n/g, '')
  const storedLinks = () => [...docs.entries()].filter(([key]) => key.startsWith('outreachLinks/'))
  const setMailboxStatus = (status: string) =>
    docs.set(org(`outreachMailboxes/${MAILBOX}`), { ...(docs.get(org(`outreachMailboxes/${MAILBOX}`)) as Data), status })

  beforeEach(() => {
    gmail = new FakeGmail({ self: ['rep@example.com'] })
    limited = false
  })

  it('sends the step to the member as the preview writes it, [Test] in front, its links as test links', async () => {
    const saved = await post(sequences().save, REP, {
      sequence: draft({
        steps: [{ ...firstEmail, body: `${firstEmail.body}\n\nBook a time: https://example.com/book` }, call, followUp],
        settings: { ...draft().settings, trackClicks: true },
      }),
    })
    const sequenceId = saved.body.sequence.id as string
    const { status, body } = await post(test(), REP, { sequenceId })
    expect(status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      stepIndex: 0,
      sentTo: 'uid-rep@example.com',
      subject: '[Test] Your second location, Casey',
      sentAtMs: AT,
      testsToday: 1,
      unresolvedFields: [],
    })
    expect(gmail.sent).toHaveLength(1)
    expect(header('To')).toContain('uid-rep@example.com')
    expect(header('From')).toContain('rep@example.com')
    expect(header('Subject')).toBe('[Test] Your second location, Casey')
    expect(gmail.sent[0].threadId).toBeNull()
    const text = sentBody()
    expect(text).toContain('I saw Example Co just opened its second location.')
    expect(text).toContain('Example Shop LLC')
    // The link a recipient would get, stored as a test's: followed, never counted.
    expect(text).not.toContain('https://example.com/book')
    expect(text).toMatch(/https:\/\/links\.example\.com\/[A-Za-z0-9]{10}/)
    const links = storedLinks()
    expect(links).toHaveLength(1)
    expect(links[0][1]).toMatchObject({
      v: 1,
      test: true,
      enrollmentId: 'test',
      sequenceId,
      stepIndex: 0,
      linkIndex: 0,
      url: 'https://example.com/book',
    })
    // Counted on the mailbox's tests, and nowhere else.
    const day = outreachLocalDay(AT, 'America/Chicago')
    const mailbox = docs.get(org(`outreachMailboxes/${MAILBOX}`))
    expect(fieldOf(mailbox, `health.daily.${day}`)).toEqual({ sent: 0, bounces: 0, replies: 0, tests: 1 })
    expect(fieldOf(mailbox, 'health.sentToday')).toBeUndefined()
    expect(Number(fieldOf(docs.get(org(`outreachSequences/${sequenceId}`)), 'stats.sent') ?? 0)).toBe(0)
    expect([...docs.keys()].some((key) => key.includes('outreachEnrollments'))).toBe(false)
    expect(filed).toEqual([])
    expect(activity).toHaveLength(1)
    expect((await post(test(), REP, { sequenceId })).body.testsToday).toBe(2)
  })

  it('sends a later email as the reply it would be, with no thread to answer, to an address the member types', async () => {
    const saved = await post(sequences().save, REP, { sequence: draft() })
    warm('c-warm', 'Casey Morgan', 'casey.morgan@example.com')
    const { body } = await post(test(), REP, {
      sequenceId: saved.body.sequence.id,
      contactId: 'c-warm',
      personalLine: 'Loved the new storefront.',
      stepIndex: 2,
      to: ' Zach@Example.org ',
    })
    expect(body).toMatchObject({ sentTo: 'zach@example.org', subject: '[Test] Re: Your second location, Casey' })
    expect(header('To')).toContain('zach@example.org')
    expect(header('To')).not.toContain('casey.morgan@example.com')
    expect(header('In-Reply-To')).toBe('')
    expect(header('References')).toBe('')
    expect(header('List-Unsubscribe')).toBe('')
    expect(gmail.sent[0].threadId).toBeNull()
    expect(sentBody()).toContain('Following up, Casey.')
    expect([...docs.keys()].some((key) => key.includes('outreachEnrollments'))).toBe(false)
  })

  it('refuses while the mailbox is paused or needs reconnecting, an address that is not one, and a step that is not an email', async () => {
    const saved = await post(sequences().save, REP, { sequence: draft() })
    const sequenceId = saved.body.sequence.id
    setMailboxStatus('paused')
    const paused = await post(test(), REP, { sequenceId })
    expect(paused.status).toBe(409)
    expect(paused.body).toMatchObject({ reason: 'mailbox-unavailable', error: expect.stringContaining('paused') })
    setMailboxStatus('reconnect_required')
    expect((await post(test(), REP, { sequenceId })).body.error).toContain('connected again')
    setMailboxStatus('connected')
    expect((await post(test(), REP, { sequenceId, to: 'not an address' })).body.reason).toBe('invalid-request')
    expect((await post(test(), REP, { sequenceId, stepIndex: 1 })).body.error).toBe('That step does not send an email.')
    expect(gmail.sent).toHaveLength(0)
  })

  it('keeps the test to the mailbox’s member or an owner, and to the hourly limit', async () => {
    const saved = await post(sequences().save, REP, { sequence: draft() })
    const sequenceId = saved.body.sequence.id
    const reader = await post(test(), 'uid-reader', { sequenceId })
    expect(reader.status).toBe(403)
    expect(reader.body.reason).toBe('permission')
    expect((await post(test(), OWNER, { sequenceId })).status).toBe(200)
    limited = true
    const refused = await post(test(), REP, { sequenceId })
    expect(refused.status).toBe(429)
    expect(refused.body.reason).toBe('rate-limited')
    expect(gmail.sent).toHaveLength(1)
  })

  it('sends the curated copy of a step when the dialog holds one, and refuses one that breaks a rule (AGL-3324)', async () => {
    const saved = await post(sequences().save, REP, { sequence: draft() })
    const sequenceId = saved.body.sequence.id
    warm('c-warm', 'Casey Morgan', 'casey.morgan@example.com')
    const curated = (body: string, extra: Record<string, unknown> = {}) => ({
      stepIndex: 0,
      body,
      source: 'ai',
      prompt: 'the prompt',
      model: 'test-model',
      ...extra,
    })
    const { body } = await post(test(), REP, {
      sequenceId,
      contactId: 'c-warm',
      personalLine: 'Loved the new storefront.',
      stepOverrides: [curated('Hi {{contact.firstName}},\n\nYour own copy.\n\n{{sender.firstName}}', { subject: 'Casey, your own subject' })],
    })
    expect(body.subject).toBe('[Test] Casey, your own subject')
    expect(sentBody().startsWith('Hi Casey,\r\n\r\nYour own copy.\r\n\r\nAvery')).toBe(true)
    const refused = await post(test(), REP, {
      sequenceId,
      contactId: 'c-warm',
      stepOverrides: [curated('**Bold** is not plain text.')],
    })
    expect(refused).toMatchObject({ status: 400, body: { reason: 'invalid-override' } })
    expect(gmail.sent).toHaveLength(1)
  })

  it('says why the mailbox cannot be opened, and marks it for reconnecting', async () => {
    const saved = await post(sequences().save, REP, { sequence: draft() })
    const { status, body } = await post(
      test({ openMailbox: async () => ({ ok: false, reason: 'sealed-token-unreadable' }) }),
      REP,
      { sequenceId: saved.body.sequence.id },
    )
    expect(status).toBe(409)
    expect(body.reason).toBe('mailbox-unavailable')
    expect(fieldOf(docs.get(org(`outreachMailboxes/${MAILBOX}`)), 'status')).toBe('reconnect_required')
    expect(gmail.sent).toHaveLength(0)
  })
})

// ── Do not contact: domains ─────────────────────────────────────────────────

describe('outreach/do-not-contact/domains (AGL-3244)', () => {
  const route = () => createOutreachDoNotContactDomainsRoute(deps())
  const list = async (uid: string) => {
    const response = await route()(
      new Request(`https://console.example.com/api/outreach?orgId=${ORG}`, {
        headers: { authorization: `Bearer ${uid}` },
      }),
      { params: {} },
    )
    return { status: response.status, body: (await response.json()) as Record<string, any> }
  }

  it('adds a domain with the member as its author, spelled one way, and lists it', async () => {
    const added = await post(route(), REP, { action: 'add', domain: ' @KCorp.Example ', detail: 'Their gateway blocks us.' })
    expect(added.status).toBe(200)
    expect(added.body).toMatchObject({ changed: true, domain: 'kcorp.example' })
    expect(docs.get(org('outreachDoNotContactDomains/kcorp.example'))).toMatchObject({
      domain: 'kcorp.example',
      reason: 'manual',
      source: 'member',
      addedByUid: REP,
      addedAtMs: AT,
      detail: 'Their gateway blocks us.',
    })
    expect(activity).toEqual([
      { action: OUTREACH_DO_NOT_CONTACT_DOMAIN_ACTIVITY.add('kcorp.example'), target: { type: 'org', id: ORG } },
    ])
    const listed = await list(REP)
    expect(listed.status).toBe(200)
    expect(listed.body.domains.map((entry: { domain: string }) => entry.domain)).toEqual(['kcorp.example'])
    // Adding it again changes nothing and logs nothing.
    const again = await post(route(), OWNER, { action: 'add', domain: 'kcorp.example' })
    expect(again.body.changed).toBe(false)
    expect(activity).toHaveLength(1)
  })

  it('removes a domain, and says so on the feed', async () => {
    docs.set(org('outreachDoNotContactDomains/kcorp.example'), { domain: 'kcorp.example', reason: 'gateway_block', source: 'runtime' })
    const removed = await post(route(), REP, { action: 'remove', domain: 'KCORP.example' })
    expect(removed.body).toMatchObject({ changed: true, domain: 'kcorp.example', domains: [] })
    expect(docs.has(org('outreachDoNotContactDomains/kcorp.example'))).toBe(false)
    expect(activity.at(-1)?.action).toBe(OUTREACH_DO_NOT_CONTACT_DOMAIN_ACTIVITY.remove('kcorp.example'))
    expect((await post(route(), REP, { action: 'remove', domain: 'kcorp.example' })).body.changed).toBe(false)
  })

  it('refuses what is not a domain, an action it does not know, and a reader without Use Sequences', async () => {
    expect((await post(route(), REP, { action: 'add', domain: 'not a domain' })).body.reason).toBe('invalid-domain')
    expect((await post(route(), REP, { action: 'forget', domain: 'example.com' })).body.reason).toBe('invalid-request')
    expect((await post(route(), 'uid-nobody', { action: 'add', domain: 'example.com' })).status).toBe(403)
    expect(docs.size).toBeGreaterThan(0)
    expect([...docs.keys()].some((key) => key.includes('outreachDoNotContactDomains'))).toBe(false)
  })

  it('a listed domain refuses every address at it before a send, as the gates read it', async () => {
    const sequenceId = await activeSequence()
    warm('c-1', 'Sam Park', 'sam.park@kcorp.example')
    await post(route(), REP, { action: 'add', domain: 'kcorp.example' })
    const { body } = await post(enroll().confirm, REP, { sequenceId, people: [{ contactId: 'c-1' }] })
    expect(body.results[0].outcome).toBe('blocked')
    expect(body.results[0].blocks.map((block: { code: string }) => block.code)).toEqual(['do_not_contact_domain'])
    expect(body.enrolled).toBe(0)
    expect(docs.has(org(`outreachEnrollments/${sequenceId}_c-1`))).toBe(false)
  })
})

// ── Link domains (AGL-3306) ─────────────────────────────────────────────────

describe('outreach/link-domains (AGL-3306)', () => {
  let hosts: Map<string, TrackingHostRecord>
  let calls: string[]
  const store: OutreachTrackingHosts = {
    list: async () => [...hosts.values()],
    setUp: async ({ domain }) => {
      calls.push(`set-up ${domain}`)
      const record: TrackingHostRecord = {
        domain,
        host: `links.${domain}`,
        status: 'records-issued',
        target: 'cname.vercel-dns.com',
      }
      hosts.set(domain, record)
      return { record, error: null, status: 200 }
    },
    verify: async ({ domain }) => {
      calls.push(`check ${domain}`)
      const record = { ...(hosts.get(domain) as TrackingHostRecord), status: 'verified' as const }
      hosts.set(domain, record)
      return { record, error: null, status: 200 }
    },
    remove: async ({ domain }) => {
      calls.push(`remove ${domain}`)
      hosts.delete(domain)
      return { record: null, error: null, status: 200 }
    },
  }
  const route = () =>
    createOutreachLinkDomainsRoute(deps(), { hosts: async () => store, consoleOrigin: () => 'https://console.example.com' })
  const list = async (uid: string) => {
    const response = await route()(
      new Request(`https://console.example.com/api/outreach?orgId=${ORG}`, {
        headers: { authorization: `Bearer ${uid}` },
      }),
      { params: {} },
    )
    return { status: response.status, body: (await response.json()) as Record<string, any> }
  }

  beforeEach(() => {
    hosts = new Map()
    calls = []
  })

  it('lists each mailbox domain once, on the app address until a host is verified', async () => {
    const listed = await list(REP)
    expect(listed.status).toBe(200)
    expect(listed.body.canManage).toBe(false)
    expect(listed.body.domains).toEqual([
      expect.objectContaining({
        domain: 'example.com',
        host: 'links.example.com',
        status: 'not-set-up',
        records: [],
        linkPrefix: 'https://console.example.com/api/outreach/l/',
      }),
    ])
  })

  it('lets an owner set a host up, check it, and see links move onto it', async () => {
    const set = await post(route(), OWNER, { action: 'set-up', domain: 'example.com' })
    expect(set.status).toBe(200)
    expect(set.body.domains[0]).toMatchObject({ status: 'records-issued' })
    expect(set.body.domains[0].records[0]).toMatchObject({ type: 'CNAME', name: 'links.example.com', value: 'cname.vercel-dns.com' })
    const checked = await post(route(), REP, { action: 'check', domain: 'example.com' })
    expect(checked.body.domains[0]).toMatchObject({ status: 'verified', linkPrefix: 'https://links.example.com/' })
    expect(calls).toEqual(['set-up example.com', 'check example.com'])
    expect(activity).toEqual([
      { action: OUTREACH_LINK_DOMAIN_ACTIVITY['set-up']('links.example.com'), target: { type: 'org', id: ORG } },
    ])
    await post(route(), OWNER, { action: 'remove', domain: 'example.com' })
    expect(activity.at(-1)?.action).toBe(OUTREACH_LINK_DOMAIN_ACTIVITY.remove('links.example.com'))
    expect((await list(REP)).body.domains[0].status).toBe('not-set-up')
  })

  it('keeps setting up and removing to owners and admins, and to the domains its mailboxes send as', async () => {
    expect((await post(route(), REP, { action: 'set-up', domain: 'example.com' })).body.reason).toBe('permission')
    expect((await post(route(), REP, { action: 'remove', domain: 'example.com' })).body.reason).toBe('permission')
    const elsewhere = await post(route(), OWNER, { action: 'set-up', domain: 'someone-else.com' })
    expect(elsewhere.status).toBe(400)
    expect(elsewhere.body.reason).toBe('invalid-domain')
    expect((await post(route(), OWNER, { action: 'forget', domain: 'example.com' })).body.reason).toBe('invalid-request')
    expect((await post(route(), 'uid-nobody', { action: 'check', domain: 'example.com' })).status).toBe(403)
    expect(calls).toEqual([])
  })

  it('answers a store refusal in its own words', async () => {
    const refusing: OutreachTrackingHosts = {
      ...store,
      setUp: async () => ({ record: null, error: 'Campaign mail owns it.', status: 409 }),
    }
    const handler = createOutreachLinkDomainsRoute(deps(), { hosts: async () => refusing, consoleOrigin: () => null })
    const refused = await post(handler, OWNER, { action: 'set-up', domain: 'example.com' })
    expect(refused.status).toBe(409)
    expect(refused.body).toMatchObject({ reason: 'link-domain-refused', error: 'Campaign mail owns it.' })
  })
})

// ── Curating (AGL-3324) ─────────────────────────────────────────────────────

describe('outreach/curate (AGL-3324)', () => {
  const curate = () => createOutreachCurateRoutes(deps())

  /** The model's answer for the two email steps of `draft()`. */
  const answer = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({
      steps: [
        {
          stepIndex: 0,
          subject: 'Casey, Example Co’s second location',
          body: 'Hi Casey,\n\nSaw the second location open on Main St — congratulations.\n\nWorth twenty minutes?\n\n{{sender.firstName}}',
          ...overrides,
        },
        { stepIndex: 2, subject: '', body: 'Following up, Casey — did the second location settle in?' },
      ],
    })

  const useIt = (stepIndex: number, body: string, extra: Record<string, unknown> = {}) => ({
    stepIndex,
    body,
    source: 'ai',
    prompt: 'the prompt',
    model: 'test-model',
    ...extra,
  })

  it('drafts every email step for a person to enroll, from their record and the steps as written, through the seam', async () => {
    const sequenceId = await activeSequence()
    warm('c-warm', 'Casey Morgan', 'casey.morgan@example.com')
    docs.set(org('contacts/c-warm'), {
      ...docs.get(org('contacts/c-warm')),
      facets: { [HOST]: { sources: { form: true }, address: { country: 'US' }, companyName: 'Example Co', jobTitle: 'Owner', tags: ['retail'] } },
    })
    armGenerator(answer())
    const { status, body } = await post(curate().draft, REP, {
      sequenceId,
      contactId: 'c-warm',
      personalLine: 'Saw the second location open on Main St.',
    })
    expect(status).toBe(200)
    expect(body.model).toBe('test-model')
    expect(body.drafts).toEqual([
      {
        stepIndex: 0,
        subject: 'Casey, Example Co’s second location',
        body: 'Hi Casey,\n\nSaw the second location open on Main St — congratulations.\n\nWorth twenty minutes?\n\n{{sender.firstName}}',
        issues: [],
      },
      { stepIndex: 2, subject: null, body: 'Following up, Casey — did the second location settle in?', issues: [] },
    ])
    // What the generator was asked: the member, the site, the purpose, the
    // playbook, and a prompt that states the person and the steps.
    expect(generated).toHaveLength(1)
    expect(generated[0]).toMatchObject({ orgId: ORG, hostId: HOST, uid: REP, staff: false, purpose: OUTREACH_CURATION_PURPOSE })
    expect(generated[0].system).toContain('List price only')
    expect(generated[0].prompt).toContain('Name: Casey Morgan')
    expect(generated[0].prompt).toContain('Company: Example Co')
    expect(generated[0].prompt).toContain('Title: Owner')
    expect(generated[0].prompt).toContain('Tags: retail')
    expect(generated[0].prompt).toContain('How they came to us: form')
    expect(generated[0].prompt).toContain('Sender: Avery Quinn at Example Shop')
    expect(generated[0].prompt).toContain('Why the sender is writing now: Saw the second location open on Main St.')
    expect(generated[0].prompt).toContain('Subject: Your second location, {{contact.firstName}}')
    expect(generated[0].prompt).toContain('stepIndex 2 · a reply in the thread')
    expect(body.prompt).toBe(generated[0].prompt)
    // Nothing was stored, and nothing was filed.
    expect([...docs.keys()].filter((key) => key.includes('outreachEnrollments'))).toEqual([])
    expect(filed).toEqual([])
  })

  it('names the playbook rule a draft breaks, so the dialog refuses it until it is fixed', async () => {
    const sequenceId = await activeSequence()
    warm('c-warm', 'Casey Morgan', 'casey.morgan@example.com')
    armGenerator(answer({ body: 'Hi Casey — 20% off this month, see https://a.example and https://b.example.' }))
    const { body } = await post(curate().draft, REP, { sequenceId, contactId: 'c-warm' })
    expect(body.drafts[0].issues.map((issue: { code: string }) => issue.code)).toEqual(['too_many_links', 'discount_language'])
    expect(body.drafts[1].issues).toEqual([])
  })

  it('says when no plugin generates text, passes the generator’s refusal through, and refuses an unreadable answer', async () => {
    const sequenceId = await activeSequence()
    warm('c-warm', 'Casey Morgan', 'casey.morgan@example.com')
    const none = await post(curate().draft, REP, { sequenceId, contactId: 'c-warm' })
    expect(none).toMatchObject({ status: 503, body: { reason: 'curation-unavailable' } })
    armGenerator(() => ({ ok: false, status: 429, reason: 'quota', error: 'Your AI allotment for this month is spent.' }))
    const spent = await post(curate().draft, REP, { sequenceId, contactId: 'c-warm' })
    expect(spent).toMatchObject({ status: 429, body: { reason: 'curation-refused', error: 'Your AI allotment for this month is spent.' } })
    armGenerator(() => ({ ok: false, status: 404, reason: 'unavailable', error: 'AI drafting is not available to this workspace yet.' }))
    expect((await post(curate().draft, REP, { sequenceId, contactId: 'c-warm' })).body.reason).toBe('curation-unavailable')
    armGenerator('Sure! Here is a lovely email for Casey.')
    const prose = await post(curate().draft, REP, { sequenceId, contactId: 'c-warm' })
    expect(prose).toMatchObject({ status: 502, body: { reason: 'curation-refused' } })
  })

  it('asks for Manage data, a real person the site may see, and the sequence’s email steps only', async () => {
    const sequenceId = await activeSequence()
    warm('c-warm', 'Casey Morgan', 'casey.morgan@example.com')
    armGenerator(answer())
    expect((await post(curate().draft, 'uid-reader', { sequenceId, contactId: 'c-warm' })).status).toBe(403)
    expect((await post(curate().draft, REP, { sequenceId, contactId: 'c-gone' })).body.reason).toBe('contact-not-found')
    expect((await post(curate().draft, REP, { sequenceId })).body.reason).toBe('invalid-request')
    const task = await post(curate().draft, REP, { sequenceId, contactId: 'c-warm', stepIndexes: [1] })
    expect(task).toMatchObject({ status: 400, body: { reason: 'invalid-request' } })
    expect(generated).toEqual([])
  })

  it('enrolls a person with the copies they confirmed, stamped, and files who wrote each on their record', async () => {
    const sequenceId = await activeSequence()
    warm('c-warm', 'Casey Morgan', 'casey.morgan@example.com')
    const { status, body } = await post(enroll().confirm, REP, {
      sequenceId,
      people: [
        {
          contactId: 'c-warm',
          personalLine: 'Saw the second location.',
          stepOverrides: [
            useIt(0, 'Hi Casey,\n\nSaw the second location open.\n\n{{sender.firstName}}', {
              subject: 'Casey, the second location',
              edited: true,
            }),
            { stepIndex: 2, body: 'Following up, Casey.', source: 'member' },
          ],
        },
      ],
    })
    expect(status).toBe(200)
    expect(body.enrolled).toBe(1)
    const stored = docs.get(org(`outreachEnrollments/${sequenceId}_c-warm`))
    expect(stored?.['stepOverrides']).toEqual({
      '0': {
        subject: 'Casey, the second location',
        body: 'Hi Casey,\n\nSaw the second location open.\n\n{{sender.firstName}}',
        source: 'ai',
        edited: true,
        prompt: 'the prompt',
        model: 'test-model',
        draftedAtMs: AT,
        draftedByUid: REP,
      },
      '2': { body: 'Following up, Casey.', source: 'member', draftedAtMs: AT, draftedByUid: REP },
    })
    // The record: enrolled first, then one line per curated step, naming
    // the member as the roster lists them.
    expect(filed.map((entry) => [entry.dedupeKey, entry.body])).toEqual([
      [`enrolled:${sequenceId}_c-warm`, 'Enrolled in Second locations'],
      [`curated:${sequenceId}_c-warm:0:${AT}`, 'Curated step 1 — AI draft, edited by rep@example.com'],
      [`curated:${sequenceId}_c-warm:2:${AT}`, 'Curated step 3 — written by rep@example.com'],
    ])
    expect(filed.every((entry) => entry.link && (entry.link as { contactId?: string }).contactId === 'c-warm')).toBe(true)
  })

  it('refuses to enroll anyone with a copy that breaks a rule, naming the rule, and nothing is written', async () => {
    const sequenceId = await activeSequence()
    warm('c-warm', 'Casey Morgan', 'casey.morgan@example.com')
    const { status, body } = await post(enroll().confirm, REP, {
      sequenceId,
      people: [{ contactId: 'c-warm', stepOverrides: [useIt(0, 'Hi — a 20% discount this week.')] }],
    })
    expect(status).toBe(400)
    expect(body.reason).toBe('invalid-override')
    expect(body.issues.map((issue: { code: string }) => issue.code)).toEqual(['discount_language'])
    expect(docs.has(org(`outreachEnrollments/${sequenceId}_c-warm`))).toBe(false)
    const task = await post(enroll().confirm, REP, {
      sequenceId,
      people: [{ contactId: 'c-warm', stepOverrides: [{ stepIndex: 1, body: 'x', source: 'ai' }] }],
    })
    expect(task.body).toMatchObject({ reason: 'invalid-override', error: 'A curated step names one of the sequence’s email steps.' })
  })

  it('previews the curated version, and the sending runtime reads the same copy', async () => {
    const sequenceId = await activeSequence()
    warm('c-warm', 'Casey Morgan', 'casey.morgan@example.com')
    const preview = createOutreachPreviewRoute(deps())
    const { body } = await post(preview, REP, {
      sequenceId,
      contactId: 'c-warm',
      personalLine: 'Loved the new storefront.',
      stepOverrides: [useIt(0, 'Hi {{contact.firstName}},\n\nYour own copy.\n\n{{sender.firstName}}', { subject: 'Casey, your own subject' })],
    })
    expect(body.subject).toBe('Casey, your own subject')
    expect(body.text.startsWith('Hi Casey,\n\nYour own copy.\n\nAvery\n\n')).toBe(true)
    expect(body.text).toContain('Example Shop LLC · 100 Example St, Springfield, IL 62701')
    const refused = await post(preview, REP, {
      sequenceId,
      contactId: 'c-warm',
      stepOverrides: [useIt(0, '**Bold** is not plain text.')],
    })
    expect(refused).toMatchObject({ status: 400, body: { reason: 'invalid-override' } })
  })

  it('drafts the next email of an enrollment, and stores it only on save — validated again, filed, and logged', async () => {
    const sequenceId = await activeSequence()
    warm('c-warm', 'Casey Morgan', 'casey.morgan@example.com')
    await post(enroll().confirm, REP, { sequenceId, people: [{ contactId: 'c-warm' }] })
    const enrollmentId = `${sequenceId}_c-warm`
    // The first email went out: the enrollment is on the call step.
    docs.set(org(`outreachEnrollments/${enrollmentId}`), { ...docs.get(org(`outreachEnrollments/${enrollmentId}`)), stepIndex: 1 })
    armGenerator(JSON.stringify({ steps: [{ stepIndex: 2, subject: '', body: 'Casey — they replied on the Main St. thread; here is the one thing I would do next.' }] }))
    const drafted = await post(curate().draft, REP, { enrollmentId })
    expect(drafted.status).toBe(200)
    expect(drafted.body.drafts).toEqual([
      { stepIndex: 2, subject: null, body: 'Casey — they replied on the Main St. thread; here is the one thing I would do next.', issues: [] },
    ])
    expect(generated[0].prompt).toContain('Emails to rewrite (1 of the sequence’s 2)')
    expect(docs.get(org(`outreachEnrollments/${enrollmentId}`))?.['stepOverrides']).toBeUndefined()

    filed.length = 0
    const saved = await post(curate().save, REP, {
      enrollmentId,
      stepIndex: 2,
      override: { body: 'Casey — one thing I would do next.', source: 'ai', prompt: drafted.body.prompt, model: 'test-model', edited: true },
    })
    expect(saved.status).toBe(200)
    expect(saved.body.enrollment.stepOverrides).toEqual({
      '2': { body: 'Casey — one thing I would do next.', source: 'ai', prompt: drafted.body.prompt, model: 'test-model', edited: true, draftedAtMs: AT, draftedByUid: REP },
    })
    expect(docs.get(org(`outreachEnrollments/${enrollmentId}`))?.['stepOverrides']).toEqual(saved.body.enrollment.stepOverrides)
    expect(filed.map((entry) => entry.body)).toEqual(['Curated step 3 — AI draft, edited by rep@example.com'])
    expect(activity.at(-1)).toEqual({
      action: outreachCuratedActivity(2, false),
      target: { type: OUTREACH_SEQUENCE_ACTIVITY_TARGET, id: sequenceId, name: 'Second locations' },
    })

    // Clearing puts the step back to the sequence's words, and files nothing.
    filed.length = 0
    const cleared = await post(curate().save, REP, { enrollmentId, stepIndex: 2, override: null })
    expect(cleared.status).toBe(200)
    expect(cleared.body.enrollment.stepOverrides).toBeUndefined()
    expect(docs.get(org(`outreachEnrollments/${enrollmentId}`))?.['stepOverrides']).toEqual({})
    expect(filed).toEqual([])
    expect(activity.at(-1)?.action).toBe(outreachCuratedActivity(2, true))
  })

  it('refuses a copy for a step that went out, a rule-breaking copy, a task step, and an ended enrollment', async () => {
    const sequenceId = await activeSequence()
    warm('c-warm', 'Casey Morgan', 'casey.morgan@example.com')
    await post(enroll().confirm, REP, { sequenceId, people: [{ contactId: 'c-warm' }] })
    const enrollmentId = `${sequenceId}_c-warm`
    const ref = org(`outreachEnrollments/${enrollmentId}`)
    docs.set(ref, { ...docs.get(ref), stepIndex: 2 })
    const gone = await post(curate().save, REP, { enrollmentId, stepIndex: 0, override: { body: 'x', source: 'member' } })
    expect(gone).toMatchObject({ status: 409, body: { reason: 'transition-refused' } })
    const rule = await post(curate().save, REP, { enrollmentId, stepIndex: 2, override: { body: 'Use coupon X', source: 'member' } })
    expect(rule).toMatchObject({ status: 400, body: { reason: 'invalid-override' } })
    expect(rule.body.issues.map((issue: { code: string }) => issue.code)).toEqual(['discount_language'])
    const task = await post(curate().save, REP, { enrollmentId, stepIndex: 1, override: { body: 'x', source: 'member' } })
    expect(task).toMatchObject({ status: 400, body: { reason: 'invalid-request' } })
    armGenerator(answer())
    const drafted = await post(curate().draft, REP, { enrollmentId, stepIndexes: [0] })
    expect(drafted).toMatchObject({ status: 409, body: { reason: 'transition-refused' } })
    docs.set(ref, { ...docs.get(ref), status: 'finished', stepIndex: 3 })
    const ended = await post(curate().save, REP, { enrollmentId, stepIndex: 2, override: { body: 'x', source: 'member' } })
    expect(ended).toMatchObject({ status: 409, body: { reason: 'transition-refused' } })
    expect((await post(curate().draft, REP, { enrollmentId })).body.reason).toBe('transition-refused')
    expect((await post(curate().save, REP, { enrollmentId: 'nope', stepIndex: 0, override: null })).status).toBe(404)
  })
})
