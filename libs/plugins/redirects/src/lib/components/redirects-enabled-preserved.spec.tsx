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
 * Editing a redirect must not turn it back on (AGL-1372).
 *
 * The save hardcoded `enabled: true`, so opening a **disabled** rule,
 * changing its target and saving re-enabled it. A disabled redirect is
 * usually disabled deliberately — a retired campaign, a rule that broke
 * something — and re-enabling it on an unrelated edit changes site routing
 * without the author asking. Same family as the `disabledPlugins` hazard.
 *
 * Two defaults live on one field and it is easy to fix one by breaking the
 * other, so both are asserted here:
 *
 * - EDIT preserves what the rule already was, off included.
 * - CREATE still defaults to on — enforcement queries
 *   `where('enabled', '==', true)`, so a rule created without the field would
 *   never fire.
 *
 * `setDoc` is modelled rather than merely spied on: the edit specs apply the
 * payload with Firestore's merge semantics and assert on what the document
 * ends up holding, so an omitted key and a preserved value are told apart.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { setDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import RedirectsConsolePage from './redirects-console-page'

/** A Timestamp as the row renders it — the hit line calls `toDate()`. */
const LAST_HIT_AT = { toDate: () => new Date('2026-01-01T00:00:00Z') }

/** The stored rule. Mutable so each spec picks its `enabled` first. */
const storedRedirect: Record<string, unknown> = {
  $id: 'red-1',
  source: '/summer-sale',
  destination: '/campaigns/summer',
  statusCode: 301,
  kind: 'exact',
  priority: 100,
  // Deliberately off — a retired campaign.
  enabled: false,
  // Written by enforcement, never by this form; `merge: true` is what keeps
  // it (AGL-1372).
  lastHitAt: LAST_HIT_AT,
}
const redirectDocs = [storedRedirect]

/** What the document holds after the save. */
let stored: Record<string, unknown> = {}

/** The quota-enforcing create path, so a NEW rule is distinguishable. */
const mockCreateResource = jest.fn().mockResolvedValue({ id: 'red-new' })

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreCollection: () => ({
    data: redirectDocs,
    status: 'success',
    fromCache: false,
  }),
  useFirestoreDoc: () => ({
    data: { $id: 'host-1', screens: {} },
    status: 'success',
    fromCache: false,
  }),
  useHostResourceApi: () => mockCreateResource,
  // The REAL guard (AGL-1358). Every save here is a confirmed read, which is
  // exactly the case this bug fires on.
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) =>
    segments[segments.length - 1],
  query: (name: string) => name,
  limit: () => undefined,
  doc: () => ({}),
  getDoc: jest.fn().mockResolvedValue({ get: () => ({}) }),
  setDoc: jest.fn(),
  updateDoc: jest.fn().mockResolvedValue(undefined),
}))

const enqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({
    confirm: jest.fn().mockResolvedValue(undefined),
  }),
}))

/** A plan that clears the cap, so nothing is refused for another reason. */
const ORG = { plan: 'business' } as never

beforeEach(() => {
  jest.clearAllMocks()
  storedRedirect.enabled = false
  stored = { ...storedRedirect }
  delete (stored as { $id?: string }).$id
  ;(setDoc as jest.Mock).mockImplementation(
    async (
      _ref: unknown,
      data: Record<string, unknown>,
      options?: { merge?: boolean },
    ) => {
      stored = options?.merge ? { ...stored, ...data } : { ...data }
    },
  )
})

const renderPage = () =>
  render(<RedirectsConsolePage hostId="host-1" entitled org={ORG} />)

/** Open the stored rule, retarget it, and save — an edit about the
 * destination, not about whether the rule is on. */
function retargetFirstRuleAndSave() {
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  fireEvent.change(screen.getByLabelText('To'), {
    target: { value: '/campaigns/autumn' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save redirect' }))
}

describe('RedirectsConsolePage enabled on save (AGL-1372)', () => {
  it('leaves a DISABLED rule disabled when its target is edited', async () => {
    renderPage()

    retargetFirstRuleAndSave()

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    // The edit landed…
    expect(stored.destination).toBe('/campaigns/autumn')
    // …and the rule the author had switched off is still off. Before the fix
    // this save rerouted the site.
    expect(stored.enabled).toBe(false)
  })

  it('leaves an ENABLED rule enabled when its target is edited', async () => {
    storedRedirect.enabled = true
    stored = { ...storedRedirect }
    renderPage()

    retargetFirstRuleAndSave()

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    expect(stored.enabled).toBe(true)
  })

  /**
   * Enforcement queries `where('enabled', '==', true)`, so a v1 rule stored
   * without the field is not served even though the console's switch shows it
   * on. The edit normalises it the way the switch reads it rather than
   * carrying the absence through.
   */
  it('normalises a rule stored with NO enabled field to on', async () => {
    delete storedRedirect.enabled
    stored = { ...storedRedirect }
    renderPage()

    retargetFirstRuleAndSave()

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    expect(stored.enabled).toBe(true)
  })

  /** The edit payload is narrower than the document, and stays merged. */
  it('keeps the enforcement-written fields the form never sends', async () => {
    renderPage()

    retargetFirstRuleAndSave()

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    expect(stored.lastHitAt).toBe(LAST_HIT_AT)
  })

  /**
   * The other default on the same field: a NEW rule is added to fire, so it
   * is created on. Fixing the edit by dropping `enabled` from the payload
   * entirely would have broken this.
   */
  it('still creates a NEW rule enabled', async () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Add redirect' }))
    fireEvent.change(screen.getByLabelText('From path'), {
      target: { value: '/legacy' },
    })
    fireEvent.change(screen.getByLabelText('To'), {
      target: { value: '/new' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save redirect' }))

    await waitFor(() => expect(mockCreateResource).toHaveBeenCalledTimes(1))
    const [{ data }] = mockCreateResource.mock.calls[0]
    expect(data.enabled).toBe(true)
    expect(setDoc).not.toHaveBeenCalled()
  })
})
