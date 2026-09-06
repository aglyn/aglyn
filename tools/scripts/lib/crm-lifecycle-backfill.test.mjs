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

// The lifecycle-stage, historical-leads and company-count backfill's
// decisions (AGL-2631), one case per rule that decides whether a live row is
// written, and the guards that decide whether the tree may be applied
// against at all.

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  CONTACT_LIFECYCLE_STAGES,
  advanceNeverDowngrades,
  advanceStage,
  declaresLiteral,
  doorSetsFloor,
  facetStageAfterBackfill,
  grantedConsentEntry,
  hostLeadContext,
  leadRowForContact,
  leadWriterKeysByPerson,
  lifecycleFloorForFacet,
  personKey,
  personKeyMatches,
  planCompanyCounts,
  planFacetStages,
  planLeadForHost,
  preconditionsForTree,
  stageTableMatches,
  tallyCompanyMirrors,
} from './crm-lifecycle-backfill.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..', '..')

const HOST = 'demo'
const FORM = 'form-wholesale'
const NOW = 1_800_000_000_000

/** A host whose one form routes leads, with nothing filed on it yet. */
function host(overrides = {}) {
  return hostLeadContext({
    hostId: HOST,
    forms: [{ id: FORM, data: { displayName: 'Wholesale', routing: { lead: true } } }],
    submissions: [],
    leads: [],
    suppressions: [],
    nowMs: NOW,
    ...overrides,
  })
}

/** A contact one facet met through a routed form, twice. */
function formContact(facet = {}) {
  return {
    email: 'ann@acme.com',
    name: 'Ann Lee',
    hostId: HOST,
    capturedByHostIds: [HOST],
    formIds: [FORM],
    facets: {
      [HOST]: {
        sources: { form: true },
        interactions: [
          { type: 'form', atMs: 2_000, refId: 's2', formId: FORM, hostId: HOST },
          { type: 'form', atMs: 1_000, refId: 's1', formId: FORM, hostId: HOST },
        ],
        ...facet,
      },
    },
  }
}

describe('the stage table', () => {
  it('reads an order as a customer, whatever else the facet says', () => {
    assert.equal(
      lifecycleFloorForFacet({ sources: { order: true, form: true, member: true } }),
      'customer',
    )
  })

  it('reads money on the facet as a customer — the paid booking', () => {
    assert.equal(
      lifecycleFloorForFacet({ sources: { booking: true }, ordersCount: 1 }),
      'customer',
    )
    assert.equal(
      lifecycleFloorForFacet({ sources: { booking: true }, ltvCents: 4_500 }),
      'customer',
    )
  })

  it('reads a form or a booking request as a lead', () => {
    assert.equal(lifecycleFloorForFacet({ sources: { form: true } }), 'lead')
    assert.equal(lifecycleFloorForFacet({ sources: { booking: true } }), 'lead')
    // A lead surface outranks a subscriber surface on the same facet.
    assert.equal(
      lifecycleFloorForFacet({ sources: { form: true, newsletter: true } }),
      'lead',
    )
  })

  it('reads a sign-up or a newsletter opt-in as a subscriber', () => {
    assert.equal(lifecycleFloorForFacet({ sources: { member: true } }), 'subscriber')
    assert.equal(lifecycleFloorForFacet({ sources: { newsletter: true } }), 'subscriber')
  })

  it('implies nothing for a person met only by hand, by import or over the API', () => {
    assert.equal(
      lifecycleFloorForFacet({ sources: { manual: true, import: true, api: true } }),
      null,
    )
    assert.equal(lifecycleFloorForFacet({ sources: {} }), null)
    assert.equal(lifecycleFloorForFacet(undefined), null)
  })

  it('never moves a held stage back', () => {
    assert.equal(advanceStage('customer', 'lead'), 'customer')
    assert.equal(advanceStage('other', 'customer'), 'other')
    assert.equal(advanceStage('subscriber', 'lead'), 'lead')
    assert.equal(advanceStage(undefined, 'lead'), 'lead')
    assert.equal(advanceStage('lead', undefined), 'lead')
    // A stored value that is not a stage reads as absent.
    assert.equal(advanceStage('Lead', 'subscriber'), 'subscriber')
  })

  it('plans one write per facet without a stage, at the derived floor', () => {
    const plan = planFacetStages({
      facets: {
        a: { sources: { form: true } },
        b: { sources: { order: true } },
        c: { sources: { newsletter: true } },
      },
    })
    assert.deepEqual(
      plan.writes.map((write) => [write.path, write.stage, write.replacedUnusable]),
      [
        ['facets.a.lifecycleStage', 'lead', false],
        ['facets.b.lifecycleStage', 'customer', false],
        ['facets.c.lifecycleStage', 'subscriber', false],
      ],
    )
    assert.equal(plan.held, 0)
    assert.equal(plan.noEvidence, 0)
  })

  it('leaves a facet that holds a stage alone and counts it', () => {
    const plan = planFacetStages({
      facets: { a: { sources: { form: true }, lifecycleStage: 'customer' } },
    })
    assert.deepEqual(plan.writes, [])
    assert.equal(plan.held, 1)
  })

  it('counts a facet whose evidence implies nothing rather than guessing', () => {
    const plan = planFacetStages({ facets: { a: { sources: { manual: true } } } })
    assert.deepEqual(plan.writes, [])
    assert.equal(plan.noEvidence, 1)
  })

  it('replaces an unusable stored value the way a door would, and says so', () => {
    const plan = planFacetStages({
      facets: { a: { sources: { form: true }, lifecycleStage: 'Lead' } },
    })
    assert.equal(plan.writes.length, 1)
    assert.equal(plan.writes[0].stage, 'lead')
    assert.equal(plan.writes[0].replacedUnusable, true)
  })

  it('is idempotent: the planned stage, once stored, plans nothing', () => {
    const first = planFacetStages({ facets: { a: { sources: { booking: true } } } })
    const stored = {
      facets: { a: { sources: { booking: true }, lifecycleStage: first.writes[0].stage } },
    }
    assert.deepEqual(planFacetStages(stored).writes, [])
  })

  it('reports a pre-facet document rather than touching its top level', () => {
    const plan = planFacetStages({ sources: { form: true } })
    assert.equal(plan.noFacets, true)
    assert.deepEqual(plan.writes, [])
  })
})

describe('the lead row', () => {
  it('creates a lead for a routed-form capture with exactly the shape the door leaves', () => {
    const context = host({
      submissions: [
        { id: 's1', data: { formId: FORM, fields: { email: 'Ann@Acme.com' } } },
        { id: 's2', data: { formId: FORM, fields: { email: 'ann@acme.com' } } },
        // A third submission by somebody else, on the same form.
        { id: 's3', data: { formId: FORM, fields: { email: 'bob@acme.com' } } },
      ],
    })
    const verdict = planLeadForHost({ contactId: 'c1', contact: formContact(), host: context })
    assert.equal(verdict.kind, 'create')
    assert.equal(verdict.key, personKey('ann@acme.com'))
    assert.deepEqual(verdict.row, {
      email: 'ann@acme.com',
      name: 'Ann Lee',
      status: 'new',
      sources: [`form:${FORM}`],
      submissionCount: 2,
      firstSeenAtMs: 1_000,
      lastSeenAtMs: 2_000,
      capturedByHostIds: [HOST],
      backfilledAtMs: NOW,
    })
    // The working state is the CRM's to give, not this script's.
    assert.equal('ownerUid' in verdict.row, false)
    assert.equal('notes' in verdict.row, false)
  })

  it('keys the row by the same derivation the lead writer uses', () => {
    assert.equal(
      personKey('  Ann@Acme.COM '),
      createHash('sha256').update('ann@acme.com').digest('hex'),
    )
    assert.equal(personKey('not an address'), null)
  })

  it('joins a pre-form-entity interaction to its form through the submission', () => {
    const contact = formContact({
      interactions: [{ type: 'form', atMs: 500, refId: 's-old', hostId: HOST }],
    })
    delete contact.formIds
    const context = host({
      submissions: [{ id: 's-old', data: { formId: FORM, fields: { email: 'ann@acme.com' } } }],
    })
    const verdict = planLeadForHost({ contactId: 'c1', contact, host: context })
    assert.equal(verdict.kind, 'create')
    assert.deepEqual(verdict.row.sources, [`form:${FORM}`])
    assert.equal(verdict.row.firstSeenAtMs, 500)
  })

  it('reads the form mirror for a timeline whose captures were dropped at the cap', () => {
    const contact = formContact({ interactions: [] })
    contact.createdAt = { seconds: 1_700_000_000 }
    const verdict = planLeadForHost({ contactId: 'c1', contact, host: host() })
    assert.equal(verdict.kind, 'create')
    assert.equal(verdict.row.submissionCount, 1)
    assert.equal(verdict.row.firstSeenAtMs, 1_700_000_000_000)
    assert.equal(verdict.row.lastSeenAtMs, 1_700_000_000_000)
  })

  it('files a booking request as a lead and counts it as a capture', () => {
    const contact = {
      email: 'june@riverbend.com',
      capturedByHostIds: [HOST],
      facets: {
        [HOST]: {
          sources: { booking: true },
          interactions: [{ type: 'booking', atMs: 3_000, refId: 'b1', hostId: HOST }],
        },
      },
    }
    const verdict = planLeadForHost({ contactId: 'c2', contact, host: host({ forms: [] }) })
    assert.equal(verdict.kind, 'create')
    assert.deepEqual(verdict.row.sources, ['booking'])
    assert.equal(verdict.row.submissionCount, 1)
    assert.equal('name' in verdict.row, false)
  })

  it("attributes an unstamped booking to the host only on the host's own facet", () => {
    const booking = { type: 'booking', atMs: 3_000, refId: 'b1' }
    const own = {
      email: 'a@b.com',
      facets: { [HOST]: { sources: { booking: true }, interactions: [booking] } },
    }
    const shared = {
      email: 'a@b.com',
      capturedByHostIds: [HOST],
      facets: { 'group-1': { sources: { booking: true }, interactions: [booking] } },
    }
    assert.equal(planLeadForHost({ contactId: 'c', contact: own, host: host() }).kind, 'create')
    assert.equal(
      planLeadForHost({ contactId: 'c', contact: shared, host: host() }).reason,
      'no-lead-surface',
    )
  })

  it('files nothing for a form without lead routing, and says why', () => {
    const context = host({
      forms: [{ id: FORM, data: { displayName: 'Wholesale', routing: {} } }],
    })
    const verdict = planLeadForHost({ contactId: 'c1', contact: formContact(), host: context })
    assert.deepEqual(verdict, { kind: 'skip', reason: 'no-lead-surface', contactId: 'c1' })
  })

  it('ignores an archived form even with routing on', () => {
    const context = host({
      forms: [
        { id: FORM, data: { displayName: 'Wholesale', routing: { lead: true }, archivedAt: 1 } },
      ],
    })
    assert.equal(
      planLeadForHost({ contactId: 'c1', contact: formContact(), host: context }).reason,
      'no-lead-surface',
    )
  })

  it('is silent about a contact the host never met', () => {
    const elsewhere = {
      email: 'ann@acme.com',
      hostId: 'other',
      capturedByHostIds: ['other'],
      formIds: ['form-elsewhere'],
      facets: {
        other: {
          sources: { form: true },
          interactions: [
            { type: 'form', atMs: 1_000, refId: 'x1', formId: 'form-elsewhere', hostId: 'other' },
          ],
        },
      },
    }
    const verdict = planLeadForHost({ contactId: 'c1', contact: elsewhere, host: host() })
    assert.equal(verdict.reason, 'not-captured-here')
  })

  it('attributes a capture by the form even when a shared facet holds it', () => {
    // A form id is minted under one site, so a routed form's capture on a
    // declared group's facet is still this host's lead.
    const shared = {
      email: 'ann@acme.com',
      capturedByHostIds: [HOST, 'sibling'],
      facets: {
        'group-1': {
          sources: { form: true },
          interactions: [{ type: 'form', atMs: 1_000, refId: 's1', formId: FORM }],
        },
      },
    }
    assert.equal(planLeadForHost({ contactId: 'c1', contact: shared, host: host() }).kind, 'create')
  })

  it('refuses a row it cannot key', () => {
    const verdict = planLeadForHost({
      contactId: 'c1',
      contact: { ...formContact(), email: 'nope' },
      host: host(),
    })
    assert.deepEqual(verdict, { kind: 'skip', reason: 'no-email', contactId: 'c1' })
  })

  it('carries the grant the contact holds for this host, and only a grant', () => {
    const granted = {
      ...formContact(),
      marketingConsentByHost: {
        [HOST]: { marketingConsent: true, marketingConsentAtMs: 1_500 },
        other: { marketingConsent: true, marketingConsentAtMs: 9 },
      },
    }
    assert.deepEqual(grantedConsentEntry(granted, HOST), {
      marketingConsent: true,
      marketingConsentAtMs: 1_500,
    })
    const row = planLeadForHost({ contactId: 'c1', contact: granted, host: host() }).row
    assert.deepEqual(row.marketingConsentByHost, {
      [HOST]: { marketingConsent: true, marketingConsentAtMs: 1_500 },
    })
    // No entry for this host: nothing, even though another site holds one.
    assert.equal(grantedConsentEntry(granted, 'third'), null)
    // A refusal anywhere on the record withholds the copy.
    assert.equal(
      grantedConsentEntry({ ...granted, marketingConsent: false }, HOST),
      null,
    )
    assert.equal(
      grantedConsentEntry(
        {
          marketingConsentByHost: {
            [HOST]: { marketingConsent: true, marketingConsentAtMs: 1 },
            sibling: { marketingConsent: false },
          },
        },
        HOST,
      ),
      null,
    )
  })

  it('never writes a submission count below one', () => {
    const row = leadRowForContact({
      contact: {},
      email: 'a@b.com',
      name: '',
      hostId: HOST,
      formIds: [FORM],
      bookings: 0,
      atMs: [],
      submissionCount: 0,
      nowMs: NOW,
    })
    assert.equal(row.submissionCount, 1)
    assert.equal(row.firstSeenAtMs, NOW)
  })
})

describe('the skips that protect a person', () => {
  it('never rebuilds a person the site erased', () => {
    const key = personKey('ann@acme.com')
    const context = host({
      suppressions: [{ id: key, data: { email: null, reason: 'erasure' } }],
    })
    assert.deepEqual(
      planLeadForHost({ contactId: 'c1', contact: formContact(), host: context }),
      { kind: 'skip', reason: 'erased', contactId: 'c1' },
    )
  })

  it('CONTROL: an ordinary unsubscribe on the same list is not an erasure', () => {
    const key = personKey('ann@acme.com')
    const context = host({
      suppressions: [{ id: key, data: { email: 'ann@acme.com', reason: 'unsubscribe' } }],
    })
    assert.equal(
      planLeadForHost({ contactId: 'c1', contact: formContact(), host: context }).kind,
      'create',
    )
  })

  it('never overwrites a lead the site already holds, under the key or an older id', () => {
    const byKey = host({
      leads: [{ id: personKey('ann@acme.com'), data: { email: 'ann@acme.com' } }],
    })
    assert.equal(
      planLeadForHost({ contactId: 'c1', contact: formContact(), host: byKey }).reason,
      'already-a-lead',
    )
    const byAutoId = host({
      leads: [{ id: 'auto-legacy-1', data: { email: 'Ann@Acme.com' } }],
    })
    assert.equal(
      planLeadForHost({ contactId: 'c1', contact: formContact(), host: byAutoId }).reason,
      'already-a-lead',
    )
  })

  it('leaves a person the team has already worked past Lead', () => {
    for (const stage of ['marketing-qualified', 'sales-qualified', 'opportunity', 'customer', 'evangelist', 'other']) {
      const verdict = planLeadForHost({
        contactId: 'c1',
        contact: formContact({ lifecycleStage: stage }),
        host: host(),
      })
      assert.deepEqual(verdict, { kind: 'skip', reason: 'beyond-lead', stage, contactId: 'c1' })
    }
  })

  it('leaves a customer whose facet has no stage yet, by the money on it', () => {
    const verdict = planLeadForHost({
      contactId: 'c1',
      contact: formContact({ sources: { form: true, order: true } }),
      host: host(),
    })
    assert.equal(verdict.reason, 'beyond-lead')
    assert.equal(verdict.stage, 'customer')
    assert.equal(facetStageAfterBackfill({ sources: { order: true } }), 'customer')
  })

  it('CONTROL: a subscriber who then submitted a routed form is a lead', () => {
    const verdict = planLeadForHost({
      contactId: 'c1',
      contact: formContact({ lifecycleStage: 'subscriber' }),
      host: host(),
    })
    assert.equal(verdict.kind, 'create')
  })
})

describe('the company recount', () => {
  it('counts each company once per contact naming it in the mirror', () => {
    const tally = tallyCompanyMirrors([
      { companyIds: ['acme', 'acme', 'globex'] },
      { companyIds: ['acme'] },
      { companyIds: 'not-an-array' },
      {},
    ])
    assert.deepEqual([...tally.entries()].sort(), [
      ['acme', 2],
      ['globex', 1],
    ])
  })

  it('reports the drift with the stored figure beside the counted one', () => {
    const plan = planCompanyCounts(
      [
        { id: 'acme', data: { name: 'Acme', contactsCount: 0 } },
        { id: 'globex', data: { name: 'Globex' } },
        { id: 'initech', data: { name: 'Initech', contactsCount: 3 } },
      ],
      new Map([
        ['acme', 2],
        ['globex', 1],
        ['initech', 3],
      ]),
    )
    assert.deepEqual(plan.drift, [
      { companyId: 'acme', name: 'Acme', stored: 0, counted: 2 },
      { companyId: 'globex', name: 'Globex', stored: null, counted: 1 },
    ])
    assert.equal(plan.inStep, 1)
    assert.deepEqual(plan.orphans, [])
  })

  it('reads an absent count as zero, so a company nobody linked gains no write', () => {
    const plan = planCompanyCounts([{ id: 'acme', data: {} }], new Map())
    assert.deepEqual(plan.drift, [])
    assert.equal(plan.inStep, 1)
  })

  it('reports an id the mirrors name that no company answers to, and writes nothing for it', () => {
    const plan = planCompanyCounts([], new Map([['gone', 4]]))
    assert.deepEqual(plan.orphans, [{ companyId: 'gone', counted: 4 }])
    assert.deepEqual(plan.drift, [])
  })

  it('is idempotent: a count that matches plans nothing', () => {
    const plan = planCompanyCounts(
      [{ id: 'acme', data: { contactsCount: 2 } }],
      new Map([['acme', 2]]),
    )
    assert.deepEqual(plan.drift, [])
  })
})

describe('the guards', () => {
  const table = `export const CONTACT_LIFECYCLE_STAGES = [\n${CONTACT_LIFECYCLE_STAGES.map(
    (stage) => `  '${stage}',`,
  ).join('\n')}\n] as const`

  it('accepts the stage table as shipped', () => {
    assert.equal(stageTableMatches(table).ok, true)
  })

  it('CONTROL: refuses a reordered, a shortened and a widened table', () => {
    const reordered = table.replace("'subscriber',\n  'lead',", "'lead',\n  'subscriber',")
    assert.equal(stageTableMatches(reordered).ok, false)
    assert.equal(stageTableMatches(table.replace("  'other',\n", '')).ok, false)
    assert.equal(
      stageTableMatches(table.replace("  'other',", "  'other',\n  'partner',")).ok,
      false,
    )
    // A comment promising the list is not the list.
    assert.equal(stageTableMatches(`// ${table.replace(/\n/g, '\n// ')}`).ok, false)
  })

  it('reads the never-downgrade rule off the code, not a comment', () => {
    assert.equal(
      advanceNeverDowngrades(
        'return order.indexOf(held) < order.indexOf(floor) ? floor : held',
      ).ok,
      true,
    )
    assert.equal(
      advanceNeverDowngrades(
        '// order.indexOf(held) < order.indexOf(floor) ? floor : held\nreturn floor',
      ).ok,
      false,
    )
  })

  it('sees a door setting its floor, and not a door that dropped it', () => {
    assert.equal(doorSetsFloor("captureHostContact({ initialLifecycleStage: 'lead' })", 'lead'), true)
    assert.equal(doorSetsFloor("captureHostContact({ initialLifecycleStage: 'lead' })", 'customer'), false)
    assert.equal(doorSetsFloor("// initialLifecycleStage: 'lead' was here", 'lead'), false)
  })

  it('reads a field literal off its declaration', () => {
    assert.equal(declaresLiteral("export const CONTACT_FACETS_FIELD = 'facets'", 'CONTACT_FACETS_FIELD', 'facets'), true)
    assert.equal(declaresLiteral("export const CONTACT_FACETS_FIELD = 'holders'", 'CONTACT_FACETS_FIELD', 'facets'), false)
  })

  it('accepts the person key derivation and refuses a truncated one', () => {
    assert.equal(
      personKeyMatches(
        "const normalized = normalizeContactEmail(email)\nreturn createHash('sha256').update(normalized).digest('hex')",
      ).ok,
      true,
    )
    assert.equal(
      personKeyMatches(
        "const normalized = normalizeContactEmail(email)\nreturn createHash('sha256').update(normalized).digest('hex').slice(0, 20)",
      ).ok,
      false,
    )
  })

  it('sees the lead writer keying by person', () => {
    assert.equal(leadWriterKeysByPerson('const key = personKey(lead.email)').ok, true)
    assert.equal(leadWriterKeysByPerson('const ref = leadsRef.doc()').ok, false)
  })

  it('this tree may be applied against', () => {
    const verdict = preconditionsForTree(REPO_ROOT)
    assert.equal(verdict.ok, true, verdict.why)
  })

  it('CONTROL: an empty tree may not', () => {
    assert.equal(preconditionsForTree(join(here, 'no-such-tree')).ok, false)
  })
})
