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
 * The workflows card must not rewrite a workflow from a seed the server never
 * confirmed (AGL-1358).
 *
 * Editing destructures a whole stored row into `draft` and writes
 * `{...definition}` back under `merge: true`, which protects nothing — every
 * field is in the payload, and `steps` is an array, which a merge replaces
 * wholesale rather than diffing.
 *
 * `trigger` is what makes this more than a lost edit. It is `{event, filter}`
 * or `null` for manual-only, and nothing else on this card writes it, so a
 * cached seed can re-arm an automation the author disarmed — or disarm one
 * running on a live site — from the Save button of an unrelated rename.
 *
 * Both directions asserted. The positive control matters most: this guard
 * stands in front of the ordinary save.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { setDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import HostWorkflowsCard from './host-workflows-card.component'

/** Mutable so each spec picks the listener's verdict before rendering. */
const listener = {
  fromCache: false,
  status: 'success' as 'success' | 'error',
}

const workflowDocs = [
  {
    $id: 'wf-1',
    name: 'Notify on signup',
    // The live automation state a stale seed would revert.
    trigger: { event: 'formSubmission', filter: '' },
    steps: [{ functionName: 'sendEmail', args: [], resultName: 'sent' }],
    returnValue: 'sent',
  },
]
const collections: Record<string, Array<Record<string, unknown>>> = {
  workflows: workflowDocs,
  functions: [],
  variables: [],
  actions: [],
}

/** The quota-enforcing create path, so a NEW workflow is distinguishable. */
const mockCreateResource = jest.fn().mockResolvedValue({ id: 'wf-new' })

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreCollection: (build: () => unknown) => ({
    data: collections[build() as string] ?? [],
    status: listener.status,
    fromCache: listener.fromCache,
  }),
  useHostResourceApi: () => mockCreateResource,
  useUser: () => ({ data: { uid: 'uid-owner', getIdToken: jest.fn() } }),
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
// The runs drawer and the where-used scan read their own sources; neither is
// part of this shape.
jest.mock('./host-activity-card.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('@aglyn/plugins-logic', () => ({
  WhereUsedDialog: () => null,
  fetchWhereUsed: jest.fn().mockResolvedValue({}),
  summarizeDependents: () => '',
}))

/** A plan that entitles workflows, so nothing is refused for that reason
 * instead of the one under test. */
const ORG = { plan: 'business' } as never

beforeEach(() => {
  jest.clearAllMocks()
  listener.fromCache = false
  listener.status = 'success'
})

/** Open the stored row's editor and press the dialog's save. */
function editFirstWorkflowAndSave() {
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
}

describe('HostWorkflowsCard (AGL-1358)', () => {
  it('REFUSES to rewrite a workflow seeded from an unconfirmed read', async () => {
    listener.fromCache = true
    render(<HostWorkflowsCard hostId="host-1" org={ORG} />)

    editFirstWorkflowAndSave()

    // Settled, so this cannot pass merely by asserting too early.
    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(setDoc).not.toHaveBeenCalled()
    // The refusal explains itself and names a next step.
    const [message] = enqueueSnackbar.mock.calls[0]
    expect(message).toEqual(expect.stringContaining('workflow'))
    expect(message).toEqual(expect.stringMatching(/reload/i))
    // …and the dialog is still open with what was being edited.
    expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toEqual(
      'Notify on signup',
    )
  })

  it('SAVES normally once the server has confirmed the seed', async () => {
    render(<HostWorkflowsCard hostId="host-1" org={ORG} />)

    editFirstWorkflowAndSave()

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    const [, payload] = (setDoc as jest.Mock).mock.calls[0]
    // The whole definition, `trigger` included — the reason this is more than
    // a lost edit.
    expect(payload.trigger.event).toBe('formSubmission')
    expect(payload.steps).toHaveLength(1)
  })

  it('REFUSES when the workflows read failed, and says so differently', async () => {
    listener.status = 'error'
    render(<HostWorkflowsCard hostId="host-1" org={ORG} />)

    editFirstWorkflowAndSave()

    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(setDoc).not.toHaveBeenCalled()
    expect(enqueueSnackbar.mock.calls[0][0]).toEqual(
      expect.stringMatching(/could not be loaded/i),
    )
  })

  /**
   * A NEW workflow is built from blanks and goes through the quota-enforcing
   * resources API at a fresh uid, so it can overwrite nothing — and the first
   * snapshot of any listener is `fromCache: true`, so guarding it would
   * refuse a save that was never unsafe. Asserted, not assumed.
   */
  it('still creates a NEW workflow while the listener is unconfirmed', async () => {
    listener.fromCache = true
    render(<HostWorkflowsCard hostId="host-1" org={ORG} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add workflow' }))
    fireEvent.change(screen.getByLabelText(/^Name/), {
      target: { value: 'Nightly digest' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))

    await waitFor(() => expect(mockCreateResource).toHaveBeenCalledTimes(1))
    expect(setDoc).not.toHaveBeenCalled()
  })
})
