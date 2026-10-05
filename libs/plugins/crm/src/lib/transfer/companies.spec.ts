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
 * `crm.companies` (AGL-3527) through the real job engine: rows match by
 * domain, then name, within the site's view; the parent company is a
 * lookup the person can create; a picklist label the org lacks is added
 * when the person says so; a parent that would make a loop is refused for
 * its row; the export writes the parent and the owner by name and the
 * revenue with its currency; undo deletes what the import created.
 *
 * Firestore is the in-memory store every hook and the engine share.
 */

const mockMemory = (
  jest.requireActual('../testing/memory-firestore') as typeof import('../testing/memory-firestore')
).memoryFirestore()

jest.mock('firebase-admin/firestore', () =>
  (jest.requireActual('../testing/memory-firestore') as typeof import('../testing/memory-firestore')).memoryFirestoreModule,
)

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => mockMemory.firestore }) },
  listOrgMembers: async () => [{ $id: 'uid-sam', email: 'sam@agency.test', displayName: 'Sam Owner' }],
  crmRecordsQuotaForOrg: async () => ({ crmRecordsCount: 0 }),
  restampCrmListFieldsOf: async () => ({ restamped: 0, current: 0, missing: 0 }),
  restampCrmListFields: async () => undefined,
}))

import type { TransferWarningClass } from '@aglyn/aglyn/data-transfer'
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
  uploadTransferSource,
  type TransferBucket,
  type TransferEngineDeps,
} from '@aglyn/tenant-data-admin/server/transfer-jobs'
import { registerCrmTransferResources } from './register'

const ORG = 'org-1'
const SITE = 'site-1'
const ME = 'uid-me'
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

const company = (id: string) => mockMemory.read(`${COMPANIES}/${id}`) as Record<string, any>
const named = (name: string) =>
  [...mockMemory.docs.entries()].find(([path, data]) => path.startsWith(`${COMPANIES}/`) && data['name'] === name)

beforeEach(() => {
  mockMemory.docs.clear()
  files.clear()
  mockMemory.seed(`orgs/${ORG}`, { plan: 'starter' })
  mockMemory.seed(`${COMPANIES}/acme`, {
    name: 'Acme',
    nameLower: 'acme',
    domain: 'acme.com',
    industry: 'Technology',
    visibleTo: SITE_TOKENS,
    tags: ['partner'],
  })
  // Another client's Acme, which this site never sees.
  mockMemory.seed(`${COMPANIES}/acme-other`, { name: 'Acme', nameLower: 'acme', visibleTo: ['host:site-2'] })
  resetTransferResourcesForTests()
  registerCrmTransferResources('crm')
})

async function plannedImport(content: string, choices: Record<string, unknown> = {}) {
  const { job } = await uploadTransferSource(deps, {
    orgId: ORG,
    actorUid: ME,
    resource: 'crm.companies',
    hostId: SITE,
    fileName: 'accounts.csv',
    content,
  })
  const { match } = await analyzeTransferJob(deps, { orgId: ORG, jobId: job.id, actorUid: ME })
  const plan = await planTransferJob(deps, { orgId: ORG, jobId: job.id, actorUid: ME, choices: { mapping: match.mapping, ...choices } })
  return { job, match, plan }
}

const applyAll = async (jobId: string, acknowledged: readonly string[]) =>
  applyTransferJob(deps, {
    orgId: ORG,
    jobId,
    actorUid: ME,
    acknowledged: acknowledged as TransferWarningClass[],
    deadlineMs: Date.now() + 120_000,
    driver: 'spec',
  })

const FILE = [
  'Account Name,Website,Parent Account,Industry,Annual Revenue,Account Owner,Billing City',
  'Acme Labs,https://acme.com,Initech,Robotics,"$1,250,000.00",Sam Owner,Austin',
  'Globex,globex.test,Acme,Technology,,sam@agency.test,Springfield',
].join('\n')

describe('a Salesforce accounts file', () => {
  it('matches by domain within the site’s view, creates the parent it was told to, and adds the industry', async () => {
    const { job: upload } = await uploadTransferSource(deps, {
      orgId: ORG,
      actorUid: ME,
      resource: 'crm.companies',
      hostId: SITE,
      fileName: 'accounts.csv',
      content: FILE.replace('Website', 'Domain'),
    })
    const analysis = await analyzeTransferJob(deps, { orgId: ORG, jobId: upload.id, actorUid: ME })
    const mapping = analysis.match.mapping
    // An industry the org lacks needs the person's choice before a dry run.
    const unchosen = await planTransferJob(deps, {
      orgId: ORG,
      jobId: upload.id,
      actorUid: ME,
      choices: { mapping, lookupChoices: { parentCompany: { initech: { action: 'create' } } } },
    }).catch((error: { code?: string; details?: Record<string, string[]> }) => error)
    expect(unchosen).toMatchObject({ code: 'choicesNeeded' })
    expect(Object.keys((unchosen as { details: Record<string, string[]> }).details)).toEqual(['industry'])
    const read = await analyzeTransferJob(deps, { orgId: ORG, jobId: upload.id, actorUid: ME, mapping })
    const industry = read.picklists.find((entry) => entry.fieldId === 'industry')
    const robotics = industry?.unmatched.find((value) => value.value === 'Robotics')
    expect(robotics).toBeDefined()
    expect(read.lookups?.find((review) => review.fieldId === 'parentCompany')?.unresolved.map((entry) => entry.value)).toEqual([
      'Initech',
    ])

    const planned = await planTransferJob(deps, {
      orgId: ORG,
      jobId: upload.id,
      actorUid: ME,
      choices: {
        mapping,
        lookupChoices: { parentCompany: { initech: { action: 'create' } } },
        picklistChoices: { industry: { [robotics?.key as string]: { action: 'addValue' } } },
        policy: { fieldDefault: { mode: 'overwrite', blank: 'leave' } },
      },
    })
    // Acme Labs is acme.com — this site's Acme; Globex is new.
    expect(planned.summary).toMatchObject({ update: 1, create: 1 })
    await applyAll(upload.id, planned.acknowledgementsRequired)

    const initech = named('Initech')
    expect(initech?.[1]).toMatchObject({ visibleTo: SITE_TOKENS, hostId: SITE })
    expect(company('acme')).toMatchObject({
      name: 'Acme Labs',
      nameLower: 'acme labs',
      industry: 'Robotics',
      industryKey: expect.any(String),
      annualRevenueCents: 125_000_000,
      currency: 'usd',
      ownerUid: 'uid-sam',
      parentCompanyId: initech?.[0].split('/').pop(),
      address: expect.objectContaining({ city: 'Austin' }),
      tags: ['partner'],
    })
    const globex = named('Globex')
    expect(globex?.[1]).toMatchObject({ domain: 'globex.test', parentCompanyId: 'acme', industry: 'Technology', ownerUid: 'uid-sam' })
    const list = mockMemory.read(`orgs/${ORG}/crmPicklists/industry`) as Record<string, any>
    expect(list['values'].some((value: { label: string }) => value.label === 'Robotics')).toBe(true)
    // The other client's Acme was never touched.
    expect(company('acme-other')).toEqual({ name: 'Acme', nameLower: 'acme', visibleTo: ['host:site-2'] })

    // Undo deletes the companies the import made and puts Acme back.
    const undone = await applyTransferJobUndo(deps, {
      orgId: ORG,
      jobId: upload.id,
      actorUid: ME,
      otherwise: 'revert',
      deadlineMs: Date.now() + 120_000,
      driver: 'spec',
    })
    expect(undone.done).toBe(true)
    expect(named('Globex')).toBeUndefined()
    expect(company('acme')).toMatchObject({ name: 'Acme', industry: 'Technology' })
    expect(company('acme')['parentCompanyId']).toBeUndefined()
  })

  it('refuses a parent that would put a company under one beneath it, for that row alone', async () => {
    mockMemory.seed(`${COMPANIES}/child`, { name: 'Child', nameLower: 'child', parentCompanyId: 'acme', visibleTo: SITE_TOKENS })
    const { job, plan } = await plannedImport('Aglyn ID,Account Name,Parent Account\nacme,Acme,Child\nchild,Child,', {
      policy: { fieldDefault: { mode: 'overwrite', blank: 'leave' } },
    })
    const applied = await applyAll(job.id, plan.acknowledgementsRequired)
    expect(applied.results.find((result) => result.row === 0)).toMatchObject({
      outcome: 'failed',
      message: 'That company sits under this one, so it cannot be its parent.',
    })
    expect(company('acme')['parentCompanyId']).toBeUndefined()
  })
})

describe('the export', () => {
  it('writes the parent and the owner by name, the revenue with its currency, and nothing the site cannot see', async () => {
    mockMemory.seed(`${COMPANIES}/globex`, {
      name: 'Globex',
      nameLower: 'globex',
      parentCompanyId: 'acme',
      ownerUid: 'uid-sam',
      annualRevenueCents: 990_000,
      currency: 'eur',
      address: { city: 'Springfield', country: 'US' },
      visibleTo: SITE_TOKENS,
    })
    const hooks = transferRecordsHooks(await resolveTransferResource('crm.companies'))
    const ctx = { resource: 'crm.companies', orgId: ORG, hostId: SITE, actorUid: ME }
    expect(await hooks.count?.(ctx, {})).toBe(2)
    const page = await hooks.readPage(ctx, null, ['name', 'parentCompany', 'owner', 'annualRevenue', 'billingCity'], {})
    expect(page.rows).toEqual([
      { name: 'Acme', parentCompany: null, owner: null, annualRevenue: null, billingCity: null },
      { name: 'Globex', parentCompany: 'Acme', owner: 'sam@agency.test', annualRevenue: '9900.00 EUR', billingCity: 'Springfield' },
    ])
  })

  it('is the CRM’s: a plan without it exports no companies', async () => {
    mockMemory.seed(`orgs/${ORG}`, { plan: 'free' })
    const hooks = transferRecordsHooks(await resolveTransferResource('crm.companies'))
    await expect(hooks.readPage({ resource: 'crm.companies', orgId: ORG, hostId: SITE, actorUid: ME }, null, ['name'], {})).rejects.toMatchObject({
      code: 'planRequired',
      status: 403,
      details: { reason: 'plan_required', code: 'crm' },
    })
  })
})
