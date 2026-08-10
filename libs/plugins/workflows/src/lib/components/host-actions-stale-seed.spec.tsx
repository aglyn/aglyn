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
 * The actions card must not rewrite an automation from a seed the server
 * never confirmed (AGL-1358).
 *
 * This card is the twin of the console's interaction builder: the same
 * `hosts/{h}/actions` document, the same whole-object payload, the same
 * editor seeded by copying a stored row out of a LISTENER. The builder was
 * guarded (AGL-1066) and this one was not — which is the entire reason the
 * issue names them as a pair.
 *
 * `merge: true` is here so the frequency caps and conditions can be nulled
 * explicitly, not to protect untouched fields: there are none, they are all
 * in the payload. So a cached seed does not lose one edit, it reverts the
 * trigger and every step to whatever the cache last held — on an automation
 * that is running on a live site.
 *
 * Both directions asserted; the positive control matters most, because this
 * guard stands in front of the ordinary save.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { setDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import HostActionsCard from './host-actions-card.component'

/** Mutable so each spec picks the listener's verdict before rendering. */
const listener = {
  fromCache: false,
  status: 'success' as 'success' | 'error',
}

const actionDocs = [
  {
    $id: 'act-1',
    name: 'Welcome banner',
    enabled: true,
    trigger: { event: 'formSubmission' },
    // The steps a stale seed would revert to.
    steps: [{ type: 'siteAlert', message: 'Thanks!', severity: 'info' }],
  },
]
const collections: Record<string, Array<Record<string, unknown>>> = {
  actions: actionDocs,
  workflows: [],
  overlays: [],
  datasets: [],
  lists: [],
  campaigns: [],
  webhooks: [],
  screens: [],
}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreCollection: (build: () => unknown) => ({
    data: collections[build() as string] ?? [],
    status: listener.status,
    fromCache: listener.fromCache,
  }),
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'] }),
  // The REAL guard, not a stub. A stub would let the write through whatever
  // the card passed it, which is the one thing this spec disproves.
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) =>
    segments[segments.length - 1],
  query: (name: string) => name,
  where: () => undefined,
  limit: () => undefined,
  doc: () => ({}),
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
// The runs drawer reads its own listener; it is not part of this shape.
jest.mock('./host-activity-card.component', () => ({
  __esModule: true,
  default: () => null,
}))

/** A plan that entitles the builder, so nothing is refused for that reason. */
const ORG = { plan: 'business' } as never

beforeEach(() => {
  jest.clearAllMocks()
  listener.fromCache = false
  listener.status = 'success'
})

/** Open the stored row's editor and press Save. */
function editFirstActionAndSave() {
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save action' }))
}

describe('HostActionsCard (AGL-1358)', () => {
  it('REFUSES to rewrite an action seeded from an unconfirmed read', async () => {
    listener.fromCache = true
    render(<HostActionsCard hostId="host-1" org={ORG} />)

    editFirstActionAndSave()

    // Settled, so this cannot pass merely by asserting too early.
    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(setDoc).not.toHaveBeenCalled()
    // The refusal explains itself and names a next step, rather than looking
    // like a save that quietly did nothing.
    const [message] = enqueueSnackbar.mock.calls[0]
    expect(message).toEqual(expect.stringContaining('action'))
    expect(message).toEqual(expect.stringMatching(/reload/i))
    // …and the editor is still open with the name that was there.
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toEqual(
      'Welcome banner',
    )
  })

  it('SAVES normally once the server has confirmed the seed', async () => {
    render(<HostActionsCard hostId="host-1" org={ORG} />)

    editFirstActionAndSave()

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    const [, payload, options] = (setDoc as jest.Mock).mock.calls[0]
    expect(payload.name).toEqual('Welcome banner')
    // Every field rides in the payload — which is why `merge` is not
    // protection here, and why the guard has to be.
    expect(payload.steps).toHaveLength(1)
    expect(options).toEqual({ merge: true })
  })

  it('REFUSES when the actions read failed, and says so differently', async () => {
    listener.status = 'error'
    render(<HostActionsCard hostId="host-1" org={ORG} />)

    editFirstActionAndSave()

    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(setDoc).not.toHaveBeenCalled()
    expect(enqueueSnackbar.mock.calls[0][0]).toEqual(
      expect.stringMatching(/could not be loaded/i),
    )
  })

  /**
   * A NEW action is built from defaults at a fresh uid and can overwrite
   * nothing, so guarding it would refuse a save that was never unsafe. The
   * first snapshot of any listener is `fromCache: true`, so this is the
   * common case rather than a corner.
   */
  it('still adds a NEW action while the listener is unconfirmed', async () => {
    listener.fromCache = true
    render(<HostActionsCard hostId="host-1" org={ORG} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add action' }))
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Brand new' },
    })
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'Hello' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save action' }))

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
  })
})
