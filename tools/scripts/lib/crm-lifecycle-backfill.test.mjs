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

describe('--any-form: every form the host holds is a lead surface', () => {
  const UNROUTED = 'form-contact'
  const ARCHIVED = 'form-old'
  const GONE = 'form-gone'

  /**
   * A host with one routed form, one whose author never switched routing
   * on, and one Ann wrote in through twice — the unrouted one.
   */
  function anyFormHost(overrides = {}) {
    return host({
      forms: [
        { id: FORM, data: { displayName: 'Wholesale', routing: { lead: true } } },
        { id: UNROUTED, data: { displayName: 'Contact us', routing: {} } },
      ],
      submissions: [
        { id: 'u1', data: { formId: UNROUTED, fields: { email: 'ann@acme.com' } } },
        { id: 'u2', data: { formId: UNROUTED, fields: { email: 'Ann@Acme.com' } } },
        // Somebody else, on the same unrouted form.
        { id: 'u3', data: { formId: UNROUTED, fields: { email: 'bob@acme.com' } } },
      ],
      anyForm: true,
      ...overrides,
    })
  }

  /** Ann, met twice through the unrouted form and through nothing else. */
  function unroutedContact(facet = {}) {
    const contact = formContact({
      interactions: [
        { type: 'form', atMs: 2_000, refId: 'u2', formId: UNROUTED, hostId: HOST },
        { type: 'form', atMs: 1_000, refId: 'u1', formId: UNROUTED, hostId: HOST },
      ],
      ...facet,
    })
    contact.formIds = [UNROUTED]
    return contact
  }

  it('is off by default: only a live, routed form is a lead surface', () => {
    const context = anyFormHost({ anyForm: false })
    assert.equal(context.anyForm, false)
    assert.deepEqual(context.leadSurfaceFormIds, new Set([FORM]))
    assert.equal(context.unroutedForms.size, 0)
    assert.deepEqual(
      planLeadForHost({ contactId: 'c1', contact: unroutedContact(), host: context }),
      { kind: 'skip', reason: 'no-lead-surface', contactId: 'c1' },
    )
    // Omitting the option reads the same as switching it off.
    assert.equal(host().anyForm, false)
  })

  it('files a lead for a form without lead routing, with exactly the shape the door leaves', () => {
    const verdict = planLeadForHost({
      contactId: 'c1',
      contact: unroutedContact(),
      host: anyFormHost(),
    })
    assert.equal(verdict.kind, 'create')
    assert.equal(verdict.key, personKey('ann@acme.com'))
    assert.deepEqual(verdict.row, {
      email: 'ann@acme.com',
      name: 'Ann Lee',
      status: 'new',
      sources: [`form:${UNROUTED}`],
      // Both of Ann's submissions on the unrouted form, not Bob's.
      submissionCount: 2,
      firstSeenAtMs: 1_000,
      lastSeenAtMs: 2_000,
      capturedByHostIds: [HOST],
      backfilledAtMs: NOW,
    })
    assert.equal('ownerUid' in verdict.row, false)
  })

  it('names the forms it treats as lead surfaces only because of the flag', () => {
    const context = anyFormHost()
    assert.equal(context.anyForm, true)
    assert.deepEqual(context.routedForms, new Map([[FORM, 'Wholesale']]))
    assert.deepEqual(
      context.unroutedForms,
      new Map([[UNROUTED, { name: 'Contact us', state: 'routing off' }]]),
    )
    assert.deepEqual(context.leadSurfaceFormIds, new Set([FORM, UNROUTED]))
  })

  it('counts an archived form and a form that no longer exists, and says which', () => {
    const context = anyFormHost({
      forms: [
        { id: FORM, data: { displayName: 'Wholesale', routing: { lead: true } } },
        { id: ARCHIVED, data: { displayName: 'Old', routing: { lead: true }, archivedAt: 1 } },
      ],
      // A deleted form leaves its submissions behind, and they name it.
      submissions: [{ id: 'g1', data: { formId: GONE, fields: { email: 'ann@acme.com' } } }],
    })
    assert.deepEqual(
      context.unroutedForms,
      new Map([
        [ARCHIVED, { name: 'Old', state: 'archived' }],
        [GONE, { name: GONE, state: 'no form document' }],
      ]),
    )
    // A capture that predates the form entity, joined to the vanished form
    // through the submission it names.
    const contact = formContact({
      interactions: [{ type: 'form', atMs: 700, refId: 'g1', hostId: HOST }],
    })
    delete contact.formIds
    const verdict = planLeadForHost({ contactId: 'c1', contact, host: context })
    assert.equal(verdict.kind, 'create')
    assert.deepEqual(verdict.row.sources, [`form:${GONE}`])
    assert.equal(verdict.row.submissionCount, 1)
    assert.equal(verdict.row.firstSeenAtMs, 700)
  })

  it('reads the form mirror for a capped timeline, on and off', () => {
    const contact = unroutedContact({ interactions: [] })
    const on = planLeadForHost({ contactId: 'c1', contact, host: anyFormHost() })
    assert.equal(on.kind, 'create')
    assert.equal(on.row.submissionCount, 2)
    const off = planLeadForHost({ contactId: 'c1', contact, host: anyFormHost({ anyForm: false }) })
    assert.equal(off.reason, 'no-lead-surface')
  })

  it("leaves a routed form's capture exactly as it was, and credits none of it to the flag", () => {
    const verdict = planLeadForHost({ contactId: 'c1', contact: formContact(), host: anyFormHost() })
    assert.equal(verdict.kind, 'create')
    assert.deepEqual(verdict.row.sources, [`form:${FORM}`])
    assert.equal(anyFormHost().unroutedForms.has(FORM), false)
  })

  it('keeps every skip that protects a person', () => {
    const key = personKey('ann@acme.com')
    assert.equal(
      planLeadForHost({
        contactId: 'c1',
        contact: unroutedContact(),
        host: anyFormHost({ suppressions: [{ id: key, data: { email: null, reason: 'erasure' } }] }),
      }).reason,
      'erased',
    )
    assert.equal(
      planLeadForHost({
        contactId: 'c1',
        contact: unroutedContact(),
        host: anyFormHost({ leads: [{ id: 'auto-legacy-1', data: { email: 'Ann@Acme.com' } }] }),
      }).reason,
      'already-a-lead',
    )
    const worked = planLeadForHost({
      contactId: 'c1',
      contact: unroutedContact({ lifecycleStage: 'marketing-qualified' }),
      host: anyFormHost(),
    })
    assert.equal(worked.reason, 'beyond-lead')
    const bought = planLeadForHost({
      contactId: 'c1',
      contact: unroutedContact({ sources: { form: true, order: true } }),
      host: anyFormHost(),
    })
    assert.deepEqual([bought.reason, bought.stage], ['beyond-lead', 'customer'])
  })

  it('carries the grant for this host, and only a grant', () => {
    const granted = {
      ...unroutedContact(),
      marketingConsentByHost: { [HOST]: { marketingConsent: true, marketingConsentAtMs: 1_500 } },
    }
    const row = planLeadForHost({ contactId: 'c1', contact: granted, host: anyFormHost() }).row
    assert.deepEqual(row.marketingConsentByHost, {
      [HOST]: { marketingConsent: true, marketingConsentAtMs: 1_500 },
    })
    const refused = { ...granted, marketingConsent: false }
    assert.equal(
      'marketingConsentByHost' in
        planLeadForHost({ contactId: 'c1', contact: refused, host: anyFormHost() }).row,
      false,
    )
  })

  it("is still silent about another site's form, and still files nothing for an opt-in", () => {
    const elsewhere = {
      email: 'ann@acme.com',
      hostId: 'other',
      capturedByHostIds: ['other'],
      formIds: ['form-elsewhere'],
      facets: {
        other: {
          sources: { form: true },
          interactions: [{ type: 'form', atMs: 1_000, refId: 'x1', formId: 'form-elsewhere', hostId: 'other' }],
        },
      },
    }
    assert.equal(
      planLeadForHost({ contactId: 'c1', contact: elsewhere, host: anyFormHost() }).reason,
      'not-captured-here',
    )
    const subscriber = {
      email: 'sam@acme.com',
      capturedByHostIds: [HOST],
      facets: { [HOST]: { sources: { newsletter: true }, interactions: [] } },
    }
    assert.equal(
      planLeadForHost({ contactId: 'c2', contact: subscriber, host: anyFormHost() }).reason,
      'no-lead-surface',
    )
  })
})

describe('--any-form: a facet that says only "form" is a lead surface', () => {
  const UNROUTED = 'form-contact'

  /**
   * The host under `--any-form`, with the submissions the Aglyn backlog
   * left: some name their form, some predate the form entity and name
   * none, and none is named by any interaction.
   */
  function kindHost(overrides = {}) {
    return hostLeadContext({
      hostId: HOST,
      forms: [
        { id: FORM, data: { displayName: 'Wholesale', routing: { lead: true } } },
        { id: UNROUTED, data: { displayName: 'Contact us', routing: {} } },
      ],
      submissions: [],
      leads: [],
      suppressions: [],
      nowMs: NOW,
      anyForm: true,
      ...overrides,
    })
  }

  /**
   * Ann as a pre-CRM contact: the facet is the host's own group of one and
   * records the KIND of surface that met her — `sources.form` — with a
   * timeline that names no submission and no form, and no `formIds` mirror.
   */
  function kindContact(facet = {}, top = {}) {
    return {
      email: 'ann@acme.com',
      name: 'Ann Lee',
      hostId: HOST,
      capturedByHostIds: [HOST],
      createdAt: { seconds: 1_700_000_000 },
      updatedAt: { seconds: 1_700_100_000 },
      facets: {
        [HOST]: {
          lifecycleStage: 'lead',
          sources: { form: true },
          interactions: [
            { type: 'form', atMs: 3_000 },
            { type: 'form', atMs: 1_000 },
          ],
          tags: [],
          ...facet,
        },
      },
      ...top,
    }
  }

  it('files a lead whose source is the kind itself when nothing names the form', () => {
    const verdict = planLeadForHost({ contactId: 'c1', contact: kindContact(), host: kindHost() })
    assert.equal(verdict.kind, 'create')
    assert.equal(verdict.viaSourceKind, true)
    assert.equal(verdict.key, personKey('ann@acme.com'))
    assert.deepEqual(verdict.row, {
      email: 'ann@acme.com',
      name: 'Ann Lee',
      status: 'new',
      sources: ['form'],
      // A lead exists because at least one capture did.
      submissionCount: 1,
      firstSeenAtMs: 1_000,
      lastSeenAtMs: 3_000,
      capturedByHostIds: [HOST],
      backfilledAtMs: NOW,
    })
    assert.equal('ownerUid' in verdict.row, false)
  })

  it('CONTROL: a facet a form met beside an opt-in is still a lead surface', () => {
    const verdict = planLeadForHost({
      contactId: 'c1',
      contact: kindContact({ sources: { newsletter: true, form: true } }),
      host: kindHost(),
    })
    assert.equal(verdict.kind, 'create')
    assert.deepEqual(verdict.row.sources, ['form'])
  })

  it('is off without the flag, and names the flag as the remedy', () => {
    assert.deepEqual(
      planLeadForHost({ contactId: 'c1', contact: kindContact(), host: kindHost({ anyForm: false }) }),
      { kind: 'skip', reason: 'no-lead-surface', contactId: 'c1' },
    )
  })

  it("counts every submission by the address across the host's forms, and names the forms they carry", () => {
    const context = kindHost({
      submissions: [
        { id: 's1', data: { formId: UNROUTED, fields: { email: 'Ann@Acme.com' } } },
        // Predates the form entity: no `formId`, still Ann's capture.
        { id: 's2', data: { fields: { 'Your email': 'ann@acme.com', note: 'hi' } } },
        // Somebody else, on the routed form.
        { id: 's3', data: { formId: FORM, fields: { email: 'bob@acme.com' } } },
      ],
    })
    const verdict = planLeadForHost({ contactId: 'c1', contact: kindContact(), host: context })
    assert.equal(verdict.kind, 'create')
    assert.equal(verdict.viaSourceKind, true)
    assert.equal(verdict.row.submissionCount, 2)
    assert.deepEqual(verdict.row.sources, [`form:${UNROUTED}`])
  })

  it('names every form the submissions name, as the door would have', () => {
    const context = kindHost({
      submissions: [
        { id: 's1', data: { formId: UNROUTED, fields: { email: 'ann@acme.com' } } },
        { id: 's2', data: { formId: FORM, fields: { email: 'ann@acme.com' } } },
        { id: 's3', data: { formId: FORM, fields: { email: 'ann@acme.com' } } },
      ],
    })
    const verdict = planLeadForHost({ contactId: 'c1', contact: kindContact(), host: context })
    assert.deepEqual(verdict.row.sources, [`form:${UNROUTED}`, `form:${FORM}`])
    assert.equal(verdict.row.submissionCount, 3)
  })

  it('reads the seen bracket off the timeline, else off the contact itself', () => {
    const noTimes = planLeadForHost({
      contactId: 'c1',
      contact: kindContact({ interactions: [{ type: 'form' }] }),
      host: kindHost(),
    })
    assert.equal(noTimes.row.firstSeenAtMs, 1_700_000_000_000)
    assert.equal(noTimes.row.lastSeenAtMs, 1_700_100_000_000)
    const neverEdited = planLeadForHost({
      contactId: 'c1',
      contact: kindContact({ interactions: [] }, { updatedAt: undefined }),
      host: kindHost(),
    })
    assert.equal(neverEdited.row.firstSeenAtMs, 1_700_000_000_000)
    assert.equal(neverEdited.row.lastSeenAtMs, 1_700_000_000_000)
    // An opt-in's timestamp is not a form capture's.
    const mixed = planLeadForHost({
      contactId: 'c1',
      contact: kindContact({
        interactions: [{ type: 'newsletter', atMs: 9_000 }, { type: 'form', atMs: 2_000 }],
      }),
      host: kindHost(),
    })
    assert.deepEqual([mixed.row.firstSeenAtMs, mixed.row.lastSeenAtMs], [2_000, 2_000])
  })

  it('leaves a customer, by the stage or by the money on the facet', () => {
    const staged = planLeadForHost({
      contactId: 'c1',
      contact: kindContact({ lifecycleStage: 'customer' }),
      host: kindHost(),
    })
    assert.deepEqual(staged, { kind: 'skip', reason: 'beyond-lead', stage: 'customer', contactId: 'c1' })
    const bought = planLeadForHost({
      contactId: 'c1',
      contact: kindContact({ lifecycleStage: undefined, sources: { form: true, order: true } }),
      host: kindHost(),
    })
    assert.deepEqual([bought.reason, bought.stage], ['beyond-lead', 'customer'])
  })

  it('never overwrites a lead the site already holds, under the key or an older id', () => {
    const byKey = kindHost({
      leads: [{ id: personKey('ann@acme.com'), data: { email: 'ann@acme.com' } }],
    })
    assert.equal(
      planLeadForHost({ contactId: 'c1', contact: kindContact(), host: byKey }).reason,
      'already-a-lead',
    )
    const byAutoId = kindHost({ leads: [{ id: 'auto-legacy-1', data: { email: 'Ann@Acme.com' } }] })
    assert.equal(
      planLeadForHost({ contactId: 'c1', contact: kindContact(), host: byAutoId }).reason,
      'already-a-lead',
    )
  })

  it('keeps the erasure skip and the consent copy', () => {
    const key = personKey('ann@acme.com')
    assert.equal(
      planLeadForHost({
        contactId: 'c1',
        contact: kindContact(),
        host: kindHost({ suppressions: [{ id: key, data: { email: null, reason: 'erasure' } }] }),
      }).reason,
      'erased',
    )
    const granted = kindContact(
      {},
      { marketingConsentByHost: { [HOST]: { marketingConsent: true, marketingConsentAtMs: 1_500 } } },
    )
    const row = planLeadForHost({ contactId: 'c1', contact: granted, host: kindHost() }).row
    assert.deepEqual(row.marketingConsentByHost, {
      [HOST]: { marketingConsent: true, marketingConsentAtMs: 1_500 },
    })
  })

  it("reads only the host's own group of one: a shared facet cannot say whose form", () => {
    const shared = kindContact()
    shared.facets = { 'agency-group': shared.facets[HOST] }
    assert.equal(
      planLeadForHost({ contactId: 'c1', contact: shared, host: kindHost() }).reason,
      'no-lead-surface',
    )
    const elsewhere = kindContact({}, { hostId: 'other', capturedByHostIds: ['other'] })
    elsewhere.facets = { other: elsewhere.facets[HOST] }
    assert.equal(
      planLeadForHost({ contactId: 'c1', contact: elsewhere, host: kindHost() }).reason,
      'not-captured-here',
    )
  })

  it('credits none of it to a facet whose timeline already names a lead surface', () => {
    const named = kindContact({
      interactions: [{ type: 'form', atMs: 500, formId: UNROUTED }],
    })
    const verdict = planLeadForHost({ contactId: 'c1', contact: named, host: kindHost() })
    assert.equal(verdict.kind, 'create')
    assert.equal(verdict.viaSourceKind, undefined)
    assert.deepEqual(verdict.row.sources, [`form:${UNROUTED}`])
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
