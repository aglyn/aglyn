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

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  contactCompanyId,
  describeActivityCompany,
  groupIdForHost,
  planActivityCompany,
  primaryGroupId,
} from './activity-company-backfill.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO = join(here, '..', '..', '..')
const read = (path) => readFileSync(join(REPO, path), 'utf8')

const contactAt = (companyId, group = 'site-1') => ({
  capturedByHostIds: [group],
  facets: { [group]: { companyId } },
})
const GROUPED = { consentGroups: { brands: { name: 'Brands', hostIds: ['site-1', 'site-2'] } } }

describe('what a row is owed (AGL-4123)', () => {
  it('stands by a company the row names', () => {
    assert.deepEqual(
      planActivityCompany({
        activity: { companyId: 'co-1', dealId: 'd-1' },
        deal: { companyId: 'co-deal' },
      }),
      { skip: 'named' },
    )
  })

  it('takes the deal’s company before the contact’s', () => {
    assert.deepEqual(
      planActivityCompany({
        activity: { dealId: 'd-1', contactId: 'c-1', hostId: 'site-1' },
        deal: { companyId: 'co-deal' },
        contact: contactAt('co-contact'),
      }),
      { companyId: 'co-deal', from: 'deal d-1' },
    )
  })

  it('falls through a deal with no company to the contact’s', () => {
    assert.deepEqual(
      planActivityCompany({
        activity: { dealId: 'd-1', contactId: 'c-1', hostId: 'site-1' },
        deal: {},
        contact: contactAt('co-contact'),
      }),
      { companyId: 'co-contact', from: 'contact c-1' },
    )
  })

  it('leaves a row about no deal or contact, and one whose records name no company', () => {
    assert.deepEqual(planActivityCompany({ activity: { leadId: 'l-1' } }), { skip: 'no-record' })
    assert.deepEqual(planActivityCompany({ activity: { contactId: 'c-gone' } }), { skip: 'no-company' })
  })
})

describe('the contact’s company is one holder’s knowledge', () => {
  it('reads the facet of the site the entry was logged from', () => {
    assert.equal(contactCompanyId(contactAt('co-1'), { hostId: 'site-1' }, {}), 'co-1')
  })

  it('reads a declared group’s facet for any of its sites', () => {
    assert.equal(contactCompanyId(contactAt('co-1', 'brands'), { hostId: 'site-2' }, GROUPED), 'co-1')
    assert.equal(groupIdForHost(GROUPED, 'site-3'), 'site-3')
  })

  it('never reads another holder’s facet, or the mirror of them all', () => {
    const contact = { companyIds: ['co-other'], facets: { 'site-9': { companyId: 'co-other' } } }
    assert.equal(contactCompanyId(contact, { hostId: 'site-1' }, {}), '')
  })

  it('reads the organization’s own facet for a site with no link of its own', () => {
    const contact = { facets: { org: { companyId: 'co-org' } } }
    assert.equal(contactCompanyId(contact, { hostId: 'site-1' }, {}), 'co-org')
    assert.equal(contactCompanyId(contact, { hostId: null }, {}), 'co-org')
    assert.equal(primaryGroupId({ capturedByHostIds: ['site-1'], facets: { 'site-1': {}, org: {} } }, {}), 'org')
  })

  it('reads the primary holder for an entry from no site', () => {
    assert.equal(contactCompanyId(contactAt('co-1'), { hostId: null }, {}), 'co-1')
    const both = {
      capturedByHostIds: ['site-2', 'site-1'],
      facets: { 'site-1': { companyId: 'co-1' }, 'site-2': { companyId: 'co-2' } },
    }
    assert.equal(primaryGroupId(both, {}), 'site-2')
    assert.equal(primaryGroupId({ capturedByHostIds: ['site-1'] }, {}), 'site-1')
    assert.equal(primaryGroupId({}, {}), '')
  })
})

describe('the dry run', () => {
  it('prints the row, before and after, and where the company came from', () => {
    assert.equal(
      describeActivityCompany({
        orgId: 'org-1',
        id: 'act-1',
        activity: { kind: 'call', contactId: 'c-1', dealId: 'd-1' },
        plan: { companyId: 'co-1', from: 'deal d-1' },
      }),
      '  org-1/act-1 (call, contact c-1, deal d-1): companyId — → co-1, from deal d-1',
    )
  })
})

describe('the restatement', () => {
  const owner = read('libs/plugins/crm/src/lib/model/crm-activity-link.ts')

  it('keeps the order the writers follow: the named company, the deal’s, the contact’s', () => {
    assert.match(
      owner,
      /const named = idOf\(link\.companyId\) \|\| idOf\(sources\.deal\?\.\['companyId'\]\)/,
    )
  })

  it('reads the facet the writers read, through the same holder', () => {
    assert.match(owner, /sources\.groupId \|\| contactPrimaryGroup\(contact, org\)\.groupId/)
    assert.match(owner, /readContactFacet\(contact, groupId\)\.companyId/)
    assert.match(owner, /readContactFacet\(contact, ORG_CONTACT_HOLDER_ID\)\.companyId/)
  })

  it('restates the primary holder as its source says it', () => {
    const holder = read('libs/plugins/crm/src/lib/model/contact-holder.ts')
    assert.match(read('libs/aglyn/src/lib/app-utils/contacts.ts'), /ORG_CONTACT_HOLDER_ID = 'org'/)
    assert.match(holder, /if \(facetKeys\.includes\(ORG_CONTACT_HOLDER_ID\)\) return ORG_HOLDER_GROUP/)
    assert.match(holder, /for \(const hostId of captured\)/)
    assert.match(holder, /if \(facetKeys\.includes\(group\.groupId\)\) return group/)
    assert.match(holder, /if \(captured\.length\) return consentGroupForHost\(org, captured\[0\]\)/)
  })
})
