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
 * The three remaining marketing surfaces must not write a whole object back
 * from a seed the server never confirmed (AGL-1358).
 *
 * The two host-doc cards are the shape at its least obvious. Neither uses
 * `setDoc`; both call `updateDoc` — which reads like a partial write and is
 * not one, because a nested MAP value REPLACES. `updateDoc(host, {popup:
 * {...}})` protects the host document's other fields and nothing inside
 * `popup`, and every field inside it comes off the listener seed. Against a
 * cached read, retyping the headline restores yesterday's body, link,
 * schedule and `enabled` flag on a live site.
 *
 * They also have no create path to exempt, and that is worth stating rather
 * than inferring from silence: the write goes to a FIXED document path, so
 * the empty draft `host?.popup ?? {}` yields when the cache has never seen a
 * popup is not the harmless blank a fresh uid would be — it replaces whatever
 * the server really holds with nothing. Both seeds are guarded.
 *
 * Experiments is the ordinary shape with an unusual field: `status` rides in
 * the whole-row payload, and is otherwise only ever moved by the start/pause/
 * finish controls, so a cached seed can restart a finished test or halt one
 * splitting live traffic — from the Save button of an unrelated rename.
 *
 * Both directions are asserted at each site. The positive control matters
 * most: these stand in front of the ordinary save.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { setDoc, updateDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import AnnouncementBarCard from './announcement-bar-card.component'
import HostExperimentsCard from './host-experiments-card.component'
import PopupCard from './popup-card.component'

/** Mutable so each spec picks the listener's verdict before rendering. */
const listener = {
  fromCache: false,
  status: 'success' as 'success' | 'error',
}

/**
 * The host doc both overlay cards are seeded from. Every value here is one a
 * stale save would restore over whatever the server now holds.
 */
const hostDoc = {
  $id: 'host-1',
  popup: {
    enabled: true,
    headline: 'Spring sale',
    body: 'Ten percent off everything',
    ctaLabel: 'Shop',
    ctaHref: '/sale',
    trigger: 'delay',
    triggerValue: 3,
    frequencyDays: 7,
  },
  announcementBar: {
    enabled: true,
    text: 'Free shipping this week',
    href: '/shipping',
    backgroundColor: '#111827',
    textColor: '#ffffff',
    dismissible: true,
  },
}

const experimentDocs = [
  {
    $id: 'exp-1',
    name: 'Hero copy',
    // The field that makes this more than a lost edit: a stale seed can move
    // it, and nothing else on this card writes it except Start/Pause/Finish.
    status: 'running',
    target: 'screen',
    screenId: 'screen-1',
    variants: [
      { id: 'a', name: 'A (control)', weight: 1 },
      { id: 'b', name: 'B', weight: 1 },
    ],
    goal: { event: 'formSubmission' },
  },
]
const screenDocs = [{ $id: 'screen-1', displayName: 'Home' }]

const mockLogActivity = jest.fn()

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreDoc: () => ({
    data: hostDoc,
    status: listener.status,
    fromCache: listener.fromCache,
  }),
  useFirestoreCollection: (build: () => unknown) => ({
    data:
      build() === 'experiments'
        ? experimentDocs
        : build() === 'screens'
          ? screenDocs
          : [],
    status: listener.status,
    fromCache: listener.fromCache,
  }),
  useHostActivityLogger: () => mockLogActivity,
  // The REAL guard, not a stub. A stub would let the write through whatever
  // the card passed it, which is the one thing these specs disprove.
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))

// Only the ref builders are stubbed; the real module rides along because
// `@aglyn/shared-util-timestamp` extends the SDK's `Timestamp`.
jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, _hosts: string, _id: string, name: string) => name,
  query: (name: string) => name,
  limit: () => undefined,
  doc: () => ({}),
  deleteDoc: jest.fn(),
  getDocs: jest.fn().mockResolvedValue({ forEach: () => undefined }),
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
  useLoading: () => ({ queueLoading: () => () => undefined }),
  useConfirmationContext: () => ({
    confirm: jest.fn().mockResolvedValue(undefined),
  }),
}))
// The 14-day metrics line reads analytics day docs of its own and is not
// under test here.
jest.mock('./overlay-stats-row.component', () => ({
  __esModule: true,
  default: () => null,
}))

/** A plan that entitles overlays and A/B tests, so nothing is refused for
 * that reason instead of the one under test. */
const ORG = { plan: 'business' } as never

beforeEach(() => {
  jest.clearAllMocks()
  listener.fromCache = false
  listener.status = 'success'
})

describe('PopupCard (AGL-1358)', () => {
  /** Save is disabled until the form differs from the seed. */
  const editHeadlineAndSave = () => {
    fireEvent.change(screen.getByLabelText('Headline'), {
      target: { value: 'Summer sale' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  }

  it('REFUSES to rewrite the popup from an unconfirmed read', async () => {
    listener.fromCache = true
    render(<PopupCard hostId="host-1" org={ORG} />)

    editHeadlineAndSave()

    // Settled, so this cannot pass merely by asserting too early.
    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(updateDoc).not.toHaveBeenCalled()
    // …and no history entry claiming an update that never landed.
    expect(mockLogActivity).not.toHaveBeenCalled()
    const [message] = enqueueSnackbar.mock.calls[0]
    expect(message).toEqual(expect.stringContaining('popup'))
    expect(message).toEqual(expect.stringMatching(/reload/i))
    // The form keeps what was typed, so the refusal is not a silent no-op.
    expect(
      (screen.getByLabelText('Headline') as HTMLInputElement).value,
    ).toEqual('Summer sale')
  })

  it('SAVES normally once the server has confirmed the seed', async () => {
    render(<PopupCard hostId="host-1" org={ORG} />)

    editHeadlineAndSave()

    await waitFor(() => expect(updateDoc).toHaveBeenCalledTimes(1))
    const [, payload] = (updateDoc as jest.Mock).mock.calls[0]
    expect(payload.popup.headline).toBe('Summer sale')
    // The whole map is in the payload — which is why the guard is the only
    // thing standing between a stale seed and the rest of it.
    expect(payload.popup.body).toBe('Ten percent off everything')
    expect(mockLogActivity).toHaveBeenCalledTimes(1)
  })

  it('REFUSES when the host read failed, and says so differently', async () => {
    listener.status = 'error'
    render(<PopupCard hostId="host-1" org={ORG} />)

    editHeadlineAndSave()

    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(updateDoc).not.toHaveBeenCalled()
    expect(enqueueSnackbar.mock.calls[0][0]).toEqual(
      expect.stringMatching(/could not be loaded/i),
    )
  })
})

describe('AnnouncementBarCard (AGL-1358)', () => {
  const editTextAndSave = () => {
    fireEvent.change(screen.getByLabelText('Text'), {
      target: { value: 'Free shipping all month' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  }

  it('REFUSES to rewrite the bar from an unconfirmed read', async () => {
    listener.fromCache = true
    render(<AnnouncementBarCard hostId="host-1" org={ORG} />)

    editTextAndSave()

    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(updateDoc).not.toHaveBeenCalled()
    expect(mockLogActivity).not.toHaveBeenCalled()
    const [message] = enqueueSnackbar.mock.calls[0]
    expect(message).toEqual(expect.stringContaining('announcement bar'))
    expect(message).toEqual(expect.stringMatching(/reload/i))
    expect((screen.getByLabelText('Text') as HTMLInputElement).value).toEqual(
      'Free shipping all month',
    )
  })

  it('SAVES normally once the server has confirmed the seed', async () => {
    render(<AnnouncementBarCard hostId="host-1" org={ORG} />)

    editTextAndSave()

    await waitFor(() => expect(updateDoc).toHaveBeenCalledTimes(1))
    const [, payload] = (updateDoc as jest.Mock).mock.calls[0]
    expect(payload.announcementBar.text).toBe('Free shipping all month')
    expect(payload.announcementBar.backgroundColor).toBe('#111827')
    expect(mockLogActivity).toHaveBeenCalledTimes(1)
  })
})

describe('HostExperimentsCard (AGL-1358)', () => {
  const editFirstExperimentAndSave = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  }

  it('REFUSES to rewrite an experiment seeded from an unconfirmed read', async () => {
    listener.fromCache = true
    render(<HostExperimentsCard hostId="host-1" org={ORG} />)

    editFirstExperimentAndSave()

    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(setDoc).not.toHaveBeenCalled()
    expect(mockLogActivity).not.toHaveBeenCalled()
    const [message] = enqueueSnackbar.mock.calls[0]
    expect(message).toEqual(expect.stringContaining('experiment'))
    expect(message).toEqual(expect.stringMatching(/reload/i))
    // The editor stays open with the row that was being edited.
    expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toEqual(
      'Hero copy',
    )
  })

  it('SAVES normally once the server has confirmed the seed', async () => {
    render(<HostExperimentsCard hostId="host-1" org={ORG} />)

    editFirstExperimentAndSave()

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    const [, payload] = (setDoc as jest.Mock).mock.calls[0]
    // The whole row, `status` included — the reason this one is not merely
    // a lost edit.
    expect(payload.status).toBe('running')
    expect(mockLogActivity).toHaveBeenCalledTimes(1)
  })

  it('REFUSES when the experiments read failed, and says so differently', async () => {
    listener.status = 'error'
    render(<HostExperimentsCard hostId="host-1" org={ORG} />)

    editFirstExperimentAndSave()

    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(setDoc).not.toHaveBeenCalled()
    expect(enqueueSnackbar.mock.calls[0][0]).toEqual(
      expect.stringMatching(/could not be loaded/i),
    )
  })

  /**
   * A NEW experiment comes from `newExperiment()` at a fresh uid and can
   * overwrite nothing, so guarding it would refuse a save that was never
   * unsafe — and the first snapshot of any listener is `fromCache: true`, so
   * that is the common case rather than a corner.
   */
  it('still creates a NEW experiment while the listener is unconfirmed', async () => {
    listener.fromCache = true
    render(<HostExperimentsCard hostId="host-1" org={ORG} />)

    fireEvent.click(screen.getByRole('button', { name: 'New experiment' }))
    fireEvent.change(screen.getByLabelText(/^Name/), {
      target: { value: 'Pricing copy' },
    })
    // The screen under test, without which validation refuses first and the
    // guard would never be reached.
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Screen' }))
    fireEvent.click(
      within(screen.getByRole('listbox')).getByText('Home'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
  })
})
