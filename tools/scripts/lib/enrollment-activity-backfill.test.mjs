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
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  enrolledActivityBody,
  enrolledActivityId,
  enrollmentLink,
  planEnrollmentActivity,
  readConsentGroups,
  scopeTokens,
} from './enrollment-activity-backfill.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO = join(here, '..', '..', '..')
const read = (path) => readFileSync(join(REPO, path), 'utf8')

const AT = 1_790_000_000_000

describe('the entry’s id (AGL-3274)', () => {
  it('is the timeline seam’s keyed id over Outreach’s enrolled key', () => {
    const digest = createHash('sha256').update('outreach:enrolled:seq-1_lead-key').digest('hex').slice(0, 28)
    assert.equal(enrolledActivityId('seq-1_lead-key'), `plg_${digest}`)
  })

  it('restates the seam and the plugin as their source says them', () => {
    // The seam's `keyedId` — the prefix, the digest and its length.
    const seam = read('libs/plugins/crm/src/lib/server/record-timeline.ts')
    assert.match(seam, /`plg_\$\{createHash\('sha256'\)\.update\(`\$\{sourcePluginId\}:\$\{key\}`\)\.digest\('hex'\)\.slice\(0, 28\)\}`/)
    // Outreach's key, and its plugin id.
    const entry = read('libs/plugins/outreach/src/lib/engine/enrollment-activity.ts')
    assert.match(entry, /return `enrolled:\$\{enrollmentId\}`/)
    assert.match(read('libs/plugins/outreach/src/lib/constants/bundle-common.ts'), /OUTREACH_PLUGIN_ID = 'outreach'/)
  })
})

describe('the entry’s words', () => {
  it('reads as the route files it, with and without campaigns', () => {
    assert.equal(
      enrolledActivityBody('Founder · ICP 2 multi-brand', ['Outbound · ICP 2 brands', ' ']),
      'Enrolled in Founder · ICP 2 multi-brand\nFiled under Outbound · ICP 2 brands',
    )
    assert.equal(enrolledActivityBody('Founder', []), 'Enrolled in Founder')
    assert.equal(enrolledActivityBody('', []), 'Enrolled in a sequence')
  })

  it('restates the plugin’s two lines as its source says them', () => {
    const entry = read('libs/plugins/outreach/src/lib/engine/enrollment-activity.ts')
    assert.match(entry, /`Enrolled in \$\{sequence\}\\nFiled under \$\{campaigns\.join\(', '\)\}`/)
    assert.match(entry, /`Enrolled in \$\{sequence\}`/)
    assert.match(entry, /OUTREACH_TIMELINE_BY_NAME = 'Sequences'/)
  })
})

describe('the scope', () => {
  it('is the org token where the default was widened, else the consent group’s sites, else the site', () => {
    assert.deepEqual(scopeTokens({ defaultResourceScope: 'org' }, 'h1'), ['org'])
    const org = { consentGroups: { g1: { name: 'Main', hostIds: ['h2', 'h1'] } } }
    assert.deepEqual(scopeTokens(org, 'h1'), ['host:h1', 'host:h2'])
    assert.deepEqual(scopeTokens(org, 'h9'), ['host:h9'])
    assert.deepEqual(scopeTokens(null, 'h1'), ['host:h1'])
  })

  it('drops a group of one, an unnamed one, and both groups that claim one site', () => {
    assert.deepEqual(readConsentGroups({ consentGroups: { g1: { name: 'Solo', hostIds: ['h1'] } } }), {})
    assert.deepEqual(readConsentGroups({ consentGroups: { g1: { name: ' ', hostIds: ['h1', 'h2'] } } }), {})
    assert.deepEqual(
      readConsentGroups({
        consentGroups: {
          g1: { name: 'A', hostIds: ['h1', 'h2'] },
          g2: { name: 'B', hostIds: ['h2', 'h3'] },
          g3: { name: 'C', hostIds: ['h4', 'h5'] },
        },
      }),
      { g3: { name: 'C', hostIds: ['h4', 'h5'] } },
    )
  })

  it('drops a group whose id is a site’s id, one the org holds or one any entry names', () => {
    const colliding = { hosts: { h3: true }, consentGroups: { h3: { name: 'A', hostIds: ['h1', 'h2'] } } }
    assert.deepEqual(readConsentGroups(colliding), {})
    assert.deepEqual(scopeTokens(colliding, 'h1'), ['host:h1'])
    assert.deepEqual(readConsentGroups({ hosts: ['h3'], consentGroups: colliding.consentGroups }), {})
    assert.deepEqual(
      readConsentGroups({ consentGroups: { h9: { name: 'A', hostIds: ['h1', 'h2'] }, g2: { name: 'B', hostIds: ['h9'] } } }),
      {},
    )
    // Refused on its own, so the colliding entry contests nothing it named.
    assert.deepEqual(
      readConsentGroups({
        hosts: { h4: true },
        consentGroups: { h4: { name: 'A', hostIds: ['h1', 'h2'] }, g2: { name: 'B', hostIds: ['h2', 'h3'] } },
      }),
      { g2: { name: 'B', hostIds: ['h2', 'h3'] } },
    )
    // The control: an id no site uses is kept.
    assert.deepEqual(readConsentGroups({ hosts: { h1: true, h2: true }, consentGroups: { g1: { name: 'A', hostIds: ['h1', 'h2'] } } }), {
      g1: { name: 'A', hostIds: ['h1', 'h2'] },
    })
  })

  it('restates the id refusal as its source says it', () => {
    const source = read('libs/aglyn/src/lib/app-utils/consent-groups.ts')
    assert.match(source, /const siteIds = consentGroupSiteIds\(org, raw as Record<string, unknown>\)/)
    assert.match(source, /if \(siteIds\.has\(groupId\)\) continue/)
  })
})

describe('the record', () => {
  it('is the lead while they are one, else the contact, else nobody', () => {
    assert.deepEqual(enrollmentLink({ target: 'lead', leadId: 'k', contactId: '' }), { leadId: 'k' })
    assert.deepEqual(enrollmentLink({ target: 'contact', leadId: 'k', contactId: 'c' }), { contactId: 'c' })
    assert.deepEqual(enrollmentLink({ target: 'lead', leadId: null, contactId: 'c' }), { contactId: 'c' })
    assert.equal(enrollmentLink({ target: 'lead', leadId: null, contactId: '' }), null)
  })
})

describe('planEnrollmentActivity', () => {
  const enrollment = { target: 'lead', leadId: 'lead-key', contactId: '', hostId: 'h1', createdAtMs: AT }

  it('files the entry at the enrollment’s creation, by Sequences, on the record, in the site’s scope', () => {
    assert.deepEqual(
      planEnrollmentActivity({
        enrollmentId: 'seq-1_lead-key',
        enrollment,
        sequenceName: 'Founder',
        campaignNames: ['Outbound'],
        org: {},
        existing: false,
      }),
      {
        id: enrolledActivityId('seq-1_lead-key'),
        activity: {
          kind: 'note',
          body: 'Enrolled in Founder\nFiled under Outbound',
          atMs: AT,
          byUid: '',
          byName: 'Sequences',
          leadId: 'lead-key',
          hostId: 'h1',
          visibleTo: ['host:h1'],
          sourcePluginId: 'outreach',
        },
      },
    )
  })

  it('plans nothing for an entry already filed, or an enrollment naming no record, site or moment', () => {
    const base = { enrollmentId: 'e', enrollment, sequenceName: 'F', campaignNames: [], org: {}, existing: false }
    assert.equal(planEnrollmentActivity({ ...base, existing: true }), null)
    assert.equal(planEnrollmentActivity({ ...base, enrollment: { ...enrollment, leadId: null } }), null)
    assert.equal(planEnrollmentActivity({ ...base, enrollment: { ...enrollment, hostId: '' } }), null)
    assert.equal(planEnrollmentActivity({ ...base, enrollment: { ...enrollment, createdAtMs: 0 } }), null)
  })

  it('reads the moment off a Timestamp when the number is missing', () => {
    const planned = planEnrollmentActivity({
      enrollmentId: 'e',
      enrollment: { ...enrollment, createdAtMs: undefined, createdAt: { toMillis: () => AT } },
      sequenceName: 'F',
      campaignNames: [],
      org: {},
      existing: false,
    })
    assert.equal(planned?.activity.atMs, AT)
  })
})
