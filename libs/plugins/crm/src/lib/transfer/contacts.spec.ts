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

/** The site's unsubscribe list, as `site-marketing-sync` files and lifts an outside list's rows. */
const mockUnsubscribes: Array<{ action: 'record' | 'release'; hostId: string; email: string; via: string }> = []
jest.mock('@aglyn/tenant-data-admin/server/site-marketing-sync', () => {
  const { personKey } = jest.requireActual('@aglyn/aglyn/app-utils/person-key')
  return {
    __esModule: true,
    recordSiteUnsubscribe: async (input: { hostId: string; email: string; via: string }) => {
      mockUnsubscribes.push({ action: 'record', hostId: input.hostId, email: input.email, via: input.via })
      const ref = mockMemory.firestore.collection('hosts').doc(input.hostId).collection('suppressions').doc(personKey(input.email))
      if ((await ref.get()).exists) return { created: false }
      await ref.set({ email: input.email, reason: 'unsubscribe', via: input.via })
      return { created: true }
    },
    releaseSiteUnsubscribe: async (input: { hostId: string; email: string; via: string }) => {
      mockUnsubscribes.push({ action: 'release', hostId: input.hostId, email: input.email, via: input.via })
      const ref = mockMemory.firestore.collection('hosts').doc(input.hostId).collection('suppressions').doc(personKey(input.email))
      const snapshot = await ref.get()
      if (!snapshot.exists || snapshot.get('via') !== input.via) return false
      await ref.delete()
      return true
    },
  }
})

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
        // The retention as the real door keeps it: every refusal the record
        // holds, filed under the person, before the document goes.
        const data = snapshot.data() as Record<string, any>
        const refusals = Object.fromEntries(
          Object.entries((data['marketingConsentByHost'] ?? {}) as Record<string, any>).filter(
            ([, entry]) => entry?.marketingConsent === false,
          ),
        )
        if (Object.keys(refusals).length && data['email']) {
          await mockMemory.firestore
            .collection('orgs')
            .doc('org-1')
            .collection('retainedRefusals')
            .doc(String(data['email']))
            .set({ marketingConsentByHost: refusals })
        }
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
import { hostScopeToken, ORG_SCOPE_TOKEN } from '@aglyn/aglyn/app-utils/scope-tokens'
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
  mockUnsubscribes.length = 0
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
    // The org has chosen no default, so the company is the whole org's; the
    // site the file came in on is its provenance.
    expect(globex?.[1]).toMatchObject({ visibleTo: [ORG_SCOPE_TOKEN], hostId: SITE })
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

  /*
   * A row whose one number is a Mobile (AGL-4122): the capture door makes the
   * mobile the number the person is found by when there is no Phone, which
   * it can only do if the row hands it over as the mobile.
   */
  it('hands the capture door a row whose one number is a Mobile as the mobile', async () => {
    const job = await uploaded('Email,First Name,Last Name,Mobile\njordan@example.com,Jordan,Lee,(512) 555-0123')
    const { match } = await analyzeTransferJob(deps, { orgId: ORG, jobId: job.id, actorUid: ME })
    const plan = await planTransferJob(deps, { orgId: ORG, jobId: job.id, actorUid: ME, choices: { mapping: match.mapping } })
    expect(plan.summary).toMatchObject({ create: 1 })
    await applyTransferJob(deps, {
      orgId: ORG,
      jobId: job.id,
      actorUid: ME,
      acknowledged: plan.acknowledgementsRequired as TransferWarningClass[],
      deadlineMs: Date.now() + 120_000,
      driver: 'spec',
    })
    const jordan = mockCaptures.find((options) => options.email === 'jordan@example.com')
    expect(jordan?.facet).toMatchObject({ firstName: 'Jordan', lastName: 'Lee', mobilePhone: '+15125550123' })
    expect(jordan?.facet).not.toHaveProperty('phone')
  })

  it('never takes consent from a file', async () => {
    const job = await uploaded('Email,Marketing consent\nnew@person.test,yes')
    const { match } = await analyzeTransferJob(deps, { orgId: ORG, jobId: job.id, actorUid: ME })
    const plan = await planTransferJob(deps, { orgId: ORG, jobId: job.id, actorUid: ME, choices: { mapping: match.mapping } })
    expect(plan.rows.rows[0]?.heldBack).toEqual(['marketingConsent'])
  })
})

/*
 * A store's customer file (AGL-4245): its marketing choices are carried under
 * the import's rules — an opt-in only on the Permission statement, an opt-out
 * always, never an opt-in over an unsubscribe — and undo puts back what stood.
 */
describe('a Shopify customers file', () => {
  const SHOPIFY_FILE = [
    'Customer ID,First Name,Last Name,Email,Accepts Email Marketing,Accepts SMS Marketing,Total Spent,Total Orders,Tags',
    '101,Rae,New,rae@example.com,yes,yes,10.00,1,"vip, local"',
    '102,Noa,New,noa@example.com,no,no,0.00,0,',
    '103,Sub,Scriber,sub@example.com,no,no,5.00,1,',
    '104,Un,Sub,unsub@example.com,yes,no,5.00,1,',
    '105,Pat,Pending,pat@example.com,Pending,no,0.00,0,',
  ].join('\n')
  const SITE_PATH = (email: string) => `hosts/${SITE}/suppressions/${email}`
  const entryOf = (id: string) =>
    ((mockMemory.read(`${CONTACTS}/${id}`)?.['marketingConsentByHost'] as Record<string, any> | undefined) ?? {})[SITE]
  const newId = (email: string) => `c-${email.split('@')[0]}`

  beforeEach(() => {
    mockMemory.seed(`${CONTACTS}/sub`, {
      email: 'sub@example.com',
      visibleTo: SITE_TOKENS,
      marketingConsentByHost: { [SITE]: { marketingConsent: true, marketingConsentAtMs: 5 } },
      facets: { [SITE]: { sources: { form: true }, interactions: [], firstName: 'Sub', lastName: 'Scriber' } },
    })
    mockMemory.seed(`${CONTACTS}/unsub`, {
      email: 'unsub@example.com',
      visibleTo: SITE_TOKENS,
      marketingConsentByHost: { [SITE]: { marketingConsent: false, marketingConsentAtMs: 6 } },
      facets: { [SITE]: { sources: { form: true }, interactions: [], firstName: 'Un', lastName: 'Sub' } },
    })
  })

  async function planned(attest: boolean | undefined) {
    const job = await uploaded(SHOPIFY_FILE)
    const { match } = await analyzeTransferJob(deps, { orgId: ORG, jobId: job.id, actorUid: ME })
    const plan = await planTransferJob(deps, {
      orgId: ORG,
      jobId: job.id,
      actorUid: ME,
      choices: { mapping: match.mapping, ...(attest === undefined ? {} : { extras: { 'crm-consent': { attest } } }) },
    })
    return { job, match, plan }
  }

  async function applied(jobId: string, acknowledged: string[]) {
    return applyTransferJob(deps, {
      orgId: ORG,
      jobId,
      actorUid: ME,
      acknowledged: acknowledged as TransferWarningClass[],
      deadlineMs: Date.now() + 120_000,
      driver: 'spec',
    })
  }

  it('maps itself, and says what the file’s choices come to', async () => {
    const { match, plan } = await planned(undefined)
    expect(Object.values(match.mapping)).toEqual(
      expect.arrayContaining(['email', 'firstName', 'lastName', 'emailMarketingChoice', 'smsMarketingChoice', 'tags']),
    )
    const screening = plan.warnings.find((warning) => warning.class === 'screening')
    expect(screening?.samples.map((sample) => sample.detail)).toEqual(
      expect.arrayContaining([
        'Nobody will be opted in to marketing email from this file.',
        '2 unsubscribes from your Shopify file will be kept, and 1 person subscribed here will be unsubscribed. Undoing the import keeps these unsubscribes, because they are each person’s own choice.',
        '1 person has no marketing choice recorded, and nothing about their marketing email changes.',
        expect.stringContaining('1 person said yes in your Shopify file but will not be opted in, because you did not confirm'),
        '1 person said yes in your Shopify file but unsubscribed here, so they stay unsubscribed.',
        expect.stringContaining('The text message marketing column is not kept'),
        expect.stringContaining('Total spent and order counts from your old store are not kept'),
      ]),
    )
    expect(plan.acknowledgementsRequired).toContain('screening')
  })

  it('without the statement opts nobody in, and keeps every unsubscribe with where it came from', async () => {
    const { job, plan } = await planned(false)
    await applied(job.id, plan.acknowledgementsRequired)
    // Rae said yes, and nobody confirmed it: no consent at all.
    expect(entryOf(newId('rae@example.com'))).toBeUndefined()
    // Noa said no: her refusal is recorded, with its provenance.
    expect(entryOf(newId('noa@example.com'))).toMatchObject({
      marketingConsent: false,
      marketingConsentSource: { kind: 'contact-import', by: ME, source: 'shopify', jobId: job.id, actor: 'operator' },
    })
    expect(entryOf(newId('noa@example.com')).marketingConsentSource.reason).toMatch(/^Unsubscribed as a Shopify customer file recorded/)
    // Sub was subscribed here: unsubscribed, and on the site's list.
    expect(entryOf('sub')).toMatchObject({ marketingConsent: false })
    expect(mockUnsubscribes).toEqual([{ action: 'record', hostId: SITE, email: 'sub@example.com', via: 'crm-import:shopify' }])
    // Un's own refusal stands, and Pat is left as they are.
    expect(entryOf('unsub')).toEqual({ marketingConsent: false, marketingConsentAtMs: 6 })
    expect(entryOf(newId('pat@example.com'))).toBeUndefined()
  })

  it('on the statement opts the yes people in, never over an unsubscribe; undo takes back the opt-ins and keeps every unsubscribe', async () => {
    const { job, plan } = await planned(true)
    expect(plan.warnings.find((warning) => warning.class === 'screening')?.samples[0]?.detail).toBe(
      '1 person will be opted in to marketing email, as your Shopify file records and as you confirmed they agreed to hear from you.',
    )
    await applied(job.id, plan.acknowledgementsRequired)
    const rae = entryOf(newId('rae@example.com'))
    expect(rae).toMatchObject({
      marketingConsent: true,
      marketingConsentSource: { kind: 'contact-import', by: ME, source: 'shopify', jobId: job.id },
    })
    expect(rae.marketingConsentSource.reason).toMatch(/confirmed these people agreed to hear from this business\.$/)
    expect(entryOf('unsub')).toEqual({ marketingConsent: false, marketingConsentAtMs: 6 })
    expect(entryOf('sub')).toMatchObject({ marketingConsent: false })
    const subRow = [...mockMemory.docs.keys()].find((path) => path.startsWith(`hosts/${SITE}/suppressions/`))
    expect(subRow).toBeDefined()

    const preview = await planTransferJobUndo(deps, { orgId: ORG, jobId: job.id, actorUid: ME })
    expect(preview.counts).toMatchObject({ conflict: 0 })
    await applyTransferJobUndo(deps, {
      orgId: ORG,
      jobId: job.id,
      actorUid: ME,
      otherwise: 'keep',
      deadlineMs: Date.now() + 120_000,
      driver: 'spec',
    })
    // Rae's opt-in went with her.
    expect(mockMemory.read(`${CONTACTS}/${newId('rae@example.com')}`)).toBeUndefined()
    expect(mockMemory.read(`orgs/${ORG}/retainedRefusals/rae@example.com`)).toBeUndefined()
    // Sub's unsubscribe is their own choice: it stays, and so does the list row.
    expect(entryOf('sub')).toMatchObject({ marketingConsent: false, marketingConsentSource: { kind: 'contact-import' } })
    expect(mockMemory.read(subRow as string)).toBeDefined()
    expect(mockUnsubscribes.map((entry) => entry.action)).toEqual(['record'])
    // Noa is let go, and her refusal is kept as a deleted contact's is.
    expect(mockMemory.read(`${CONTACTS}/${newId('noa@example.com')}`)).toBeUndefined()
    expect(mockMemory.read(`orgs/${ORG}/retainedRefusals/noa@example.com`)).toMatchObject({
      marketingConsentByHost: { [SITE]: { marketingConsent: false, marketingConsentSource: { kind: 'contact-import' } } },
    })
  })

  it('undo restores every other field of an existing contact and leaves the unsubscribe in place', async () => {
    const job = await uploaded('Email,Job title,Accepts Email Marketing\nsub@example.com,Buyer,no')
    const { match } = await analyzeTransferJob(deps, { orgId: ORG, jobId: job.id, actorUid: ME })
    const plan = await planTransferJob(deps, { orgId: ORG, jobId: job.id, actorUid: ME, choices: { mapping: match.mapping } })
    await applied(job.id, plan.acknowledgementsRequired)
    expect((mockMemory.read(`${CONTACTS}/sub`)?.['facets'] as Record<string, any>)[SITE].jobTitle).toBe('Buyer')
    const preview = await planTransferJobUndo(deps, { orgId: ORG, jobId: job.id, actorUid: ME })
    expect(preview.counts).toMatchObject({ restore: 1, conflict: 0 })
    await applyTransferJobUndo(deps, {
      orgId: ORG,
      jobId: job.id,
      actorUid: ME,
      otherwise: 'keep',
      deadlineMs: Date.now() + 120_000,
      driver: 'spec',
    })
    expect((mockMemory.read(`${CONTACTS}/sub`)?.['facets'] as Record<string, any>)[SITE].jobTitle).toBeUndefined()
    expect(entryOf('sub')).toMatchObject({ marketingConsent: false })
    expect(mockUnsubscribes.map((entry) => entry.action)).toEqual(['record'])
  })

  it('checks again at the write: somebody who unsubscribed after the dry run is not opted in', async () => {
    const { job, plan } = await planned(true)
    const { personKey } = jest.requireActual('@aglyn/aglyn/app-utils/person-key')
    // Rae is created by the import; her address lands on the site's list before it runs.
    mockMemory.seed(`hosts/${SITE}/suppressions/${personKey('rae@example.com')}`, { email: 'rae@example.com', reason: 'unsubscribe' })
    const done = await applied(job.id, plan.acknowledgementsRequired)
    expect(entryOf(newId('rae@example.com'))).toBeUndefined()
    expect(done.results.find((result) => result.row === 0)?.message).toBe('Not opted in: they unsubscribed here.')
  })
})

describe('a file with no site (AGL-4122)', () => {
  const NO_EMAIL_FILE = ['First Name,Last Name,Phone', 'Jordan,Lee,+15125550107'].join('\n')

  it('files the people under the organization, with no email needed', async () => {
    const atOrg = await uploaded(NO_EMAIL_FILE, null)
    const { match } = await analyzeTransferJob(deps, { orgId: ORG, jobId: atOrg.id, actorUid: ME })
    await expect(
      planTransferJob(deps, { orgId: ORG, jobId: atOrg.id, actorUid: ME, choices: { mapping: match.mapping } }),
    ).resolves.toBeDefined()
  })
})

describe('who and where', () => {
  it('needs a site to import into when the org keeps its sites apart, and the CRM on the plan', async () => {
    mockMemory.seed(`orgs/${ORG}`, { plan: 'starter', crm: { defaultRecordScope: 'host' } })
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
