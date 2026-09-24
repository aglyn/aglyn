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
 * The Actions card's Test button reaches a door the console serves (AGL-3309).
 *
 * `events/dispatch` is a tenant route, so from the console's origin the
 * button's post was answered 404 and nothing ever ran. It posts the site and
 * the action to the workflows plugin's console route instead, signed with the
 * caller's token, and shows what the route says: the first alert of a run, or
 * the words of a refusal.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ACTION_TEST_RUN_API_ROUTE } from '../model/action-test-run'
import HostActionsCard from './host-actions-card.component'

const collections: Record<string, Array<Record<string, unknown>>> = {
  actions: [
    {
      $id: 'act-scroll',
      name: 'Offer at half way',
      enabled: true,
      trigger: { event: 'scrollDepth', threshold: 50 },
      steps: [{ type: 'siteAlert', message: 'Half way there' }],
    },
    {
      $id: 'act-form',
      name: 'Welcome a lead',
      enabled: true,
      trigger: { event: 'formSubmission' },
      steps: [{ type: 'sendEmail', subject: 'Welcome', body: 'Thanks' }],
    },
  ],
}

// One held object: a double rebuilt per call is a new identity every render.
const mockFirestore = {}
let mockUser: { data: unknown }
const mockEnqueueSnackbar = jest.fn()

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => mockFirestore,
  useHostResourceApi: () => jest.fn(async () => ({ id: 'created-id' })),
  useUser: () => mockUser,
  useFirestoreCollection: (build: () => unknown) => ({
    data: collections[build() as string] ?? [],
    status: 'success',
    fromCache: false,
  }),
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'] }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
  collectionCeiling: jest.requireActual('@aglyn/tenant-feature-instance')
    .collectionCeiling,
  ceilingedWindow: jest.requireActual('@aglyn/tenant-feature-instance')
    .ceilingedWindow,
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

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({
    confirm: jest.fn().mockResolvedValue(undefined),
  }),
}))
jest.mock('./host-activity-card.component', () => ({
  __esModule: true,
  default: () => null,
}))

const ORG = { plan: 'business' } as never

/** The route's answer, as the card reads it. */
function answer(status: number, body: Record<string, unknown>) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

let fetchMock: jest.Mock
const realFetch = globalThis.fetch

beforeEach(() => {
  mockEnqueueSnackbar.mockClear()
  mockUser = {
    data: { uid: 'uid-editor', getIdToken: jest.fn(async () => 'token-editor') },
  }
  fetchMock = jest.fn(async () =>
    answer(200, {
      ok: true,
      alerts: [{ message: 'Half way there', severity: 'info' }],
    }),
  )
  globalThis.fetch = fetchMock as never
})

afterEach(() => {
  globalThis.fetch = realFetch
})

function pressTest() {
  render(<HostActionsCard hostId="host-1" org={ORG} />)
  fireEvent.click(screen.getByRole('button', { name: 'Test' }))
}

describe('the Actions card’s Test button (AGL-3309)', () => {
  it('posts the site and the action to the console’s test-run door, signed', async () => {
    pressTest()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(ACTION_TEST_RUN_API_ROUTE).toBe('automations/actions/test-run')
    expect(fetchMock).toHaveBeenCalledWith('/api/automations/actions/test-run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-editor',
      },
      body: JSON.stringify({ hostId: 'host-1', actionId: 'act-scroll' }),
    })
  })

  it('shows the first alert of the run', async () => {
    pressTest()
    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
        'Test ran — first alert: Half way there',
        { variant: 'success', persist: false },
      ),
    )
  })

  it('shows a refusal in the route’s own words', async () => {
    fetchMock.mockResolvedValueOnce(
      answer(403, { error: 'Only a site admin or editor can test an action' }),
    )
    pressTest()
    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
        'Only a site admin or editor can test an action',
        { variant: 'warning', persist: false },
      ),
    )
  })

  it('sends nothing when signed out, and says so', async () => {
    mockUser = { data: null }
    pressTest()
    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
        'You are signed out, so nothing was sent. Sign in again and retry.',
        { variant: 'warning', persist: false },
      ),
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is offered only for an action with an in-page trigger', () => {
    render(<HostActionsCard hostId="host-1" org={ORG} />)
    expect(screen.getByText('Welcome a lead')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Test' })).toHaveLength(1)
  })
})
