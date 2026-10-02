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
  CONTAINER_MEMBERSHIP_CAP,
  FORM_LEAD_SOURCE_PREFIX,
  formIdsOfLeadSources,
  planLeadFormCampaigns,
  SCOPED_SEARCH_JOIN,
  scopedSearchTokens,
} from './lead-form-campaigns-backfill.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const read = (path) => readFileSync(join(REPO_ROOT, path), 'utf8')

describe('the restated vocabulary (AGL-3458)', () => {
  it('holds the constants the TypeScript owns', () => {
    assert.match(
      read('libs/aglyn/src/lib/app-utils/forms.ts'),
      new RegExp(`export const FORM_LEAD_SOURCE_PREFIX = '${FORM_LEAD_SOURCE_PREFIX}'`),
    )
    assert.match(
      read('libs/aglyn/src/lib/app-utils/container-membership.ts'),
      new RegExp(`export const CONTAINER_MEMBERSHIP_CAP = ${CONTAINER_MEMBERSHIP_CAP}\\b`),
    )
    assert.match(
      read('libs/aglyn/src/lib/app-utils/name-search.ts'),
      new RegExp(`export const SCOPED_SEARCH_JOIN = '${SCOPED_SEARCH_JOIN}'`),
    )
  })

  it('reads the form ids a lead’s sources name, and nothing else', () => {
    assert.deepEqual(formIdsOfLeadSources(['form:a', 'booking', 'form:b', 'form:a', 'form:']), ['a', 'b'])
    assert.deepEqual(formIdsOfLeadSources(undefined), [])
  })

  it('joins every scope to every campaign', () => {
    assert.deepEqual(scopedSearchTokens(['host:s1', 'org'], ['c1', 'c2']), [
      'host:s1~c1',
      'host:s1~c2',
      'org~c1',
      'org~c2',
    ])
    assert.deepEqual(scopedSearchTokens(undefined, ['c1']), [])
  })
})

describe('which leads are re-filed under their form’s campaigns', () => {
  const forms = new Map([
    ['form-contact', ['camp-a']],
    ['form-cost', ['camp-b', 'camp-a']],
  ])
  const lead = (fields = {}) => ({
    email: 'dana@example.com',
    visibleTo: ['host:site-1'],
    sources: ['form:form-contact'],
    ...fields,
  })

  it('files a form lead that holds no campaign under its form’s, with the filter’s keys', () => {
    assert.deepEqual(planLeadFormCampaigns(lead(), forms), {
      campaignIds: ['camp-a'],
      scopedCampaignIds: ['host:site-1~camp-a'],
    })
  })

  it('unions the campaigns of every form the lead came through, once each', () => {
    assert.deepEqual(planLeadFormCampaigns(lead({ sources: ['form:form-contact', 'form:form-cost'] }), forms), {
      campaignIds: ['camp-a', 'camp-b'],
      scopedCampaignIds: ['host:site-1~camp-a', 'host:site-1~camp-b'],
    })
  })

  it('keeps every campaign the lead already holds and adds only the missing ones', () => {
    const plan = planLeadFormCampaigns(
      lead({
        sources: ['form:form-cost'],
        campaignIds: ['camp-hand', 'camp-a'],
        scopedCampaignIds: ['host:site-1~camp-hand', 'host:site-1~camp-a'],
      }),
      forms,
    )
    assert.deepEqual(plan, { campaignIds: ['camp-b'], scopedCampaignIds: ['host:site-1~camp-b'] })
  })

  it('restamps a filter key the lead’s campaigns imply and it is missing', () => {
    const plan = planLeadFormCampaigns(lead({ campaignIds: ['camp-a'], scopedCampaignIds: [] }), forms)
    assert.deepEqual(plan, { campaignIds: [], scopedCampaignIds: ['host:site-1~camp-a'] })
  })

  it('plans nothing for a lead already filed — so a second run plans zero', () => {
    const filed = lead({ campaignIds: ['camp-a'], scopedCampaignIds: ['host:site-1~camp-a'] })
    assert.equal(planLeadFormCampaigns(filed, forms), null)
  })

  it('plans nothing for a lead no form filed, or whose form is in no campaign or gone', () => {
    assert.equal(planLeadFormCampaigns(lead({ sources: ['booking'] }), forms), null)
    assert.equal(planLeadFormCampaigns(lead({ sources: ['form:form-gone'] }), forms), null)
    assert.equal(planLeadFormCampaigns(null, forms), null)
  })

  it('never takes a campaign away, even one its form has since left', () => {
    const plan = planLeadFormCampaigns(
      lead({ campaignIds: ['camp-old'], scopedCampaignIds: ['host:site-1~camp-old'] }),
      forms,
    )
    assert.deepEqual(plan, { campaignIds: ['camp-a'], scopedCampaignIds: ['host:site-1~camp-a'] })
  })

  it('holds the union to the membership cap, keeping what the lead held', () => {
    const held = Array.from({ length: CONTAINER_MEMBERSHIP_CAP }, (_, index) => `held-${index}`)
    const plan = planLeadFormCampaigns(
      lead({ campaignIds: held, scopedCampaignIds: held.map((id) => `host:site-1~${id}`) }),
      forms,
    )
    assert.equal(plan, null)
  })
})
