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
 *
 * @jest-environment node
 */

/**
 * IMPORTING INTO A LIST, ON THE TRANSFER FRAMEWORK — who gets on the list, on
 * what basis, what the dry run warns about, and what never changes.
 *
 * The hooks are driven the way the job engine drives them: `plan` with the
 * core's planned input, then `apply` with a ledger-backed writer, then
 * `revert`. WHAT THE DOUBLES MODEL, stated so a false green is visible:
 *
 *  1. `enrollListMember` is the REAL helper, reached by its deep path. It
 *     owns the document id and the recorded-refusal backstop, and this suite
 *     asserts on the fields it actually writes.
 *  2. `assignmentBasis`, `readMarketingBasis`, `buildTransferPlan`, the
 *     screening and `normalizeContactEmail` are the real pure functions.
 *  3. `filterSendableForHost` / `filterSuppressedEmails` are doubles over a
 *     set of suppressed addresses — what this file certifies is that an
 *     IMPORT goes through them.
 *  4. The contact-capture door is a double: the record system behind it is
 *     another plugin's, and what belongs here is what the import hands it.
 */

const platformSuppressed = new Set<string>()
const hostSuppressed = new Set<string>()
const captured: Array<Record<string, any>> = []

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    serverTimestamp: () => '__serverTimestamp',
    increment: (by: number) => ({ __increment: by }),
  },
  Timestamp: { fromMillis: (ms: number) => ({ __millis: ms }) },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  registerPluginApiRoute: jest.fn(),
  ...jest.requireActual('@aglyn/aglyn/app-utils/marketing-consent'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/enrollment-basis'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/organizations'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/contacts'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/person-key'),
}))

jest.mock('@aglyn/aglyn/plugin-manager/plugin-contact-capture', () => ({
  __esModule: true,
  capturePluginContact: async (request: Record<string, any>) => {
    captured.push(request)
    return { ok: true, record: 'contact', contactId: 'c-new', created: true }
  },
}))

jest.mock('@aglyn/tenant-data-admin/server/transfer-jobs', () => ({
  __esModule: true,
  TransferEngineError: class TransferEngineError extends Error {
    constructor(
      readonly code: string,
      readonly status: number,
      message: string,
    ) {
      super(message)
    }
  },
}))

const HOST_ID = 'site-1'
const ORG_ID = 'org-1'
const LIST_ID = 'list-1'
const JOB_ID = 'job-1'
const LIST_PATH = `orgs/${ORG_ID}/lists/${LIST_ID}`
const MEMBERS_PATH = `${LIST_PATH}/members`
const LEDGER_PATH = `${LIST_PATH}/imports/${JOB_ID}`

const OPTED_IN = 'priya@lumen.co'
const REFUSED = 'sam@lumen.co'
const UNKNOWN = 'dev@lumen.co'
const OPTED_IN_AT = Date.UTC(2024, 4, 2)

const grantedHere = (atMs: number) => ({
  marketingConsentByHost: {
    [HOST_ID]: { marketingConsent: true, marketingConsentAtMs: atMs },
  },
})
const entryOf = (row: Record<string, any> | undefined) =>
  (row?.['marketingConsentByHost']?.[HOST_ID] ?? {}) as Record<string, any>

let store: Record<string, Record<string, any>> = {}
let membership: { orgId: string; member: Record<string, unknown> } | null = null
let contactSeq = 0

const memberFor = (email: string) =>
  Object.entries(store)
    .filter(([path]) => path.startsWith(`${MEMBERS_PATH}/`))
    .map(([, row]) => row)
    .find((row) => row?.['email'] === email)
const memberRows = () => Object.keys(store).filter((path) => path.startsWith(`${MEMBERS_PATH}/`))

const snapshotFor = (path: string) => ({
  id: path.slice(path.lastIndexOf('/') + 1),
  path,
  get exists() {
    return store[path] !== undefined
  },
  get: (field: string) => store[path]?.[field],
  data: () => store[path],
  get ref() {
    return docHandle(path)
  },
})

const mergeInto = (target: Record<string, any>, patch: Record<string, any>): Record<string, any> => {
  const out = { ...target }
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      out[key] = mergeInto((out[key] ?? {}) as Record<string, any>, value)
    } else {
      out[key] = value
    }
  }
  return out
}

const docHandle = (path: string): any => ({
  id: path.slice(path.lastIndexOf('/') + 1),
  path,
  get firestore() {
    return firestoreHandle
  },
  get parent() {
    return collectionHandle(path.slice(0, path.lastIndexOf('/')))
  },
  get: async () => snapshotFor(path),
  set: async (data: Record<string, any>, options?: { merge?: boolean }) => {
    store[path] = options?.merge ? mergeInto(store[path] ?? {}, data) : mergeInto({}, data)
  },
  delete: async () => {
    delete store[path]
  },
  collection: (name: string) => collectionHandle(`${path}/${name}`),
})

const childPaths = (path: string) =>
  Object.keys(store).filter((key) => key.startsWith(`${path}/`) && !key.slice(`${path}/`.length).includes('/'))

const collectionHandle = (path: string): any => {
  const make = (filters: Array<[string, string, unknown]>, cap: number | null, after: string | null): any => {
    const all = () =>
      childPaths(path)
        .filter((key) =>
          filters.every(([field, op, value]) =>
            op === 'in'
              ? (value as unknown[]).includes(store[key]?.[field])
              : op === 'array-contains'
                ? (store[key]?.[field] ?? []).includes(value)
                : store[key]?.[field] === value,
          ),
        )
        .sort()
    return {
      id: path.slice(path.lastIndexOf('/') + 1),
      path,
      firestore: firestoreHandle,
      doc: (id: string) => docHandle(`${path}/${id}`),
      where: (field: string, op: string, value: unknown) => make([...filters, [field, op, value]], cap, after),
      orderBy: () => make(filters, cap, after),
      limit: (value: number) => make(filters, value, after),
      startAfter: (id: string) => make(filters, cap, id),
      count: () => ({ get: async () => ({ data: () => ({ count: all().length }) }) }),
      get: async () => {
        const docs = all()
          .filter((key) => !after || key.slice(path.length + 1) > after)
          .slice(0, cap ?? Infinity)
          .map(snapshotFor)
        return { docs, empty: docs.length === 0, size: docs.length }
      },
      get parent() {
        return docHandle(path.slice(0, path.lastIndexOf('/')))
      },
    }
  }
  return make([], null, null)
}

const firestoreHandle: any = {
  collection: (name: string) => collectionHandle(name),
  getAll: async (...refs: any[]) => refs.map((ref) => snapshotFor(ref.path)),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  consentGroupForSite: async (hostId: string) => ({
    hostId,
    groupId: hostId,
    name: null,
    hostIds: [hostId],
    declared: false,
  }),
  enrollListMember: jest.requireActual('@aglyn/tenant-data-admin/server/list-members').enrollListMember,
  filterSendableForHost: async (_hostId: string, emails: string[]) =>
    emails.filter((email) => !platformSuppressed.has(email) && !hostSuppressed.has(email)),
  filterSuppressedEmails: async (emails: string[]) => emails.filter((email) => !platformSuppressed.has(email)),
  getOrgForHost: async () => ({ orgId: ORG_ID, org: {} }),
  resolveOrgMembership: async () => membership,
  orgDataCollectionForHost: async () => collectionHandle(`orgs/${ORG_ID}/contacts`),
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => ({ uid: 'editor-uid' }) }),
      firestore: () => firestoreHandle,
    }),
  },
}))

import {
  buildTransferFieldCatalog,
  createTransferPolicy,
  deriveTransferRow,
  matchLookupRequests,
  matchRows,
  type TransferRowResult,
  type TransferUndoEntry,
} from '@aglyn/aglyn/data-transfer'
import type { TransferResourceContext } from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import {
  LIST_CONSENT_STEP_ID,
  LIST_EXISTING_STEP_ID,
  LIST_MEMBER_LOCKED_RULES,
  LIST_MEMBER_MATCH_KEYS,
  listMemberCatalog,
} from './email-transfer-catalog'
import { CONSOLE_IMPORT_SOURCE, listMembersTransferResource as hooks } from './list-members.server'

const catalog = buildTransferFieldCatalog(listMemberCatalog())

function context(extras: Record<string, unknown> = {}, actorUid = 'editor-uid', headers: string[] = []): TransferResourceContext {
  return {
    resource: `email.list-members:${LIST_ID}`,
    orgId: ORG_ID,
    hostId: HOST_ID,
    actorUid,
    jobId: JOB_ID,
    extras,
    headers,
  }
}

const attest = (yes: boolean, updateContacts = false) => ({
  [LIST_CONSENT_STEP_ID]: { attest: yes },
  [LIST_EXISTING_STEP_ID]: { updateContacts },
})

/** The dry run, the way the job engine makes it: rows read, matched, planned. */
async function dryRun(rows: Array<Record<string, string>>, ctx: TransferResourceContext) {
  const read = rows.map((cells, index) => ({ index, ...deriveTransferRow(catalog.byId, cells) }))
  const values = read.map((row) => row.values)
  const found = await hooks.lookup(ctx, matchLookupRequests(values, LIST_MEMBER_MATCH_KEYS))
  return (hooks.plan as NonNullable<typeof hooks.plan>)(ctx, {
    fields: catalog.fields,
    rows: read,
    matches: matchRows(values, LIST_MEMBER_MATCH_KEYS, found.lookup),
    existing: found.records,
    policy: createTransferPolicy({ locked: LIST_MEMBER_LOCKED_RULES }),
  })
}

/** A ledger-backed writer, as the engine hands one. */
function ledgerWriter(done = new Map<number, TransferRowResult>()) {
  const undo: TransferUndoEntry[] = []
  return {
    done,
    undo,
    writer: {
      alreadyApplied: async (row: number) => done.get(row) ?? null,
      markApplied: async (result: TransferRowResult, entry?: TransferUndoEntry) => {
        done.set(result.row, result)
        if (entry) undo.push(entry)
      },
      timeLeftMs: () => 60_000,
    },
  }
}

/** Plans and applies a file, as the wizard would. */
async function importRows(rows: Array<Record<string, string>>, extras: Record<string, unknown>, applyAs = 'editor-uid') {
  const plan = await dryRun(rows, context(extras))
  const writes = plan.rows.filter((row) => row.verdict === 'create' || row.verdict === 'update')
  const ledger = ledgerWriter()
  const applied = await hooks.apply(context(extras, applyAs), { jobId: JOB_ID, index: 0, start: 0, end: rows.length, rows: writes }, ledger.writer)
  return { plan, applied, byRow: new Map(applied.results.map((result) => [result.row, result])) }
}

const seedContact = (email: string, consent: Record<string, unknown>) => {
  store[`orgs/${ORG_ID}/contacts/c${(contactSeq += 1)}`] = { email, ...consent }
}

beforeEach(() => {
  store = {}
  contactSeq = 0
  captured.length = 0
  platformSuppressed.clear()
  hostSuppressed.clear()
  membership = { orgId: ORG_ID, member: { role: 'editor', allHosts: true } }
  store[`hosts/${HOST_ID}`] = { memberRoles: { 'editor-uid': 'editor' } }
  store[LIST_PATH] = { name: 'Newsletter' }
  seedContact(OPTED_IN, grantedHere(OPTED_IN_AT))
  seedContact(REFUSED, { marketingConsent: false })
})

describe('the dry run', () => {
  it('warns about role accounts and purchase-tell columns without refusing them', async () => {
    const plan = await dryRun([{ email: 'sales@lumen.co' }, { email: UNKNOWN }], context(attest(true), 'editor-uid', ['Email', 'Append Source']))
    const screening = plan.warnings.find((warning) => warning.class === 'screening')
    expect(screening?.requiresAcknowledgement).toBe(true)
    expect(plan.acknowledgementsRequired).toContain('screening')
    expect(screening?.samples.map((sample) => sample.value)).toEqual(expect.arrayContaining(['Append Source', 'sales@lumen.co']))
    // Reported, not refused.
    expect(plan.summary.create).toBe(2)
  })

  it('says, before anything is written, that nobody without an opt-in is added when nobody stated permission', async () => {
    const plan = await dryRun([{ email: OPTED_IN }, { email: UNKNOWN }], context(attest(false)))
    const details = plan.warnings.find((warning) => warning.class === 'screening')?.samples.map((sample) => sample.detail) ?? []
    expect(details.join(' ')).toContain('will not be added')
  })

  it('writes no member, and records who stated permission on the list’s import ledger', async () => {
    await dryRun([{ email: UNKNOWN }], context(attest(true)))
    expect(memberRows()).toEqual([])
    expect(store[LEDGER_PATH]).toMatchObject({ attested: true, attestedByUid: 'editor-uid', listName: 'Newsletter' })
    expect(store[LEDGER_PATH]?.['screening']?.sample).toMatchObject({ size: 1, needAttestation: 1 })
  })

  it('stamps the ledger to expire once its job can no longer write: 7 days to apply, 7 to undo, and a day (AGL-3549)', async () => {
    const before = Date.now()
    await dryRun([{ email: UNKNOWN }], context(attest(true)))
    const at = (store[LEDGER_PATH]?.['expiresAt'] as { __millis: number }).__millis
    const DAY = 24 * 60 * 60 * 1000
    expect(at).toBeGreaterThanOrEqual(before + 15 * DAY)
    expect(at).toBeLessThanOrEqual(Date.now() + 15 * DAY)
  })

  it('records no attester when nobody stated permission', async () => {
    await dryRun([{ email: UNKNOWN }], context(attest(false)))
    expect(store[LEDGER_PATH]).toMatchObject({ attested: false, attestedByUid: null })
  })

  it('fails a line that is not an address, by name, and skips a repeated address', async () => {
    const plan = await dryRun([{ email: UNKNOWN }, { email: UNKNOWN.toUpperCase() }, { email: 'not an address' }], context(attest(true)))
    expect(plan.rows.map((row) => row.verdict)).toEqual(['create', 'skip', 'fail'])
    expect(plan.rows[1]?.reason).toBe('duplicateInFile')
    expect(plan.rows[2]?.reason).toBe('missingRequired')
  })

  it('leaves somebody already on the list exactly as they are', async () => {
    store[`${MEMBERS_PATH}/m1`] = { email: UNKNOWN, name: 'Dev' }
    const plan = await dryRun([{ email: UNKNOWN, name: 'Somebody else', 'contact:jobTitle': 'CTO' }], context(attest(true)))
    expect(plan.rows[0]?.verdict).toBe('unchanged')
    expect(plan.rows[0]?.recordId).toBe('m1')
  })

  it('updates their contact details only when the operator chose to', async () => {
    store[`${MEMBERS_PATH}/m1`] = { email: UNKNOWN, name: 'Dev' }
    const plan = await dryRun([{ email: UNKNOWN, 'contact:jobTitle': 'CTO' }], context(attest(true, true)))
    expect(plan.rows[0]?.verdict).toBe('update')
    expect(plan.rows[0]?.diff.map((change) => change.fieldId)).toEqual(['contact:jobTitle'])
  })

  it('holds back a contact detail of somebody the workspace holds unless the operator chose to change it', async () => {
    seedContact(UNKNOWN, { facets: { [HOST_ID]: { jobTitle: 'CEO' } } })
    const plan = await dryRun([{ email: UNKNOWN, 'contact:jobTitle': 'CTO' }], context(attest(true)))
    expect(plan.rows[0]?.verdict).toBe('create')
    expect(plan.rows[0]?.diff.map((change) => change.fieldId)).not.toContain('contact:jobTitle')
    expect(plan.rows[0]?.heldBack).toContain('contact:jobTitle')
  })

  it('refuses a member who may manage the site but not the organization’s lists', async () => {
    membership = { orgId: ORG_ID, member: { role: 'editor', allHosts: false, hostIds: [HOST_ID] } }
    await expect(dryRun([{ email: UNKNOWN }], context(attest(true)))).rejects.toMatchObject({ status: 403 })
  })

  it('refuses a list that does not exist', async () => {
    delete store[LIST_PATH]
    await expect(dryRun([{ email: UNKNOWN }], context(attest(true)))).rejects.toMatchObject({ status: 404 })
  })
})

describe('a suppressed address is never imported', () => {
  it('refuses one on the site list and one on the platform list, and adds the rest', async () => {
    hostSuppressed.add(OPTED_IN)
    platformSuppressed.add('lee@lumen.co')
    const { byRow } = await importRows([{ email: OPTED_IN }, { email: 'lee@lumen.co' }, { email: UNKNOWN }], attest(true))
    expect(byRow.get(0)).toMatchObject({ outcome: 'failed', reason: 'suppressed-host' })
    expect(byRow.get(1)).toMatchObject({ outcome: 'failed', reason: 'suppressed-platform' })
    expect(memberFor(OPTED_IN)).toBeUndefined()
    expect(memberFor(UNKNOWN)).toBeDefined()
  })

  it('refuses somebody whose contact record declines marketing email, statement or not', async () => {
    const { byRow } = await importRows([{ email: REFUSED }], attest(true))
    expect(byRow.get(0)).toMatchObject({ outcome: 'failed', reason: 'declined' })
    expect(memberFor(REFUSED)).toBeUndefined()
  })
})

describe('the consent basis an import records', () => {
  it('records an attested address as an OPERATOR assertion, by the account that stated it', async () => {
    await importRows([{ email: UNKNOWN }], attest(true))
    const member = memberFor(UNKNOWN)
    expect(entryOf(member)['marketingConsentBasis']).toBe('operator-attested')
    expect(entryOf(member)['marketingConsentByUid']).toBe('editor-uid')
  })

  it('carries a stored opt-in across with the PERSON’s own date', async () => {
    await importRows([{ email: OPTED_IN }], attest(true))
    const member = memberFor(OPTED_IN)
    expect(entryOf(member)['marketingConsentBasis']).toBe('contact-opt-in')
    expect(entryOf(member)['marketingConsentAtMs']).toBe(OPTED_IN_AT)
    expect(entryOf(member)['marketingConsentByUid']).toBeNull()
  })

  it('adds only the opted-in addresses when nobody stated permission', async () => {
    const { byRow } = await importRows([{ email: OPTED_IN }, { email: UNKNOWN }], attest(false))
    expect(memberFor(OPTED_IN)).toBeDefined()
    expect(memberFor(UNKNOWN)).toBeUndefined()
    expect(byRow.get(1)).toMatchObject({ outcome: 'failed', reason: 'no-basis' })
  })

  it('never takes a statement the dry run did not record, whatever the browser sends', async () => {
    const plan = await dryRun([{ email: UNKNOWN }], context(attest(false)))
    const ledger = ledgerWriter()
    await hooks.apply(context(attest(true)), { jobId: JOB_ID, index: 0, start: 0, end: 1, rows: plan.rows }, ledger.writer)
    expect(memberFor(UNKNOWN)).toBeUndefined()
  })

  it('attributes the basis to the account that STATED it, not the one that resumed', async () => {
    membership = { orgId: ORG_ID, member: { role: 'admin', allHosts: true } }
    await importRows([{ email: UNKNOWN }], attest(true), 'colleague-uid')
    expect(entryOf(memberFor(UNKNOWN))['marketingConsentByUid']).toBe('editor-uid')
  })

  it('keeps what the file declared as the reason on the attested row, and never on a pass-through', async () => {
    await importRows(
      [
        { email: UNKNOWN, declaredSource: 'Trade show', declaredAt: '2024-03-01' },
        { email: OPTED_IN, declaredSource: 'Bought from a broker' },
      ],
      attest(true),
    )
    expect(entryOf(memberFor(UNKNOWN))['marketingConsentReason']).toContain('Trade show')
    expect(entryOf(memberFor(UNKNOWN))['marketingConsentReason']).toContain('2024-03-01')
    expect(entryOf(memberFor(OPTED_IN))['marketingConsentReason']).toBe('')
  })

  it('stamps the import as the membership source, added by hand', async () => {
    await importRows([{ email: UNKNOWN }], attest(true))
    expect(memberFor(UNKNOWN)?.['source']).toBe(CONSOLE_IMPORT_SOURCE)
    expect(memberFor(UNKNOWN)?.['via']).toBe('manual')
  })
})

describe('the contact record', () => {
  it('hands a new member’s contact columns to the record system’s own door', async () => {
    await importRows([{ email: UNKNOWN, 'contact:firstName': 'Dev', 'contact:lastName': 'Rao', 'contact:jobTitle': 'CTO' }], attest(true))
    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({
      hostId: HOST_ID,
      identity: { email: UNKNOWN, name: 'Dev Rao' },
      interaction: { source: 'import' },
      profile: { firstName: 'Dev', lastName: 'Rao', jobTitle: 'CTO' },
    })
    // The list shows the name the parts make.
    expect(memberFor(UNKNOWN)?.['name']).toBe('Dev Rao')
  })

  it('touches no contact record when the file carries no contact column', async () => {
    await importRows([{ email: UNKNOWN, name: 'Dev' }], attest(true))
    expect(captured).toEqual([])
  })
})

describe('applying is resumable and never writes a row twice', () => {
  it('skips a row the ledger already holds', async () => {
    const plan = await dryRun([{ email: UNKNOWN }, { email: 'lee@lumen.co' }], context(attest(true)))
    const ledger = ledgerWriter(new Map([[0, { row: 0, outcome: 'created', recordId: 'earlier' }]]))
    const applied = await hooks.apply(context(attest(true)), { jobId: JOB_ID, index: 0, start: 0, end: 2, rows: plan.rows }, ledger.writer)
    expect(applied.results.find((result) => result.row === 0)?.recordId).toBe('earlier')
    expect(memberFor(UNKNOWN)).toBeUndefined()
    expect(memberFor('lee@lumen.co')).toBeDefined()
  })

  it('stops at a row boundary when the chunk’s time runs short', async () => {
    const plan = await dryRun([{ email: UNKNOWN }], context(attest(true)))
    const ledger = ledgerWriter()
    const applied = await hooks.apply(
      context(attest(true)),
      { jobId: JOB_ID, index: 0, start: 0, end: 1, rows: plan.rows },
      { ...ledger.writer, timeLeftMs: () => 0 },
    )
    expect(applied.results).toEqual([])
    expect(memberRows()).toEqual([])
  })
})

describe('undo', () => {
  it('takes the import’s new members off the list again', async () => {
    const { applied } = await importRows([{ email: UNKNOWN }], attest(true))
    const reverted = await hooks.revert(context(), { jobId: JOB_ID, chunk: 0, entries: applied.undo })
    expect(reverted.done.map((step) => step.action)).toEqual(['delete'])
    expect(memberFor(UNKNOWN)).toBeUndefined()
  })

  it('never deletes a membership that now records a refusal', async () => {
    const { applied } = await importRows([{ email: UNKNOWN }], attest(true))
    const path = Object.keys(store).find((key) => key.startsWith(`${MEMBERS_PATH}/`)) as string
    store[path] = { ...store[path], marketingConsent: false, marketingConsentByHost: { [HOST_ID]: { marketingConsent: false } } }
    await hooks.revert(context(), { jobId: JOB_ID, chunk: 0, entries: applied.undo }, { [applied.undo[0]?.recordId as string]: 'revert' })
    expect(store[path]).toBeDefined()
  })

  it('writes no undo entry for somebody who was already on the list', async () => {
    store[`${MEMBERS_PATH}/m1`] = { email: UNKNOWN }
    const { applied } = await importRows([{ email: UNKNOWN, 'contact:jobTitle': 'CTO' }], attest(true, true))
    expect(applied.undo).toEqual([])
    expect(captured).toHaveLength(1)
  })
})

describe('the export', () => {
  beforeEach(() => {
    store[`${MEMBERS_PATH}/a`] = { email: OPTED_IN, name: 'Priya', via: 'manual', searchTokens: ['priya'], ...grantedHere(OPTED_IN_AT) }
    store[`${MEMBERS_PATH}/b`] = { email: UNKNOWN, name: 'Dev', via: 'rule', searchTokens: ['dev'] }
  })

  it('reads only the chosen fields, page by page', async () => {
    const page = await hooks.readPage(context(), null, ['email', 'consent'], { pageSize: 1 })
    expect(page.rows).toEqual([{ email: OPTED_IN, consent: 'granted' }])
    const next = await hooks.readPage(context(), page.next, ['email', 'consent'], { pageSize: 1 })
    expect(next.rows).toEqual([{ email: UNKNOWN, consent: 'unrecorded' }])
  })

  it('reads the selection, and the table’s own filter', async () => {
    expect((await hooks.readPage(context(), null, ['email'], { ids: ['b'] })).rows).toEqual([{ email: UNKNOWN }])
    const filtered = await hooks.readPage(context(), null, ['email'], {
      filter: { filters: [{ path: 'via', op: '==', value: 'rule' }] },
    })
    expect(filtered.rows).toEqual([{ email: UNKNOWN }])
    expect(await hooks.count?.(context(), { filter: { filters: [{ path: 'via', op: '==', value: 'rule' }] } })).toBe(1)
  })

  it('refuses a filter the table could never have asked', async () => {
    await expect(
      hooks.readPage(context(), null, ['email'], { filter: { filters: [{ path: 'marketingConsent', op: '==', value: 'x' }] } }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('reads nothing for a collaborator scoped to some sites', async () => {
    expect((await hooks.readPage(context(), null, ['email'], { scopeTokens: ['host:site-1'] })).rows).toEqual([])
    expect(await hooks.count?.(context(), { scopeTokens: ['host:site-1'] })).toBe(0)
  })
})
