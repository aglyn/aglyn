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
 * THE CUSTOMER IS TOLD WHY THEIR PLUGIN WAS KILLED (AGL-2328, item 1).
 *
 * `/api/admin/plugin-reviews` refuses a revocation without a reason — staff
 * are made to type one — and stores it on `revocations/{listingId}` beside
 * the `versions` array. Every reader in the repo read `versions` and nothing
 * else; the type's own comment calls `versions` *"the ONLY field any reader
 * consults"*, which was true and was the defect. The person whose site broke
 * saw a bare "disabled" chip and a generic paragraph, and the explanation
 * they were owed sat one field away in a document this card already reads.
 *
 * WHAT THIS FILE HAS TO CATCH:
 *
 *  - **The reason must be THIS revocation's reason.** Two installs are
 *    revoked with two different reasons in the same render, and each is
 *    asserted inside its own row. A card that rendered the first revocation's
 *    reason on every disabled plugin looks completely right and is wrong for
 *    every row but one — the exact failure mode this sweep keeps finding.
 *  - **Presence is not correctness.** Nothing here asserts a label or a
 *    symbol name; the assertions are the operator's own sentences.
 *  - **A healthy plugin says nothing.** The third install is not revoked and
 *    must carry neither alert nor reason, or "disabled" stops meaning
 *    anything.
 *  - **A revocation with no reason recorded must not render an empty
 *    quotation**, which reads as "no reason was given" rather than "this
 *    predates the requirement".
 */

import { render, screen, within } from '@testing-library/react'

jest.mock('@aglyn/aglyn', () => ({
  __esModule: true,
  buildRoute: () => undefined,
  PLUGIN_COMPONENT_ID: 'plugin',
  pluginDocsHelp: () => undefined,
  Route: { ORG_PLUGIN_INSTALLATION: 'ORG_PLUGIN_INSTALLATION' },
  compareArtifactVersions: () => 0,
  /*
   * THE REAL PREDICATE'S SEMANTICS, not a stub that says yes.
   *
   * `isPluginRevoked` decides whether a row is disabled at all. A double
   * returning `true` unconditionally would disable the healthy install too
   * and quietly delete the negative case below — the half that gives
   * "disabled" its meaning.
   */
  isPluginRevoked: (revocation: any, version: string) =>
    Array.isArray(revocation?.versions) &&
    revocation.versions.includes(version),
  lockdownRefusalText: () => '',
  parseLockdownRefusal: () => null,
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  AppLink: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  CardDisplay: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  useConfirmationContext: () => ({ confirm: async () => true }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: () => undefined }),
}))

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: () => ({}),
  deleteDoc: async () => undefined,
  doc: () => ({}),
  documentId: () => '__name__',
  limit: () => ({}),
  query: () => ({}),
  where: () => ({}),
}))

/**
 * Collections keyed by the order the component subscribes to them:
 * host installs, org installs, listings, revocations.
 */
let mockCollections: any[][] = []
let mockCall = 0
jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'u-1', getIdToken: async () => 'tok' } }),
  useHostOrgId: () => 'org-1',
  useFirestoreCollection: () => ({ data: mockCollections[mockCall++] ?? [] }),
}))

import { HostPluginsCard } from './host-plugins-card.component'

/** Two revoked installs with DIFFERENT stories, plus one healthy one. */
const INSTALLS = [
  { $id: 'atlas', pluginId: 'atlas', displayName: 'Atlas Maps', version: '2.1.0' },
  { $id: 'ledger', pluginId: 'ledger', displayName: 'Ledger Sync', version: '1.4.2' },
  { $id: 'fine', pluginId: 'fine', displayName: 'Healthy Plugin', version: '3.0.0' },
]

const REVOCATIONS = [
  {
    $id: 'atlas',
    versions: ['2.1.0'],
    reason: 'Exfiltrated form submissions to an undisclosed endpoint.',
    revokedAt: { toMillis: () => Date.UTC(2026, 6, 14) },
  },
  {
    $id: 'ledger',
    versions: ['1.4.2'],
    reason: 'Shipped a build that does not match its published source.',
    revokedAt: { toMillis: () => Date.UTC(2026, 7, 2) },
  },
]

/**
 * The block for ONE install, found by growing outward from its name until
 * the next step would swallow a sibling install.
 *
 * Written this way rather than as a fixed number of `parentElement` hops
 * because a fixed hop count is a guess about the markup: the first attempt
 * here climbed one level too far, produced a scope containing every row, and
 * made the per-row assertions vacuously true — a card printing one reason
 * everywhere would have passed. The predicate cannot drift the same way.
 */
const rowFor = (name: string) => {
  const others = INSTALLS.map((install) => install.displayName).filter(
    (other) => other !== name,
  )
  let node: HTMLElement = screen.getByText(name)
  while (
    node.parentElement &&
    !others.some((other) => node.parentElement?.textContent?.includes(other))
  ) {
    node = node.parentElement
  }
  return within(node)
}

type Revocation = {
  $id: string
  versions: string[]
  reason?: string
  revokedAt?: { toMillis: () => number }
}

const renderCard = (
  revocations: Revocation[] = REVOCATIONS,
  installs = INSTALLS,
) => {
  mockCall = 0
  mockCollections = [installs, [], [], revocations]
  return render(<HostPluginsCard hostId="host-1" />)
}

describe('a revoked plugin explains itself (AGL-2328)', () => {
  it('shows each revocation its OWN reason', () => {
    renderCard()

    // Asserted per row. Both sentences are present and they are not the same
    // sentence — a card reusing the first revocation's reason everywhere
    // renders something entirely plausible and fails right here.
    expect(
      rowFor('Atlas Maps').getByText(
        /Exfiltrated form submissions to an undisclosed endpoint\./,
      ),
    ).toBeTruthy()
    expect(
      rowFor('Ledger Sync').getByText(
        /Shipped a build that does not match its published source\./,
      ),
    ).toBeTruthy()

    // And neither row carries the other's story.
    expect(
      rowFor('Atlas Maps').queryByText(/does not match its published source/),
    ).toBeNull()
    expect(
      rowFor('Ledger Sync').queryByText(/Exfiltrated form submissions/),
    ).toBeNull()
  })

  it('says when it happened, per revocation', () => {
    renderCard()
    // Different dates, so a card stamping one date on every row is caught.
    expect(rowFor('Atlas Maps').getByText(/^Disabled /)).toBeTruthy()
    expect(
      rowFor('Atlas Maps').getByText(
        new RegExp(new Date(Date.UTC(2026, 6, 14)).toLocaleDateString().replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')),
      ),
    ).toBeTruthy()
    expect(
      rowFor('Ledger Sync').getByText(
        new RegExp(new Date(Date.UTC(2026, 7, 2)).toLocaleDateString().replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')),
      ),
    ).toBeTruthy()
  })

  it('leaves a healthy plugin alone', () => {
    renderCard()
    // The negative case is what gives "disabled" its meaning. A predicate or
    // a render that flagged everything would pass every assertion above.
    const healthy = rowFor('Healthy Plugin')
    expect(healthy.queryByText(/The platform disabled this plugin version/)).toBeNull()
    expect(healthy.queryByText(/^Reason: /)).toBeNull()
  })

  it('renders no empty quotation for a revocation predating the reason requirement', () => {
    renderCard([{ $id: 'atlas', versions: ['2.1.0'], reason: '   ' }])
    const atlas = rowFor('Atlas Maps')
    // Still disabled, and still says so…
    expect(atlas.getByText(/The platform disabled this plugin version/)).toBeTruthy()
    // …but "Reason:" with nothing after it reads as "we would not say",
    // which is a different and worse claim than "this is old".
    expect(atlas.queryByText(/^Reason: *$/)).toBeNull()
    expect(atlas.queryByText(/Reason:/)).toBeNull()
  })
})
