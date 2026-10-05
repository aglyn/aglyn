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
 * `crm.contacts` (AGL-3527) through the real job engine: a Salesforce file
 * maps itself, matches by email, resolves the company and the owner as
 * lookups, holds back what the CRM's rules refuse, writes new people
 * through the capture door and matched people through the profile patch,
 * exports names a file carries back, and undoes what it did.
 *
 * WHAT THE DOUBLES MODEL: Firestore is an in-memory store
 * (`testing/memory-firestore.ts`) every hook and the engine read and write;
 * the capture door is a double that writes the facet the real door would
 * and answers its verdict (the door's own rules are `upsert-contact`'s
 * specs'); the field catalog, the header matcher, the plan, the
 * company link planner and the profile patch are the real ones.
 */

const mockMemory = (
  jest.requireActual('../testing/memory-firestore') as typeof import('../testing/memory-firestore')
).memoryFirestore()
const mockEvents: Array<{ type: string; payload: Record<string, unknown> }> = []
const mockCaptures: Array<Record<string, any>> = []
let mockMembers: Array<Record<string, unknown>> = []

jest.mock('firebase-admin/firestore', () =>
  (jest.requireActual('../testing/memory-firestore') as typeof import('../testing/memory-firestore')).memoryFirestoreModule,
)

jest.mock('@aglyn/tenant-runtime', () => ({
  __esModule: true,
  emitHostEvent: async (_hostId: string, type: string, payload: Record<string, unknown>) =>
    void mockEvents.push({ type, payload }),
}))

jest.mock('@aglyn/tenant-data-admin', () => {
  const link = jest.requireActual('../../../../../tenant/data/admin/src/lib/server/contact-company-link')
  const contacts = jest.requireActual('@aglyn/aglyn/app-utils/contacts')
  return {
    __esModule: true,
    firebaseAdmin: { app: () => ({ firestore: () => mockMemory.firestore }) },
    listOrgMembers: async () => mockMembers,
    crmRecordsQuotaForOrg: async () => ({ crmRecordsCount: 0 }),
    prepareContactCaptureBatch: async (hostId: string, emails: string[]) => ({ hostId, emails }),
    restampCrmListFieldsOf: async () => ({ restamped: 0, current: 0, missing: 0 }),
    contactCompanyLinkFields: link.contactCompanyLinkFields,
    companyContactsCountFields: link.companyContactsCountFields,
    // The removal's transaction, as `retained-refusals` runs it: a detach
    // drops the holder's paths, a delete the document.
    removeContactKeepingRefusals: async (input: {
      contactRef: { get: () => Promise<any>; delete: () => Promise<void>; update: (patch: unknown) => Promise<void> }
      decide: (contact: Record<string, unknown>) => any
    }) => {
      const snapshot = await input.contactRef.get()
      if (!snapshot.exists) return { outcome: 'missing' }
      const decided = input.decide(snapshot.data())
      if ('refused' in decided) return { outcome: 'refused', error: decided.refused }
      if (decided.action === 'delete') {
        await input.contactRef.delete()
        return { outcome: 'deleted' }
      }
      void contacts
      return { outcome: 'detached' }
    },
  }
})

/**
 * The capture door (AGL-2605), as far as a transfer depends on it: dedupe by
 * address, the person filed in the capturing group's facet and scope. It
 * records what it was handed.
 */
jest.mock('../server/capture-host-contact', () => {
  const groups = jest.requireActual('@aglyn/aglyn/app-utils/consent-groups')
  const tokens = jest.requireActual('@aglyn/aglyn/app-utils/scope-tokens')
  return {
    __esModule: true,
    captureHostContact: async (options: Record<string, any>) => {
      mockCaptures.push(options)
      const contacts = mockMemory.firestore.collection('orgs').doc('org-1').collection('contacts')
      const existing = (await contacts.where('email', '==', options.email).get()).docs[0]
      if (existing) return { contactId: existing.id, created: false }
      const group = groups.soloConsentGroup(options.hostId)
      const ref = contacts.doc(`c-${options.email.split('@')[0]}`)
      await ref.set({
        email: options.email,
        visibleTo: [tokens.hostScopeToken(options.hostId)],
        capturedByHostIds: [options.hostId],
        facets: {
          [group.groupId]: {
            sources: { import: true },
            interactions: [{ atMs: 1, summary: options.interaction.summary }],
            tags: options.tags ?? [],
            ...(options.name ? { name: options.name } : {}),
            ...options.facet,
          },
        },
      })
      return { contactId: ref.id, created: true }
    },
  }
})

import { TRANSFER_UNDO_WINDOW_MS, type TransferWarningClass } from '@aglyn/aglyn/data-transfer'
import { hostScopeToken } from '@aglyn/aglyn/app-utils/scope-tokens'
import {
  resetTransferResourcesForTests,
  resolveTransferResource,
  transferRecordsHooks,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import {
  analyzeTransferJob,
  applyTransferJob,
  applyTransferJobUndo,
  planTransferJob,
  planTransferJobUndo,
  TransferEngineError,
  uploadTransferSource,
  type TransferBucket,
  type TransferEngineDeps,
} from '@aglyn/tenant-data-admin/server/transfer-jobs'
import { registerCrmTransferResources } from './register'

const ORG = 'org-1'
const SITE = 'site-1'
const ME = 'uid-me'
const CONTACTS = `orgs/${ORG}/contacts`
const COMPANIES = `orgs/${ORG}/companies`
const SITE_TOKENS = [hostScopeToken(SITE)]

const files = new Map<string, Buffer>()
const bucket: TransferBucket = {
  file: (path) => ({
    save: async (data) => void files.set(path, Buffer.from(data)),
    download: async () => [files.get(path) as Buffer],
    delete: async () => void files.delete(path),
  }),
}
const deps: TransferEngineDeps = { firestore: mockMemory.firestore, bucket, now: () => Date.now() }

const SALESFORCE_FILE = [
  'Email,Salutation,First Name,Last Name,Account Name,Contact Owner,Lifecycle Stage,Do Not Call,Mailing City,Mailing Country',
  'ana@acme.com,Ms.,Ana,Lopez,Acme,Sam Owner,Lead,no,Austin,US',
  'bo@globex.test,Dr.,Bo,Ray,Globex,sam@agency.test,Customer,yes,Boston,US',
].join('\n')

beforeEach(() => {
  mockMemory.docs.clear()
  files.clear()
  mockEvents.length = 0
  mockCaptures.length = 0
  mockMembers = [{ $id: 'uid-sam', email: 'sam@agency.test', displayName: 'Sam Owner' }]
  mockMemory.seed(`orgs/${ORG}`, { plan: 'starter' })
  mockMemory.seed(`${COMPANIES}/acme`, { name: 'Acme', nameLower: 'acme', domain: 'acme.com', visibleTo: SITE_TOKENS })
  mockMemory.seed(`${CONTACTS}/ana`, {
    email: 'ana@acme.com',
    visibleTo: SITE_TOKENS,
    facets: {
      [SITE]: {
        sources: { form: true },
        interactions: [],
        lifecycleStage: 'customer',
        doNotCall: true,
        tags: ['vip'],
        jobTitle: 'Founder',
      },
    },
  })
  resetTransferResourcesForTests()
  registerCrmTransferResources('crm')
})

async function uploaded(content: string, hostId: string | null = SITE) {
  const { job } = await uploadTransferSource(deps, {
    orgId: ORG,
    actorUid: ME,
    resource: 'crm.contacts',
    ...(hostId ? { hostId } : {}),
    fileName: 'salesforce.csv',
    content,
  })
  return job
}

async function refusal(promise: Promise<unknown>): Promise<TransferEngineError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof TransferEngineError) return error
    throw error
  }
  throw new Error('expected a refusal')
}

describe('a Salesforce contacts file', () => {
  it('maps itself from the Salesforce headers, and lists the company and owner it cannot find', async () => {
    const job = await uploaded(SALESFORCE_FILE)
    const proposal = await analyzeTransferJob(deps, { orgId: ORG, jobId: job.id, actorUid: ME })
    expect(proposal.match.mapping).toEqual({
      0: 'email',
      1: 'salutation',
      2: 'firstName',
      3: 'lastName',
      4: 'company',
      5: 'owner',
      6: 'lifecycleStage',
      7: 'doNotCall',
      8: 'mailingCity',
      9: 'mailingCountry',
    })
    // A spelling only Salesforce writes is matched from its dictionary, and says so.
    const sf = await uploaded('Email,Mailing Zip/Postal Code,Asst. Phone\na@b.test,78701,+1 512 555 0100')
    const named = await analyzeTransferJob(deps, { orgId: ORG, jobId: sf.id, actorUid: ME })
    expect(named.match.proposals.map((entry) => [entry.fieldId, entry.source ?? null])).toEqual([
      ['email', null],
      ['mailingPostalCode', 'Salesforce'],
      // A field's own spelling wins before any dictionary is asked.
      ['assistantPhone', null],
    ])

    const read = await analyzeTransferJob(deps, { orgId: ORG, jobId: job.id, actorUid: ME, mapping: proposal.match.mapping })
    // "Acme" is a company; "Globex" is not, and "Sam Owner" is a member by name.
    expect(read.lookups?.find((review) => review.fieldId === 'company')).toMatchObject({
      resolved: 1,
      unresolved: [{ value: 'Globex', key: 'globex', count: 1 }],
    })
    expect(read.lookups?.find((review) => review.fieldId === 'owner')).toMatchObject({ resolved: 2, unresolved: [] })
    expect(read.matches?.summary).toEqual({ new: 1, matched: 1, ambiguous: 0, duplicateInFile: 0 })
  })

  it('holds back what the CRM refuses, creates through the capture door, fills the matched person and undoes both', async () => {
    const job = await uploaded(SALESFORCE_FILE)
    const { match } = await analyzeTransferJob(deps, { orgId: ORG, jobId: job.id, actorUid: ME })
    const plan = await planTransferJob(deps, {
      orgId: ORG,
      jobId: job.id,
      actorUid: ME,
      choices: { mapping: match.mapping, lookupChoices: { company: { globex: { action: 'create' } } } },
    })
    expect(plan.summary).toMatchObject({ create: 1, update: 1 })
    // Ana is a customer: a file's "Lead" is a step back, and her Do not call stays on.
    const locked = plan.warnings.find((warning) => warning.class === 'lockedRule')
    expect(locked?.fieldIds.sort()).toEqual(['doNotCall', 'lifecycleStage'])
    const ana = plan.rows.rows.find((row) => row.recordId === 'ana')
    expect(ana?.heldBack.sort()).toEqual(['doNotCall', 'lifecycleStage'])
    expect(ana?.diff.map((change) => change.fieldId).sort()).toEqual(
      ['company', 'firstName', 'lastName', 'mailingCity', 'mailingCountry', 'owner', 'salutation'].sort(),
    )

    const applied = await applyTransferJob(deps, {
      orgId: ORG,
      jobId: job.id,
      actorUid: ME,
      acknowledged: plan.acknowledgementsRequired as TransferWarningClass[],
      deadlineMs: Date.now() + 120_000,
      driver: 'spec',
    })
    expect(applied.done).toBe(true)
    expect(applied.results.map((result) => [result.row, result.outcome])).toEqual([
      [0, 'updated'],
      [1, 'created'],
    ])

    // Bo came through the capture door, with the company the import created.
    const bo = mockCaptures.find((options) => options.email === 'bo@globex.test')
    expect(bo).toMatchObject({ hostId: SITE, source: 'import', campaignIds: [] })
    const globex = [...mockMemory.docs.entries()].find(([path, data]) => path.startsWith(COMPANIES) && data['name'] === 'Globex')
    expect(globex?.[1]).toMatchObject({ visibleTo: SITE_TOKENS, hostId: SITE })
    expect(bo?.facet).toMatchObject({
      firstName: 'Bo',
      lastName: 'Ray',
      salutation: 'Dr.',
      companyId: globex?.[0].split('/').pop(),
      companyName: 'Globex',
      ownerUid: 'uid-sam',
      lifecycleStage: 'customer',
      doNotCall: true,
      address: expect.objectContaining({ city: 'Boston', country: 'US' }),
    })
    // Ana kept her stage and her Do not call, and gained what she lacked.
    const anaFacet = (mockMemory.read(`${CONTACTS}/ana`)?.['facets'] as Record<string, any>)[SITE]
    expect(anaFacet).toMatchObject({
      lifecycleStage: 'customer',
      doNotCall: true,
      firstName: 'Ana',
      lastName: 'Lopez',
      name: 'Ana Lopez',
      companyId: 'acme',
      companyName: 'Acme',
      ownerUid: 'uid-sam',
      jobTitle: 'Founder',
    })
    expect(mockEvents.filter((event) => event.type === 'contactStageChanged')).toEqual([])

    // Undo: Bo is let go by the site that imported him; Ana is put back.
    const preview = await planTransferJobUndo(deps, { orgId: ORG, jobId: job.id, actorUid: ME })
    expect(preview.counts).toMatchObject({ delete: 1, restore: 1, conflict: 0 })
    const undone = await applyTransferJobUndo(deps, {
      orgId: ORG,
      jobId: job.id,
      actorUid: ME,
      otherwise: 'keep',
      deadlineMs: Date.now() + 120_000,
      driver: 'spec',
    })
    expect(undone.done).toBe(true)
    expect(mockMemory.read(`${CONTACTS}/c-bo`)).toBeUndefined()
    const restored = (mockMemory.read(`${CONTACTS}/ana`)?.['facets'] as Record<string, any>)[SITE]
    expect(restored.firstName).toBeUndefined()
    expect(restored.companyId).toBeUndefined()
    expect(restored.lifecycleStage).toBe('customer')
    expect(TRANSFER_UNDO_WINDOW_MS).toBeGreaterThan(0)
  })

  it('advances a stage, and says so the way the stage route does', async () => {
    const job = await uploaded('Email,Lifecycle Stage\nana@acme.com,Evangelist')
    const { match } = await analyzeTransferJob(deps, { orgId: ORG, jobId: job.id, actorUid: ME })
    const plan = await planTransferJob(deps, { orgId: ORG, jobId: job.id, actorUid: ME, choices: { mapping: match.mapping } })
    expect(plan.summary).toMatchObject({ update: 1 })
    await applyTransferJob(deps, {
      orgId: ORG,
      jobId: job.id,
      actorUid: ME,
      acknowledged: plan.acknowledgementsRequired as TransferWarningClass[],
      deadlineMs: Date.now() + 120_000,
      driver: 'spec',
    })
    expect((mockMemory.read(`${CONTACTS}/ana`)?.['facets'] as Record<string, any>)[SITE].lifecycleStage).toBe('evangelist')
    expect(mockEvents).toEqual([
      {
        type: 'contactStageChanged',
        payload: { contactId: 'ana', email: 'ana@acme.com', lifecycleStage: 'evangelist', previousStage: 'customer' },
      },
    ])
  })

  it('never takes consent from a file', async () => {
    const job = await uploaded('Email,Marketing consent\nnew@person.test,yes')
    const { match } = await analyzeTransferJob(deps, { orgId: ORG, jobId: job.id, actorUid: ME })
    const plan = await planTransferJob(deps, { orgId: ORG, jobId: job.id, actorUid: ME, choices: { mapping: match.mapping } })
    expect(plan.rows.rows[0]?.heldBack).toEqual(['marketingConsent'])
  })
})

describe('who and where', () => {
  it('needs a site to import into, and the CRM on the plan', async () => {
    const atOrg = await uploaded(SALESFORCE_FILE, null)
    const { match } = await analyzeTransferJob(deps, { orgId: ORG, jobId: atOrg.id, actorUid: ME })
    const choices = { mapping: match.mapping, lookupChoices: { company: { globex: { action: 'leaveBlank' as const } } } }
    const noSite = await refusal(planTransferJob(deps, { orgId: ORG, jobId: atOrg.id, actorUid: ME, choices }))
    expect(noSite.message).toBe('Choose the site these contacts are imported into.')

    mockMemory.seed(`orgs/${ORG}`, { plan: 'free' })
    const free = await uploaded(SALESFORCE_FILE)
    await analyzeTransferJob(deps, { orgId: ORG, jobId: free.id, actorUid: ME })
    const refused = await refusal(planTransferJob(deps, { orgId: ORG, jobId: free.id, actorUid: ME, choices }))
    // The CRM routes' own answer (`suite-gate.ts`), as the transfer gate gives it (AGL-3555) —
    // here from the company lookup, the first part of the import that reaches the CRM.
    expect(refused.code).toBe('planRequired')
    expect(refused.status).toBe(403)
    expect(refused.details).toMatchObject({ reason: 'plan_required', code: 'crm' })
    expect(refused.message).toMatch(/is part of the CRM, which is not included in your current plan\./)
  })
})

describe('the export', () => {
  it('reads the site’s people with the company, the owner and the stage by name', async () => {
    mockMemory.seed(`${CONTACTS}/elsewhere`, { email: 'x@other.test', visibleTo: ['host:site-2'], facets: {} })
    const ana = mockMemory.read(`${CONTACTS}/ana`) as Record<string, any>
    ana['facets'][SITE] = { ...ana['facets'][SITE], companyId: 'acme', companyName: 'Acme', ownerUid: 'uid-sam' }
    mockMemory.seed(`${CONTACTS}/ana`, ana)
    const hooks = transferRecordsHooks(await resolveTransferResource('crm.contacts'))
    const ctx = { resource: 'crm.contacts', orgId: ORG, hostId: SITE, actorUid: ME }
    expect(await hooks.count?.(ctx, {})).toBe(1)
    const page = await hooks.readPage(ctx, null, ['id', 'email', 'company', 'owner', 'lifecycleStage', 'doNotCall'], {})
    expect(page).toEqual({
      rows: [
        {
          id: 'ana',
          email: 'ana@acme.com',
          company: 'Acme',
          owner: 'sam@agency.test',
          lifecycleStage: 'Customer',
          doNotCall: true,
        },
      ],
      next: null,
    })
    // The selection, by id, never past the site's view.
    const picked = await hooks.readPage(ctx, null, ['email'], { ids: ['elsewhere', 'ana'] })
    expect(picked.rows).toEqual([{ email: 'ana@acme.com' }])
  })
})
