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
 * A REFUND THAT REACHED NO CONTACT IS COUNTABLE — AND NOW VISIBLE (AGL-2329).
 *
 * `recordContactRefund` refuses to create a contact for a refund, on the
 * reasoning that a contact holding a refund and no purchase is a phantom
 * record with negative lifetime value. Every refusal increments
 * `hosts/{hostId}/counters/contactRefundsUnmatched`, and the writer's comment
 * says the shape mirrors `contactsDropped` *"so an operator…"* — and there
 * the sentence stops. `contactsDropped` had a console reader; this one had
 * none. The money moved, the customer's timeline did not show it, and the
 * number recording that fact was incremented into a document nobody read.
 *
 * WHAT THIS FILE HAS TO CATCH:
 *
 *  - **The right counter.** The double discriminates the two counter
 *    documents by path and gives them DIFFERENT totals, so a page reading
 *    `contactsDropped` twice — the likeliest wiring mistake, since the new
 *    read is a copy of the old one — renders the wrong number and fails.
 *  - **The measured value, not a constant.** The total is asserted as the
 *    figure the counter holds, and again at a second, different figure.
 *  - **Both facts survive together.** A host can be over its band AND have
 *    unmatched refunds. The two alerts must not be chained into one ternary
 *    where the second is unreachable.
 *  - **Zero says nothing.** An alert that renders at 0 would tell every
 *    healthy merchant they had a problem.
 */

import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import CrmConsolePage from './crm-console-page'
import { CRM_CONSOLE_SECTIONS } from './crm-console-sections'

const ORG = { $id: 'org-1', plan: 'pro' } as any

const contactDocs = [
  {
    $id: 'con-1',
    email: 'buyer@example.test',
    name: 'A Buyer',
    sources: ['order'],
    interactions: [],
    tags: [],
    notes: '',
  },
]

const collections: Record<string, Array<Record<string, unknown>>> = {
  contacts: contactDocs,
  contactSegments: [],
}

/**
 * The two counter documents, keyed by their LAST path segment.
 *
 * Given deliberately different totals. The new read is a near-copy of the
 * `contactsDropped` read one hook above it, so pointing it at the wrong
 * document is the mistake most likely to happen and least likely to look
 * wrong — unless the two numbers differ, which here they do.
 */
const counters: Record<string, Record<string, unknown>> = {
  contactsDropped: { total: 0 },
  contactRefundsUnmatched: { total: 0 },
}

const FIRESTORE = {}
const DATA_SCOPE = { scope: ['orgs', 'org-1'] as const }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  /*
   * The real translator, not a stub. It is a pure function of the shared
   * declaration, and returning `undefined` here made every render throw —
   * a mock that omits a barrel export does not fail as "missing", it fails
   * as the component being broken.
   */
  listFilterConstraints: jest.requireActual(
    '@aglyn/tenant-feature-instance',
  ).listFilterConstraints,
  useFirestore: () => FIRESTORE,
  useOrgDataScope: () => DATA_SCOPE,
  // The site's campaigns, which fill the picker in the contact profile panel.
  useHostCampaigns: () => ({ options: [], truncated: false, ready: true }),
  useFirestoreCollection: (build: () => unknown) => ({
    data: collections[build() as string] ?? [],
    status: 'success',
    fromCache: false,
  }),
  // Discriminates by PATH. A double answering the same document for every
  // call would make the assertions below true no matter which counter the
  // page read — the false green this file exists to avoid.
  useFirestoreDoc: (build: () => unknown) => ({
    data: counters[build() as string] ?? null,
    status: 'success',
    fromCache: false,
  }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
  // The signed-in reader, for the "Assigned to me" toggle; nobody here owns
  // anything, so it narrows nothing.
  useUser: () => ({ data: { uid: 'user-1' } }),
  useHostActivityLogger: () => jest.fn(),
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) =>
    segments[segments.length - 1],
  query: (name: string) => name,
  limit: (value: number) => value,
  doc: (_db: unknown, ...segments: string[]) => segments[segments.length - 1],
  getCountFromServer: async () => ({ data: () => ({ count: 1 }) }) as any,
  addDoc: jest.fn().mockResolvedValue(undefined),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({
    confirm: jest.fn().mockResolvedValue(undefined),
  }),
}))

// Only the section the URL names renders (AGL-2595): the rail's own chrome is
// drawn away and the section body passed through, so what the assertions read
// is the people list the v1 page was.
jest.mock('@aglyn/shared-ui-next', () => ({
  HubSections: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

// A row is a link to the record page (AGL-2596); nothing here follows one.
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

const BASE_PATH = '/acme/hosts/shop/contacts'

/** The people section, as the shell mounts it: the resolved rail and the URL's section. */
const hubProps = {
  basePath: BASE_PATH,
  sections: CRM_CONSOLE_SECTIONS.map((section) => ({
    id: section.id,
    label: section.label,
    href: `${BASE_PATH}/${section.id}`,
    visible: true,
  })),
  section: 'contacts',
  segments: ['contacts'],
}

beforeEach(() => {
  jest.clearAllMocks()
  counters['contactsDropped'] = { total: 0 }
  counters['contactRefundsUnmatched'] = { total: 0 }
})

const mount = () =>
  render(
    <CrmConsolePage
      hostId="host-1"
      entitled
      org={ORG}
      releaseFlag={{ released: true, ready: true }}
      {...hubProps}
    />,
  )

describe('unmatched refunds are visible to the merchant (AGL-2329)', () => {
  it('reports the counter it was given, with the reason for the latest one', async () => {
    counters['contactRefundsUnmatched'] = {
      total: 7,
      lastReason: 'contact-deleted',
      lastOrderId: 'ord-9',
      lastAtMs: 1_770_000_000_000,
    }
    mount()

    await waitFor(() =>
      expect(
        screen.queryByText(/7 refunds could not be recorded against a contact/),
      ).not.toBeNull(),
    )
    // The reason distinguishes an actionable case from one nothing should
    // undo. Collapsing all three into "unmatched" turns a fact an operator
    // can act on into a statistic.
    expect(
      screen.getByText(
        /the contact was deleted between the sale and the refund/,
      ),
    ).toBeTruthy()
    // The other counter is zero, so a page reading `contactsDropped` for
    // this alert would render nothing at all.
    expect(screen.queryByText(/not captured while your contact band was full/))
      .toBeNull()
  })

  it('moves with the counter, so a constant cannot pass', async () => {
    counters['contactRefundsUnmatched'] = { total: 1, lastReason: 'no-email' }
    const first = mount()
    await waitFor(() =>
      expect(
        screen.queryByText(/1 refund could not be recorded against a contact/),
      ).not.toBeNull(),
    )
    // Singular, too — "1 refunds" is the tell of a message built once.
    expect(screen.queryByText(/1 refunds /)).toBeNull()
    expect(
      screen.getByText(/the order carried no email address/),
    ).toBeTruthy()
    first.unmount()

    counters['contactRefundsUnmatched'] = { total: 42, lastReason: 'no-contact' }
    mount()
    await waitFor(() =>
      expect(
        screen.queryByText(/42 refunds could not be recorded against a contact/),
      ).not.toBeNull(),
    )
    expect(
      screen.getByText(/no contact record matched the buyer/),
    ).toBeTruthy()
  })

  it('shows the dropped-signup fact and the refund fact together', async () => {
    // Both can be true at once and they have different remedies. Chained
    // into one ternary — which is how the dropped alert is written — the
    // second would be unreachable whenever the first fired.
    counters['contactsDropped'] = { total: 3 }
    counters['contactRefundsUnmatched'] = { total: 2, lastReason: 'no-email' }
    mount()

    await waitFor(() =>
      expect(
        screen.queryByText(/3 earlier visitors were not captured/),
      ).not.toBeNull(),
    )
    expect(
      screen.getByText(/2 refunds could not be recorded against a contact/),
    ).toBeTruthy()
  })

  it('says nothing when nothing went wrong', async () => {
    mount()
    await waitFor(() => expect(screen.queryByText('A Buyer')).not.toBeNull())
    // An alert that renders at zero tells every healthy merchant they have a
    // problem, which is worse than the silence it replaced.
    expect(
      screen.queryByText(/could not be recorded against a contact/),
    ).toBeNull()
  })
})
