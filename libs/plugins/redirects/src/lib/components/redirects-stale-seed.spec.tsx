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
 * The redirects console must not rewrite a rule from a seed the server never
 * confirmed (AGL-1358).
 *
 * Editing copies every field the form owns out of the stored rule and writes
 * all of them back under `merge: true`, which protects only what is written
 * elsewhere (`lastHitAt`, `deletedAt`). This is the site in
 * the issue where a rollback is hardest to undo: a reverted `destination` on
 * a **301** is cached by every browser that has already followed it, so the
 * stale target outlives the fix in the console. `kind` reverting from exact
 * to prefix silently widens a rule over a whole subtree, and `priority`
 * reorders which rule fires when several match.
 *
 * Both directions asserted. The positive control matters most: this guard
 * stands in front of the ordinary save, behind eight validation refusals that
 * all return before it.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { setDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import RedirectsConsolePage from './redirects-console-page'

/** Mutable so each spec picks the listener's verdict before rendering. */
const listener = {
  fromCache: false,
  status: 'success' as 'success' | 'error',
}

const redirectDocs = [
  {
    $id: 'red-1',
    source: '/old-pricing',
    // The target a stale seed would restore — permanently, at 301.
    destination: '/pricing',
    statusCode: 301,
    kind: 'exact',
    priority: 100,
    enabled: true,
  },
]

/** The quota-enforcing create path, so a NEW rule is distinguishable. */
const mockCreateResource = jest.fn().mockResolvedValue({ id: 'red-new' })

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreCollection: () => ({
    data: redirectDocs,
    status: listener.status,
    fromCache: listener.fromCache,
  }),
  // The host routing map, for the screen-collision warning only.
  useFirestoreDoc: () => ({
    data: { $id: 'host-1', screens: {} },
    status: 'success',
    fromCache: false,
  }),
  useHostResourceApi: () => mockCreateResource,
  // The REAL guard, not a stub. A stub would let the write through whatever
  // the page passed it, which is the one thing this spec disproves.
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
  // The sampled hit counts read their own day docs; not part of this shape.
  getDoc: jest.fn().mockResolvedValue({ get: () => ({}) }),
  setDoc: jest.fn().mockResolvedValue(undefined),
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

/** A plan that clears the cap, so nothing is refused for that reason
 * instead of the one under test. */
const ORG = { plan: 'business' } as never

beforeEach(() => {
  jest.clearAllMocks()
  listener.fromCache = false
  listener.status = 'success'
})

const renderPage = () =>
  render(<RedirectsConsolePage hostId="host-1" entitled org={ORG} />)

/** Open the stored rule's editor and press the dialog's save. */
function editFirstRuleAndSave() {
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save redirect' }))
}

describe('RedirectsConsolePage (AGL-1358)', () => {
  it('REFUSES to rewrite a rule seeded from an unconfirmed read', async () => {
    listener.fromCache = true
    renderPage()

    editFirstRuleAndSave()

    // Settled, so this cannot pass merely by asserting too early.
    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(setDoc).not.toHaveBeenCalled()
    const [message] = enqueueSnackbar.mock.calls[0]
    expect(message).toEqual(expect.stringContaining('redirect'))
    expect(message).toEqual(expect.stringMatching(/reload/i))
    // …and the dialog is still open with what was being edited.
    expect((screen.getByLabelText('To') as HTMLInputElement).value).toEqual(
      '/pricing',
    )
  })

  it('SAVES normally once the server has confirmed the seed', async () => {
    renderPage()

    editFirstRuleAndSave()

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    const [, payload] = (setDoc as jest.Mock).mock.calls[0]
    // The whole rule rides in the payload — destination, match mode and the
    // permanent status code included.
    expect(payload.destination).toBe('/pricing')
    expect(payload.statusCode).toBe(301)
    expect(payload.kind).toBe('exact')
  })

  it('REFUSES when the redirects read failed, and says so differently', async () => {
    listener.status = 'error'
    renderPage()

    editFirstRuleAndSave()

    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(setDoc).not.toHaveBeenCalled()
    expect(enqueueSnackbar.mock.calls[0][0]).toEqual(
      expect.stringMatching(/could not be loaded/i),
    )
  })

  /**
   * A NEW rule is built from blanks and goes through the quota-enforcing
   * resources API at a fresh uid, so it can overwrite nothing — and the first
   * snapshot of any listener is `fromCache: true`, so guarding it would
   * refuse a save that was never unsafe. Asserted, not assumed.
   */
  it('still creates a NEW rule while the listener is unconfirmed', async () => {
    listener.fromCache = true
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
    expect(setDoc).not.toHaveBeenCalled()
  })
})
