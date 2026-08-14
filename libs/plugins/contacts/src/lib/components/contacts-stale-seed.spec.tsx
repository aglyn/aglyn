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
 * The contacts profile drawer must not write from a seed the server never
 * confirmed (AGL-1358).
 *
 * This payload is the narrowest in the issue and worth being precise about:
 * `email`, `sources` and `interactions` are NOT in it, so most of the contact
 * is genuinely safe. What makes it the same shape is that the two fields that
 * are in it — `tags` and `notes` — are BOTH written on every save and both
 * come off the listener seed. Editing the notes against a cached read carries
 * the tags back with them.
 *
 * That is not cosmetic: tags are what `contactMatchesSegment` runs on, and a
 * saved segment is a campaign audience. A rollback here silently changes who
 * gets emailed.
 *
 * Both directions asserted. The positive control matters most: this guard
 * stands in front of the ordinary save.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { updateDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import ContactsConsolePage from './contacts-console-page'

/** Mutable so each spec picks the listener's verdict before rendering. */
const listener = {
  fromCache: false,
  status: 'success' as 'success' | 'error',
}

const contactDocs = [
  {
    $id: 'con-1',
    email: 'ada@example.test',
    name: 'Ada Lovelace',
    sources: ['inbox'],
    interactions: [{ summary: 'Submitted the contact form', atMs: 1 }],
    // The tags a stale seed would roll back — and with them, who a saved
    // segment sends to.
    tags: ['vip', 'newsletter'],
    notes: 'Prefers email',
  },
]
const collections: Record<string, Array<Record<string, unknown>>> = {
  contacts: contactDocs,
  contactSegments: [],
}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'] }),
  useFirestoreCollection: (build: () => unknown) => ({
    data: collections[build() as string] ?? [],
    status: listener.status,
    fromCache: listener.fromCache,
  }),
  // The dropped-contacts counter, displayed only.
  useFirestoreDoc: () => ({
    data: { total: 0 },
    status: 'success',
    fromCache: false,
  }),
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
  // The page's audience head-count (AGL-1706). Nothing here turns on it —
  // it is stubbed so the real SDK is not handed this file's string-shaped
  // collection ref, which throws synchronously out of the effect.
  getCountFromServer: jest.fn(async () => ({
    data: () => ({ count: contactDocs.length }),
  })),
  addDoc: jest.fn().mockResolvedValue(undefined),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
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

beforeEach(() => {
  jest.clearAllMocks()
  listener.fromCache = false
  listener.status = 'success'
})

const renderPage = () =>
  render(<ContactsConsolePage hostId="host-1" entitled />)

/**
 * Open the contact's drawer, edit only the NOTES, and save — the case that
 * makes this the AGL-1358 shape, because the tags ride along untouched.
 */
function openContactEditNotesAndSave() {
  fireEvent.click(screen.getByText('Ada Lovelace'))
  fireEvent.change(screen.getByLabelText('Notes'), {
    target: { value: 'Prefers a phone call' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
}

describe('ContactsConsolePage (AGL-1358)', () => {
  it('REFUSES to write a contact seeded from an unconfirmed read', async () => {
    listener.fromCache = true
    renderPage()

    openContactEditNotesAndSave()

    // Settled, so this cannot pass merely by asserting too early.
    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(updateDoc).not.toHaveBeenCalled()
    const [message] = enqueueSnackbar.mock.calls[0]
    expect(message).toEqual(expect.stringContaining('contact'))
    expect(message).toEqual(expect.stringMatching(/reload/i))
    // The drawer keeps what was typed, so the refusal is not a silent no-op.
    expect((screen.getByLabelText('Notes') as HTMLInputElement).value).toEqual(
      'Prefers a phone call',
    )
  })

  it('SAVES normally once the server has confirmed the seed', async () => {
    renderPage()

    openContactEditNotesAndSave()

    await waitFor(() => expect(updateDoc).toHaveBeenCalledTimes(1))
    const [, payload] = (updateDoc as jest.Mock).mock.calls[0]
    expect(payload.notes).toBe('Prefers a phone call')
    // The tags ride along untouched — which is exactly why the guard is here.
    expect(payload.tags).toEqual(['vip', 'newsletter'])
  })

  it('REFUSES when the contacts read failed, and says so differently', async () => {
    listener.status = 'error'
    renderPage()

    openContactEditNotesAndSave()

    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(updateDoc).not.toHaveBeenCalled()
    expect(enqueueSnackbar.mock.calls[0][0]).toEqual(
      expect.stringMatching(/could not be loaded/i),
    )
  })
})
