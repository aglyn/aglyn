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
 * The org-level projection: what an organization may see of a person its
 * sites share, and — the half that matters — what it may not.
 */

import {
  contactCaptureHostIds,
  MARKETING_BASIS_LABELS,
  orgContactConsentLabel,
  orgContactRow,
  ORG_CONTACT_FIELDS,
  readContactFacet,
} from './contacts'
import { CONSENT_GROUPS_FIELD } from './consent-groups'

/** A sentinel that could only have come from a facet. */
const FACET_SECRET = 'FACETSENTINELXYZ'

/**
 * One person, met by two sites that do not know about each other, with every
 * facet field on the document filled in.
 */
const twoHostContact = () => ({
  email: 'jo@example.com',
  name: 'Jo Canonical',
  capturedByHostIds: ['host-b', 'host-a'],
  marketingConsentByHost: {
    'host-a': { marketingConsent: true, marketingConsentAtMs: 1_700_000_000 },
    'host-b': { marketingConsent: false },
  },
  facets: {
    'host-a': {
      name: `${FACET_SECRET}-override-a`,
      notes: `${FACET_SECRET}-notes-a`,
      tags: [`${FACET_SECRET}-tag-a`],
      sources: { order: true },
      interactions: [
        { type: 'order', atMs: 1, hostId: 'host-a', summary: `${FACET_SECRET}-call-a` },
      ],
      ltvCents: 999_99,
      ordersCount: 7,
    },
    'host-b': {
      notes: `${FACET_SECRET}-notes-b`,
      tags: [`${FACET_SECRET}-tag-b`],
      sources: { form: true },
      interactions: [],
      ltvCents: 12_34,
    },
  },
})

describe('orgContactRow — one person, every site that knows them', () => {
  it('renders a person captured on two hosts ONCE, naming both', () => {
    const row = orgContactRow(twoHostContact(), 'contact-1', null)
    expect(row.$id).toBe('contact-1')
    expect(row.email).toBe('jo@example.com')
    // Sorted, not capture order: the array grows by `arrayUnion`, so the
    // seed above lists host-b first.
    expect(row.capturedByHostIds).toEqual(['host-a', 'host-b'])
  })

  it('is ONE row — the projection never splits a shared person per host', () => {
    const rows = [twoHostContact()].map((record, index) =>
      orgContactRow(record, `contact-${index}`, null),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].capturedByHostIds).toHaveLength(2)
  })

  it('de-duplicates and drops blanks from the capture attribution', () => {
    expect(
      contactCaptureHostIds({
        capturedByHostIds: ['host-a', 'host-a', '  ', '', 'host-b'],
      }),
    ).toEqual(['host-a', 'host-b'])
  })

  it('reads a missing or malformed attribution as NO sites, never as all', () => {
    expect(contactCaptureHostIds(null)).toEqual([])
    expect(contactCaptureHostIds({})).toEqual([])
    expect(contactCaptureHostIds({ capturedByHostIds: 'host-a' })).toEqual([])
  })

  it('leaves an UNATTRIBUTED person attributed to nobody', () => {
    /*
     * A row written before the attribution existed names no site, and the
     * projection must carry that through rather than filling the gap. An
     * invented site is not a cosmetic error here: it is this page telling a
     * business it has a relationship with somebody it has never met, and the
     * consent list is derived from the same array, so it would mint a consent
     * verdict for that site too.
     */
    const unattributed = { email: 'old@example.com', name: 'Old Row' }
    const row = orgContactRow(unattributed, 'c', null)
    expect(row.capturedByHostIds).toEqual([])
    expect(row.consent).toEqual([])
    // CONTROL: the same call on an attributed record does produce both.
    const attributed = orgContactRow(twoHostContact(), 'c', null)
    expect(attributed.capturedByHostIds.length).toBe(2)
    expect(attributed.consent.length).toBe(2)
  })
})

describe('the org view carries NO per-host facet content', () => {
  /*
   * THE CONTROL FIRST.
   *
   * The assertion below is "the sentinel does not appear anywhere in the
   * serialized row", and an assertion of that shape passes for free if the
   * search is broken or the row is empty. So the same search, over the same
   * row, must FIND a sentinel that IS supposed to survive — the canonical
   * identity. If this test ever fails, the one under it proves nothing.
   */
  it('CONTROL: the same search finds a sentinel the row IS meant to carry', () => {
    const record = { ...twoHostContact(), name: `${FACET_SECRET}-canonical` }
    const serialized = JSON.stringify(orgContactRow(record, 'c', null))
    expect(serialized).toContain(FACET_SECRET)
  })

  it('carries no note, tag, timeline or commercial figure from any facet', () => {
    const serialized = JSON.stringify(orgContactRow(twoHostContact(), 'c', null))
    expect(serialized).not.toContain(FACET_SECRET)
  })

  it('exposes no facet-shaped key, whatever the values happen to be', () => {
    const row = orgContactRow(twoHostContact(), 'c', null) as Record<
      string,
      unknown
    >
    for (const forbidden of [
      'facets',
      'notes',
      'tags',
      'interactions',
      'sources',
      'ltvCents',
      'ordersCount',
      'lastPurchaseAtMs',
      'refundedCents',
    ]) {
      expect(row[forbidden]).toBeUndefined()
    }
  })

  it("shows the CANONICAL name, never a holder's own override", () => {
    const record = twoHostContact()
    // Host A renamed this person in its own CRM. The org must not see it.
    expect(readContactFacet(record, 'host-a').name).toBe(
      `${FACET_SECRET}-override-a`,
    )
    expect(orgContactRow(record, 'c', null).name).toBe('Jo Canonical')
  })

  it('reads only the allow-listed fields, so a NEW facet field cannot leak', () => {
    const record = twoHostContact() as Record<string, unknown>
    // A field nobody has written yet, added to the facet as a future change
    // would add one. An omission-based projection would carry it out.
    ;(record['facets'] as any)['host-a']['creditScore'] = FACET_SECRET
    expect(JSON.stringify(orgContactRow(record, 'c', null))).not.toContain(
      FACET_SECRET,
    )
    expect(ORG_CONTACT_FIELDS).not.toContain('facets')
  })
})

describe('consent is per (contact, host-or-group) and says so', () => {
  it('reports one verdict per capturing site, each naming its site', () => {
    const row = orgContactRow(twoHostContact(), 'c', null)
    expect(row.consent).toEqual([
      {
        hostId: 'host-a',
        groupId: 'host-a',
        groupName: null,
        declared: false,
        basis: 'granted',
      },
      {
        hostId: 'host-b',
        groupId: 'host-b',
        groupName: null,
        declared: false,
        basis: 'declined',
      },
    ])
  })

  it("never lets one site's grant read as another's", () => {
    const row = orgContactRow(twoHostContact(), 'c', null)
    const byHost = Object.fromEntries(
      row.consent.map((entry) => [entry.hostId, entry.basis]),
    )
    expect(byHost['host-a']).toBe('granted')
    expect(byHost['host-b']).toBe('declined')
  })

  it('reports an absent basis as unrecorded, not as a refusal', () => {
    const row = orgContactRow(
      { email: 'a@b.co', capturedByHostIds: ['host-c'] },
      'c',
      null,
    )
    expect(row.consent[0].basis).toBe('unrecorded')
    expect(MARKETING_BASIS_LABELS.unrecorded).toBe('No record')
    expect(MARKETING_BASIS_LABELS.unrecorded).not.toBe(
      MARKETING_BASIS_LABELS.declined,
    )
  })

  it('names the DECLARED GROUP as the controller when there is one', () => {
    const org = {
      [CONSENT_GROUPS_FIELD]: {
        'grp-1': { name: 'Acme Family', hostIds: ['host-a', 'host-b'] },
      },
    }
    const row = orgContactRow(twoHostContact(), 'c', org)
    expect(row.consent.map((entry) => entry.groupId)).toEqual(['grp-1', 'grp-1'])
    expect(row.consent[0].groupName).toBe('Acme Family')
    expect(row.consent[0].declared).toBe(true)
    /*
     * And the REFUSAL on host-b now runs across the whole group, so host-a's
     * grant is withheld too. That is `readMarketingBasis`'s asymmetry, and
     * the org view must report what it says rather than the grant it can see
     * sitting on the document.
     */
    expect(row.consent.map((entry) => entry.basis)).toEqual([
      'declined',
      'declined',
    ])
  })

  it('resolves the group per site, so an undeclared site stays alone', () => {
    const org = {
      [CONSENT_GROUPS_FIELD]: {
        'grp-1': { name: 'Acme Family', hostIds: ['host-a', 'host-z'] },
      },
    }
    const row = orgContactRow(twoHostContact(), 'c', org)
    expect(row.consent[0]).toMatchObject({ groupId: 'grp-1', declared: true })
    expect(row.consent[1]).toMatchObject({ groupId: 'host-b', declared: false })
  })
})

describe('orgContactConsentLabel — never a bare verdict', () => {
  const entry = {
    hostId: 'host-a',
    groupId: 'host-a',
    groupName: null,
    declared: false,
    basis: 'granted' as const,
  }

  it('names the site beside the verdict', () => {
    expect(orgContactConsentLabel(entry, 'Acme Shop')).toBe(
      'Acme Shop · Opted in',
    )
  })

  it('names the DECLARED group instead, because that is who it runs to', () => {
    expect(
      orgContactConsentLabel(
        { ...entry, groupId: 'grp-1', groupName: 'Acme Family', declared: true },
        'Acme Shop',
      ),
    ).toBe('Acme Family · Opted in')
  })

  it('falls back to the host id rather than dropping the controller', () => {
    expect(orgContactConsentLabel(entry)).toBe('host-a · Opted in')
    expect(orgContactConsentLabel(entry, '')).toBe('host-a · Opted in')
  })

  it('every label carries a controller — no basis word stands alone', () => {
    for (const basis of ['granted', 'declined', 'unrecorded'] as const) {
      const label = orgContactConsentLabel({ ...entry, basis }, 'Acme Shop')
      expect(label).toContain('Acme Shop')
      expect(label).not.toBe(MARKETING_BASIS_LABELS[basis])
    }
  })
})
