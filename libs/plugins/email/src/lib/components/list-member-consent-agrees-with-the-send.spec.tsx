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
 * THE AUDIENCE TABLE AND THE SENDER READ ONE DOCUMENT, SO THEY SAY ONE THING.
 *
 * The list detail page reported BOTH members of a list as "No basis on record"
 * while the campaign send preview for that same list answered
 * `{"consented":2,"consentedByOperator":2,"suppressed":0}` and mailed them. One
 * screen told the operator the product had no permission for these people; the
 * other told it that an account had attested for both, which was the truth.
 *
 * The two were reading the same membership documents through different code.
 * `enrollListMember` writes a basis into an entry per site under
 * `marketingConsentByHost`, because a basis runs to the brand it was given to.
 * The sender reads it back with `readMarketingBasis`, which looks in that entry.
 * The table picked `marketingConsent` off the TOP of the row, where the fields
 * used to live, and a field that is not there reads as `undefined` rather than
 * as an error — so the column answered "no basis" for every member of every
 * list, forever, and its own spec agreed because its fixture had been written
 * in the same pre-move shape.
 *
 * ## What this file holds, and why it takes both sides
 *
 * Every fixture below is one membership document in the shape
 * `enrollListMember` actually writes. Each is put through BOTH surfaces —
 * rendered into the table, and split by the function `performCampaignSend`
 * splits with — and the two answers are asserted against each other, not
 * against a hard-coded pair of strings. A regression that moves the stored
 * shape again breaks this file wherever it breaks the product.
 *
 * ## The control
 *
 * Agreement is trivially reachable by making everybody look consented, and
 * that outcome is worse than the disagreement it replaces: it would mail the
 * people nobody ever asked. So the fixture carries four rows that must NOT be
 * mailable — no basis at all, a recorded refusal, a grant belonging to another
 * site in the account, and a pre-host grant naming no site — and the
 * assertions pin the exact split rather than only its total. A change that
 * granted a basis to everyone fails here before it reaches the agreement
 * assertions at the end.
 */

import { act, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import {
  DEFAULT_MARKETING_CONSENT_POLICY,
  readMarketingBasis,
  soloConsentGroup,
  splitByMarketingConsent,
  type MarketingConsentRecord,
} from '@aglyn/aglyn'
import { ListMembersPanel } from './list-members-panel'

/** The site whose console this is, and whose campaign the split is for. */
const HOST = 'site-a'
/** Another brand in the same account, declared into no group with `HOST`. */
const OTHER_HOST = 'site-b'

/**
 * The controller both surfaces resolve.
 *
 * A group of one — the undeclared default, and the agency's answer. The panel
 * takes it as a prop and `performCampaignSend` resolves the same value from
 * the org through `consentGroupForSite`, which is what makes the comparison at
 * the bottom of this file a comparison and not a coincidence.
 */
const GROUP = soloConsentGroup(HOST)

const OPT_IN_AT = Date.UTC(2026, 1, 2)
const ATTESTED_AT = Date.UTC(2026, 6, 9)

/** One membership, exactly as `marketingConsentFieldsForGroup` writes it. */
const entry = (hostId: string, fields: Record<string, unknown>) => ({
  marketingConsentByHost: { [hostId]: fields },
})

/**
 * The six shapes a list membership arrives in, and what each one IS.
 *
 * `expectMailable` is the send-side truth and `label` is the screen's. They
 * are stated separately, per row, so that neither can be derived from the
 * other by a test helper that has the same bug the product had.
 */
const CASES = [
  {
    email: 'attested@lumen.co',
    note: 'an account stated it has this person permission',
    doc: entry(HOST, {
      marketingConsent: true,
      marketingConsentBasis: 'operator-attested',
      marketingConsentByUid: 'uid-editor',
      marketingConsentReason: 'imported from the 2025 signup sheet',
      marketingConsentAtMs: ATTESTED_AT,
    }),
    label: `Attested by your team · ${new Date(ATTESTED_AT).toLocaleDateString()}`,
    expectMailable: true,
  },
  {
    email: 'optedin@lumen.co',
    note: 'the person ticked a box',
    doc: entry(HOST, {
      marketingConsent: true,
      marketingConsentBasis: 'contact-opt-in',
      marketingConsentByUid: null,
      marketingConsentAtMs: OPT_IN_AT,
    }),
    label: `Opted in · ${new Date(OPT_IN_AT).toLocaleDateString()}`,
    expectMailable: true,
  },
  {
    email: 'nobody-asked@lumen.co',
    note: 'enrolled with no basis of any kind — the control',
    doc: {},
    label: 'No basis on record',
    expectMailable: false,
  },
  {
    email: 'refused@lumen.co',
    note: 'a stored refusal, which no policy may mail',
    doc: entry(HOST, {
      marketingConsent: false,
      marketingConsentAtMs: OPT_IN_AT,
    }),
    label: `Opted out · ${new Date(OPT_IN_AT).toLocaleDateString()}`,
    expectMailable: false,
  },
  {
    email: 'other-brand@lumen.co',
    note: 'opted in to a different site in the same account',
    doc: entry(OTHER_HOST, {
      marketingConsent: true,
      marketingConsentBasis: 'contact-opt-in',
      marketingConsentAtMs: OPT_IN_AT,
    }),
    label: 'Opted in to another site',
    expectMailable: false,
  },
  {
    /*
     * The pre-host record: a bare `marketingConsent: true` at the top of the
     * document, from before a grant named the brand it was given to. It is a
     * claim with no controller attached and grants to NOBODY — which is also
     * the shape the broken column was reading, so a row that reads "Opted in"
     * here is the original defect returning through the front door.
     */
    email: 'legacy@lumen.co',
    note: 'a grant naming no site at all',
    doc: { marketingConsent: true, marketingConsentAtMs: OPT_IN_AT },
    label: 'Opted in — no site recorded',
    expectMailable: false,
  },
] as const

const memberDocs = CASES.map((one, index) => ({
  $id: `key-${index}`,
  email: one.email,
  name: `Person ${index}`,
  source: 'console:list-add',
  via: 'manual',
  addedAt: { toDate: () => new Date(Date.UTC(2026, 7, 30)) },
  ...one.doc,
}))

const FIRESTORE = {}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useUser: () => ({ data: { uid: 'uid-test' } }),
  usePagedCollection: () => ({
    rows: memberDocs,
    hasMore: false,
    page: 0,
    setPage: () => undefined,
    pageSize: TABLE_PAGE_SIZE_DEFAULT,
    setPageSize: () => undefined,
    status: 'success',
    fromCache: false,
  }),
}))

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
    constraints: [],
  }),
  query: (base: any) => base,
  limit: (value: number) => ({ limit: value }),
  orderBy: (field: string) => ({ orderBy: field }),
  documentId: () => '__name__',
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({ confirm: jest.fn() }),
}))

const mountPanel = async () => {
  render(
    <ListMembersPanel
      hostId={HOST}
      consentGroup={GROUP}
      scope={['orgs', 'org-1']}
      listId="list-1"
      listName="Newsletter"
    />,
  )
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** The Consent cell each address is showing, keyed by address. */
const consentByAddress = () => {
  const headers = Array.from(document.querySelectorAll('thead th')).map(
    (cell) => cell.textContent,
  )
  const column = headers.indexOf('Consent')
  expect(column).toBeGreaterThan(-1)
  const shown = new Map<string, string>()
  for (const row of Array.from(document.querySelectorAll('tbody tr'))) {
    const cells = Array.from(row.querySelectorAll('td'))
    shown.set(
      cells[0]?.textContent?.trim() ?? '',
      cells[column]?.textContent?.trim() ?? '',
    )
  }
  return shown
}

/**
 * The send side, assembled the way `performCampaignSend` assembles it.
 *
 * `collectConsent` there calls `readMarketingBasis(doc.data(), consentGroup)`
 * per swept document and `splitByMarketingConsent` decides the audience from
 * the map. Both functions are the real ones — stubbing either would leave this
 * file comparing the table against a copy of the table.
 */
const sendSplit = () => {
  const records = new Map<string, MarketingConsentRecord>()
  for (const member of memberDocs) {
    records.set(
      member.email,
      readMarketingBasis(member as Record<string, unknown>, GROUP),
    )
  }
  return splitByMarketingConsent(
    memberDocs.map((member) => member.email),
    records,
    DEFAULT_MARKETING_CONSENT_POLICY,
    GROUP,
  )
}

describe('the membership table reports the basis the sender acts on', () => {
  it('names each stored basis for what it is', async () => {
    await mountPanel()
    const shown = consentByAddress()
    for (const one of CASES) {
      expect([one.email, shown.get(one.email)]).toEqual([one.email, one.label])
    }
  })

  /*
   * THE CONTROL, and it is deliberately the second test rather than the last.
   *
   * Making the two surfaces agree is easy in the wrong direction: report a
   * basis for everybody and every assertion about agreement passes while the
   * product mails people nobody ever asked. The split is pinned per REASON, so
   * a refusal that started reading as a grant, or a sister brand's grant that
   * started counting for this one, fails here — a bare `mailable.length` would
   * not tell those apart.
   */
  it('withholds everybody who has no basis this site may use', () => {
    const split = sendSplit()
    expect(split.mailable).toEqual(['attested@lumen.co', 'optedin@lumen.co'])
    expect(split.consented).toBe(2)
    // The attestation is a subset of `consented`, never a fourth population.
    expect(split.consentedByOperator).toBe(1)
    // `strict` is the default policy, under which nothing grandfathers.
    expect(split.grandfathered).toBe(0)
    expect(split.withheld).toBe(4)
    expect(split.withheldNoBasis).toBe(1)
    expect(split.withheldDeclined).toBe(1)
    // The other brand's grant and the unscoped one, both refused for this site.
    expect(split.withheldOtherHost).toBe(2)
  })

  /*
   * The join the two tests above are each half of. It is stated as an
   * equivalence over the SAME fixture rather than as two lists of expected
   * strings, so it holds for any row added to `CASES` later.
   */
  it('says a basis is on record exactly when the send would use one', async () => {
    await mountPanel()
    const shown = consentByAddress()
    const mailable = new Set(sendSplit().mailable)
    for (const one of CASES) {
      const label = shown.get(one.email) ?? ''
      const screenSaysBasis =
        label.startsWith('Opted in ·') || label.startsWith('Attested')
      expect([one.email, screenSaysBasis, mailable.has(one.email)]).toEqual([
        one.email,
        one.expectMailable,
        one.expectMailable,
      ])
    }
  })

  /*
   * The exact regression. A membership carrying an attested basis for THIS
   * site is what the two disagreeing surfaces were looking at: the send read
   * the entry and mailed them, the table read the top of the document, found
   * nothing, and told the operator there was no permission on record.
   */
  it('does not report a per-host attestation as no basis at all', async () => {
    await mountPanel()
    const shown = consentByAddress()
    expect(shown.get('attested@lumen.co')).not.toBe('No basis on record')
    expect(shown.get('optedin@lumen.co')).not.toBe('No basis on record')
    // And the row that genuinely has nothing still says so, plainly.
    expect(shown.get('nobody-asked@lumen.co')).toBe('No basis on record')
  })

  /*
   * A basis given to one brand must not be readable by another, on the screen
   * for the same reason it is not readable by the sender: the account is
   * shared and the permission is not. The panel is handed the group it is
   * being viewed as, so this is the same lookup with a different argument.
   */
  it('shows the other brand its own grant, and this one nothing', async () => {
    await mountPanel()
    expect(consentByAddress().get('other-brand@lumen.co')).toBe(
      'Opted in to another site',
    )
    const asOtherHost = readMarketingBasis(
      memberDocs.find(
        (member) => member.email === 'other-brand@lumen.co',
      ) as Record<string, unknown>,
      soloConsentGroup(OTHER_HOST),
    )
    expect(asOtherHost.basis).toBe('granted')
  })
})
