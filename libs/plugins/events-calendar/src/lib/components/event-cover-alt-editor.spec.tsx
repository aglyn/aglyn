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
 * An author can TYPE the event cover's description (AGL-2418).
 *
 * The render half of this issue is asserted in `event-list.spec.tsx`; a
 * field that reaches the `<img>` but that nobody can fill is not shipped.
 * This is the other half — the console surface, driven through the form
 * rather than by calling the writer, so what is asserted is the thing an
 * author actually does.
 *
 * The clearing case is the one worth the file. This page saves with
 * `setDoc(…, { merge: true })`, under which an omitted key is LEFT ALONE —
 * so an editor that simply stops sending a blank alt would keep the old
 * sentence attached to a cover the author has since replaced, describing a
 * picture that is no longer there. That is worse than never having offered
 * the field, and it is invisible from the console: the box looks empty.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { deleteField, setDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import EventsConsolePage from './events-console-page'

const eventDocs = [
  {
    $id: 'evt-1',
    title: 'Launch party',
    startsAtMs: Date.parse('2026-09-01T18:00:00Z'),
    endsAtMs: Date.parse('2026-09-01T21:00:00Z'),
    coverImage: 'https://acme.example/party.jpg',
    coverImageAlt: 'A crowd raising glasses under string lights',
    status: 'published',
  },
]

/** Stable: `useFirestoreCollection` keys its effect on the instance. */
const firestoreStub = {}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => firestoreStub,
  useConsoleHostRoute: () => ({ orgSlug: 'acme' }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
  useFirestoreCollection: jest.requireActual('@aglyn/tenant-feature-instance')
    .useFirestoreCollection,
  // Also real, and for the same reason: it is a pure function, and the rows
  // these tests drive through the page are exactly what it returns. A stub
  // free to slice differently would be testing the stub.
  ceilingedWindow: jest.requireActual('@aglyn/tenant-feature-instance')
    .ceilingedWindow,
  setFirestoreSessionReporters: jest.requireActual(
    '@aglyn/tenant-feature-instance',
  ).setFirestoreSessionReporters,
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) =>
    segments[segments.length - 1],
  query: (name: string) => name,
  limit: () => undefined,
  doc: () => ({}),
  // Mirrors the real SDK overload: (target, onNext, onError?) or
  // (target, options, onNext, onError?). The listener hooks pass listen
  // options now, so a positional double would capture them as `next`
  // (AGL-2486).
  onSnapshot: (_query: unknown, ...rest: unknown[]) => {
    if (typeof rest[0] !== 'function') rest.shift()
    const next = rest[0] as (snapshot: unknown) => void
    next({
      docs: eventDocs.map((record) => ({
        id: record.$id,
        data: () => record,
      })),
      // Server-confirmed: the AGL-1358 seed guard stands in front of every
      // save on this page, and a cached snapshot would refuse the write
      // being asserted here for a reason that has nothing to do with alt.
      metadata: { fromCache: false, hasPendingWrites: false },
    })
    return () => undefined
  },
  setDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({
    confirm: jest.fn().mockResolvedValue(undefined),
  }),
}))

beforeEach(() => {
  jest.clearAllMocks()
  eventDocs[0].coverImage = 'https://acme.example/party.jpg'
  eventDocs[0].coverImageAlt = 'A crowd raising glasses under string lights'
})

const openEditor = () => {
  render(<EventsConsolePage hostId="host-1" entitled />)
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
}

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save event' }))

const savedPayload = async () => {
  await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
  return (setDoc as jest.Mock).mock.calls[0][1]
}

describe('the event cover description field (AGL-2418)', () => {
  it('shows the stored description for editing', () => {
    openEditor()

    expect(
      (screen.getByLabelText('Cover image description') as HTMLInputElement)
        .value,
    ).toBe('A crowd raising glasses under string lights')
  })

  it('saves what the author types', async () => {
    openEditor()

    fireEvent.change(screen.getByLabelText('Cover image description'), {
      target: { value: 'Ada cutting the ribbon on the new workshop' },
    })
    save()

    expect((await savedPayload()).coverImageAlt).toBe(
      'Ada cutting the ribbon on the new workshop',
    )
  })

  it('DELETES the key when the author clears the box, rather than leaving a stale sentence behind', async () => {
    openEditor()

    fireEvent.change(screen.getByLabelText('Cover image description'), {
      target: { value: '' },
    })
    save()

    // Not `''`, and not omitted: under `merge` both would keep the old value.
    expect((await savedPayload()).coverImageAlt).toEqual(deleteField())
  })

  it('offers no description box for an event with no cover', () => {
    eventDocs[0].coverImage = ''
    eventDocs[0].coverImageAlt = ''
    openEditor()

    // The URL field is there; the description that would have nothing to
    // describe is not.
    expect(screen.getByLabelText('Cover image URL')).toBeTruthy()
    expect(screen.queryByLabelText('Cover image description')).toBeNull()
  })
})
