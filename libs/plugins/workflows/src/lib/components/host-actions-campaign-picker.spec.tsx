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
 * The "Assign to a campaign" picker offers the campaigns the step runs
 * against (AGL-3052).
 *
 * The executor resolves an assign step's `campaignId` in the org's
 * `emailCampaigns`, the campaign containers. `campaigns` beside them holds
 * the individual email sends, and a send's id names no container, so a step
 * saved with one fails every run with "unknown campaign". Both collections are seeded here with different
 * rows, so a picker reading the wrong one offers the wrong names and saves the
 * wrong id.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { setDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import HostActionsCard from './host-actions-card.component'

const collections: Record<string, Array<Record<string, unknown>>> = {
  actions: [],
  // A campaign container: what an assign step names.
  emailCampaigns: [{ $id: 'container-spring', name: 'Spring push' }],
  // An email send inside a campaign: what no step names.
  campaigns: [{ $id: 'send-4', name: 'Newsletter #4' }],
}

// One held object: a double rebuilt per call is a new identity every render.
const mockFirestore = {}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => mockFirestore,
  useHostResourceApi: () => jest.fn(async () => ({ id: 'created-id' })),
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
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
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

function open(label: string) {
  fireEvent.mouseDown(screen.getByLabelText(label))
  return screen.getByRole('listbox')
}

function pick(label: string, option: string) {
  fireEvent.click(within(open(label)).getByRole('option', { name: option }))
}

describe('the Assign to a campaign picker (AGL-3052)', () => {
  it('offers the campaign containers and saves the id the executor resolves', async () => {
    render(<HostActionsCard hostId="host-1" org={ORG} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add action' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'File the spring signups' } })
    pick('Do', 'Assign to a campaign')

    const options = open('Campaign')
    expect(within(options).getByRole('option', { name: 'Spring push' })).toBeTruthy()
    expect(within(options).queryByRole('option', { name: 'Newsletter #4' })).toBeNull()
    fireEvent.click(within(options).getByRole('option', { name: 'Spring push' }))

    fireEvent.click(screen.getByRole('button', { name: 'Save action' }))
    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    const payload = (setDoc as jest.Mock).mock.calls[0][1] as { steps: Array<Record<string, unknown>> }
    expect(payload.steps[0]).toMatchObject({
      type: 'assignCampaign',
      campaignId: 'container-spring',
      campaignName: 'Spring push',
    })
  })
})
