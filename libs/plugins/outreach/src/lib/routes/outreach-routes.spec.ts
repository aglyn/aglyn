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
import type { DecodedIdToken } from 'firebase-admin/auth'
import { OUTREACH_USE_PERMISSION } from '../constants/bundle-common'
import { outreachDoNotContactKey } from '../engine/do-not-contact'
import type { OutreachEmailStep, OutreachTaskStep } from '../model/outreach.types'
import { createOutreachEnrollRoutes, type OutreachEnrollRouteDeps } from './enroll-routes'
import { createOutreachEnrollmentActionRoute } from './enrollment-routes'
import { createOutreachPreviewRoute } from './preview-routes'
import { OUTREACH_SEQUENCE_ACTIVITY_TARGET } from './route-deps'
import type { OutreachRouteGateDeps } from './route-gate'
import { createOutreachSequenceRoutes, OUTREACH_SEQUENCE_ACTIVITY } from './sequence-routes'

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
      docs.set(path, { ...current, ...clone(data) })
    },
    create: (path: string, data: Data) => {
      if (docs.has(path)) throw Object.assign(new Error(`ALREADY_EXISTS ${path}`), { code: 6 })
      docs.set(path, clone(data))
    },
    delete: (path: string) => void docs.delete(path),
  }
  type Filter = [string, unknown]
  const query = (path: string, filters: Filter[], order: boolean, max: number, after: string | null): any => ({
    where: (field: string, op: string, value: unknown) => {
      if (op !== '==') throw new Error(`unsupported operator ${op}`)
      return query(path, [...filters, [field, value]], order, max, after)
    },
    orderBy: (field: string) => {
      if (field !== '__name__') throw new Error(`unsupported order ${field}`)
      return query(path, filters, true, max, after)
    },
    limit: (count: number) => query(path, filters, order, count, after),
    startAfter: (last: { id: string }) => query(path, filters, order, max, last.id),
    get: async () => {
      const found = [...docs.keys()]
        .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
        .filter((key) => filters.every(([field, value]) => fieldOf(docs.get(key), field) === value))
        .sort()
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
      ...query(path, [], false, Number.POSITIVE_INFINITY, null),
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

const deps = (): OutreachEnrollRouteDeps => ({
  firestore: () => fakeFirestore(docs),
  gate,
  now: () => AT,
  random: () => 0.5,
  logOrgActivity: async (_orgId, _actor, action, target) => {
    activity.push({ action, target })
  },
  crmViewEmails: async () => ({ emails: viewEmails, complete: true }),
})

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

beforeEach(() => {
  docs = new Map()
  activity = []
  viewEmails = []
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

    const { status, body } = await post(enroll().preview, REP, {
      sequenceId,
      source: {
        kind: 'contacts',
        contactIds: ['c-warm', 'c-cold', 'c-freemail', 'c-dnc', 'c-member', 'c-unknown-country', 'c-hidden', 'c-gone'],
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
    expect(codes('c-member')).toEqual(['workspace_member'])
    expect(codes('c-hidden')).toEqual(['not_in_site'])
    expect(byId['c-hidden'].blocks[0].reason).toBe("This contact isn't in Example Shop's CRM.")
    expect(codes('c-gone')).toEqual(['contact_missing'])
    expect(body).toMatchObject({ total: 8, truncated: false })
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
        contactId: 'c-cold',
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
      action: 'Enrolled 1 person in an Outreach sequence',
      target: { type: 'outreach:sequence', id: sequenceId, name: 'Second locations' },
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
      'Example Shop LLC · 100 Example St, Springfield, IL 62701\nThis is a business solicitation from Example Shop.',
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
