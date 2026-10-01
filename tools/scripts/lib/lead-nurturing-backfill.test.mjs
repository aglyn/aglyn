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
  enrollmentLeadId,
  enrollmentSentEmail,
  LEAD_STATUSES,
  leadStatus,
  planLeadNurturing,
  visibleToHost,
} from './lead-nurturing-backfill.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

describe('the restated vocabulary (AGL-3446)', () => {
  it('lists the statuses the model owns, in its order', () => {
    const source = readFileSync(join(REPO_ROOT, 'libs/aglyn/src/lib/app-utils/crm.ts'), 'utf8')
    const block = source.match(/export const CRM_LEAD_STATUSES = \[([^\]]*)\]/)
    assert.ok(block, 'CRM_LEAD_STATUSES is no longer a literal in crm.ts')
    const owned = [...block[1].matchAll(/'([a-z]+)'/g)].map((match) => match[1])
    assert.deepEqual(LEAD_STATUSES, owned)
  })

  it('reads an absent or unknown status as new', () => {
    assert.equal(leadStatus({}), 'new')
    assert.equal(leadStatus({ status: 'archived' }), 'new')
    assert.equal(leadStatus({ status: 'working' }), 'working')
  })

  it('sees a lead the org holds, or the site holds, and no other', () => {
    assert.equal(visibleToHost(['org'], 'site-a'), true)
    assert.equal(visibleToHost(['host:site-a'], 'site-a'), true)
    assert.equal(visibleToHost(['host:site-b'], 'site-a'), false)
    assert.equal(visibleToHost(undefined, 'site-a'), false)
  })
})

describe('what counts as a sent sequence email', () => {
  it('is a send time, a message id or an email step record', () => {
    assert.equal(enrollmentSentEmail({ lastSentAtMs: 1 }), true)
    assert.equal(enrollmentSentEmail({ messageIds: ['<m@x>'] }), true)
    assert.equal(enrollmentSentEmail({ stepIndex: 1, stepRecords: [{ kind: 'email' }] }), true)
  })

  it('is not an enrollment that only filed tasks, or never sent', () => {
    assert.equal(enrollmentSentEmail({ stepIndex: 1, stepRecords: [{ kind: 'task' }] }), false)
    assert.equal(enrollmentSentEmail({ stepIndex: 0, messageIds: [], lastSentAtMs: null }), false)
    assert.equal(enrollmentSentEmail(null), false)
  })

  it('counts a step past the first on an enrollment that kept no step records', () => {
    assert.equal(enrollmentSentEmail({ stepIndex: 2 }), true)
  })

  it('names the lead an enrollment was made on, even after it followed the contact', () => {
    assert.equal(enrollmentLeadId({ target: 'contact', leadId: 'lead-1', contactId: 'c-1' }), 'lead-1')
    assert.equal(enrollmentLeadId({ target: 'contact', leadId: null }), null)
  })
})

describe('which leads move to Nurturing', () => {
  const lead = (fields = {}) => ({ email: 'dana@example.com', visibleTo: ['host:site-a'], ...fields })

  it('moves a New lead a sequence emailed', () => {
    assert.equal(planLeadNurturing(lead(), { enrolled: true, campaignHosts: [] }), 'sequence')
    assert.equal(planLeadNurturing(lead({ status: 'new' }), { enrolled: true }), 'sequence')
  })

  it('moves a New lead a campaign from its own site reached', () => {
    assert.equal(planLeadNurturing(lead(), { enrolled: false, campaignHosts: ['site-a'] }), 'campaign')
    // A send from before sends recorded their site.
    assert.equal(planLeadNurturing(lead(), { enrolled: false, campaignHosts: [''] }), 'campaign')
  })

  it('leaves a lead another site’s campaign reached', () => {
    assert.equal(planLeadNurturing(lead(), { enrolled: false, campaignHosts: ['site-b'] }), null)
  })

  it('never moves a lead past New, a converted one, or one nothing reached', () => {
    for (const status of ['nurturing', 'working', 'qualified', 'unqualified']) {
      assert.equal(planLeadNurturing(lead({ status }), { enrolled: true, campaignHosts: ['site-a'] }), null)
    }
    assert.equal(planLeadNurturing(lead({ convertedContactId: 'c-1' }), { enrolled: true }), null)
    assert.equal(planLeadNurturing(lead(), { enrolled: false, campaignHosts: [] }), null)
    assert.equal(planLeadNurturing(null, { enrolled: true }), null)
  })
})
