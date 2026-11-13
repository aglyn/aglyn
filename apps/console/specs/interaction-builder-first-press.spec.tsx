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
 * Saving a stored interaction is never refused on its first press just
 * because the server is late (AGL-4047).
 *
 * The dialog writes the WHOLE action, seeded from the actions listener, so the
 * write is guarded by that read. While it is the cache's, Save is held with
 * the reason beside it; what was typed is kept as edits, and a field left
 * alone follows the action as the server confirms it. It used to copy every
 * field from the first snapshot on mount, so the save carried the cache's
 * copy of the fields nobody touched.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockSetDoc = jest.fn().mockResolvedValue(undefined)
const mockEnqueueSnackbar = jest.fn()

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useHostResourceApi: () => jest.fn(),
  useOrgPlan: () => ({ org: { plan: 'business' }, ready: true }),
  // The REAL guard: a stub would let the write through whatever was passed.
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))
jest.mock('../hooks/use-firestore-collection', () => ({
  __esModule: true,
  default: () => ({ data: [] }),
}))
jest.mock('firebase/firestore', () => ({
  collection: () => ({}),
  query: () => ({}),
  limit: () => undefined,
  doc: () => ({}),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({ HelpTip: () => null }))
jest.mock('@aglyn/besigner', () => ({
  pick: {
    isPicking: () => false,
    getHint: () => null,
    startPick: jest.fn(),
    cancelPick: jest.fn(),
    nodeElementLabel: (id: string) => id,
  },
}))
jest.mock('@aglyn/besigner-ui', () => ({
  nodeElementSelector: (id: string) => `[data-aglyn="leaf:${id}"]`,
}))
jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  canvas: { toJSON: () => ({ nodes: {} }) },
  components: { getSchema: () => undefined },
}))

const { InteractionBuilderDialog } = require('../components/interaction-builder-dialog.component') as {
  InteractionBuilderDialog: (props: Record<string, unknown>) => ReactNode
}

const NODE = 'cta-1'
const stored = {
  name: 'Open the menu',
  trigger: { event: 'elementClick', selector: `[data-aglyn="leaf:${NODE}"]`, everyTime: true },
  steps: [{ type: 'toggleClass', selector: `[data-aglyn="leaf:${NODE}"]`, className: 'open' }],
  enabled: true,
}

const dialog = (existing: unknown, existingFromCache: boolean) => (
  <InteractionBuilderDialog
    hostId="host-1"
    state={{ id: 'action-1', nodeId: NODE, event: 'elementClick' }}
    existing={existing}
    existingFromCache={existingFromCache}
    existingListen={null}
    onClose={jest.fn()}
  />
)

const saveButton = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement

beforeEach(() => jest.clearAllMocks())

describe('a stored interaction while its read is unconfirmed (AGL-4047)', () => {
  it('keeps a Save pressed during the hold, with the reason beside it, and the typed name', async () => {
    render(dialog(stored, true))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Open the drawer' } })
    fireEvent.click(saveButton())
    await new Promise((resolve) => setTimeout(resolve, 20))

    // Kept, not dropped (AGL-4047): the press says Saving… while it waits.
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeTruthy()
    expect(screen.getByText('Checking your interaction with the server…')).toBeTruthy()
    expect(mockSetDoc).not.toHaveBeenCalled()
    expect(mockEnqueueSnackbar).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Open the drawer')
  })

  it('keeps the typed name through the server’s copy, and saves its steps on the first press', async () => {
    const { rerender } = render(dialog(stored, true))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Open the drawer' } })

    // The server answers: the step was changed elsewhere since the cached
    // snapshot.
    const confirmed = {
      ...stored,
      steps: [{ type: 'toggleClass', selector: stored.steps[0].selector, className: 'is-open' }],
    }
    rerender(dialog(confirmed, false))

    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Open the drawer')
    expect(screen.queryByText('Checking your interaction with the server…')).toBeNull()
    fireEvent.click(saveButton())
    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1))
    const [, payload] = mockSetDoc.mock.calls[0]
    expect(payload.name).toBe('Open the drawer')
    // Not the cache's 'open'.
    expect(payload.steps[0].className).toBe('is-open')
  })

  it('does not hold a node-scoped interaction, which has no read to wait on', () => {
    render(
      <InteractionBuilderDialog
        hostId="host-1"
        state={{ id: 'node:cta-1:i1', nodeId: NODE, event: 'elementClick' }}
        existing={stored}
        existingFromCache={true}
        onSave={jest.fn().mockResolvedValue(true)}
        onClose={jest.fn()}
      />,
    )
    expect(saveButton().disabled).toBe(false)
    expect(screen.queryByText('Checking your interaction with the server…')).toBeNull()
  })
})
