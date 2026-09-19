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
 * What the Actions card hosts for other plugins, and how it treats a drafted
 * automation's placeholders (AGL-2919).
 *
 *  - THE ZONES: `hostAutomations` beside Add action and Recipes, with the
 *    `openAction` door that opens a listed action in the editor, and
 *    `automationEditor` inside the editor of a SAVED action — both drawn
 *    through the renderer the shell hands down, and neither without it.
 *  - THE PLACEHOLDERS: a stored automation that still holds one says so on
 *    its row, highlights the field in the editor, and asks before it is
 *    switched on, naming what is missing.
 *
 * The shell's renderer is a probe that records each zone it is asked to draw
 * and the props it is handed, so what is asserted is the card's half of the
 * contract; the gates behind the real renderer are the console's own spec.
 */

import { ConsoleWidgetSlotContext } from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { updateDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import HostActionsCard from './host-actions-card.component'

const collections: Record<string, Array<Record<string, unknown>>> = {
  actions: [
    {
      $id: 'act-welcome',
      name: 'Welcome new leads',
      trigger: { event: 'contactCreated' },
      steps: [{ type: 'addContactTag', tag: 'website' }],
      enabled: true,
    },
    {
      $id: 'act-draft',
      name: 'Welcome newsletter sign-ups',
      trigger: { event: 'formSubmission' },
      steps: [{ type: 'enrollList', listName: '[newsletter]' }],
      enabled: false,
    },
  ],
  lists: [{ $id: 'list-vip', name: 'VIP' }],
}

// One held object: a double rebuilt per call is a new identity every render.
const mockFirestore = {}
const mockConfirm = jest.fn()

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => mockFirestore,
  useHostResourceApi: () => jest.fn(async () => ({ id: 'created-id' })),
  useFirestoreCollection: (build: () => unknown) => ({
    data: collections[build() as string] ?? [],
    status: 'success',
    fromCache: false,
  }),
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'] }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance').writeGuardedBySeed,
  collectionCeiling: jest.requireActual('@aglyn/tenant-feature-instance').collectionCeiling,
  ceilingedWindow: jest.requireActual('@aglyn/tenant-feature-instance').ceilingedWindow,
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) => segments[segments.length - 1],
  query: (name: string) => name,
  where: () => undefined,
  limit: () => undefined,
  orderBy: () => undefined,
  documentId: () => undefined,
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
  setDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({ confirm: mockConfirm }),
}))
jest.mock('./host-run-history-card.component', () => ({
  __esModule: true,
  default: () => null,
}))

const ORG = { $id: 'org-1', plan: 'business' } as never

/** Every zone the card asked the shell to draw, with what it handed. */
let drawn: Array<{ slot: string; props: Record<string, unknown> }> = []

function ShellSlot({ slot, ...props }: { slot: string } & Record<string, unknown>) {
  drawn.push({ slot, props })
  return <div data-testid={`zone-${slot}`} />
}

const lastDrawn = (slot: string) => [...drawn].reverse().find((entry) => entry.slot === slot)

function renderInShell() {
  return render(
    <ConsoleWidgetSlotContext.Provider value={ShellSlot}>
      <HostActionsCard hostId="host-1" org={ORG} />
    </ConsoleWidgetSlotContext.Provider>,
  )
}

/** The row of a listed action, found by its name: the name sits in the row's middle column. */
function rowOf(name: string): HTMLElement {
  return screen.getByText(name).parentElement?.parentElement as HTMLElement
}

beforeEach(() => {
  drawn = []
  jest.clearAllMocks()
})

describe('the zones the Actions card hosts (AGL-2919)', () => {
  it('draws hostAutomations beside Add action and Recipes, with the site, the org and openAction', () => {
    renderInShell()
    const zone = screen.getByTestId('zone-hostAutomations')
    // In the same row as the card's own ways to start an automation.
    const row = zone.parentElement as HTMLElement
    expect(within(row).getByRole('button', { name: 'Add action' })).toBeTruthy()
    expect(within(row).getByRole('button', { name: 'Recipes' })).toBeTruthy()
    expect(lastDrawn('hostAutomations')?.props).toEqual({
      hostId: 'host-1',
      orgId: 'org-1',
      openAction: expect.any(Function),
    })
  })

  it('keeps one openAction across renders, so a widget holding it is not handed a new door each time', () => {
    renderInShell()
    const first = lastDrawn('hostAutomations')?.props['openAction']
    fireEvent.click(screen.getByRole('button', { name: 'Recipes' }))
    expect(lastDrawn('hostAutomations')?.props['openAction']).toBe(first)
  })

  it('opens a listed action in the editor through openAction, and answers false for one the list has not read', async () => {
    renderInShell()
    const openAction = lastDrawn('hostAutomations')?.props['openAction'] as (id: string) => boolean
    let opened = true
    act(() => {
      opened = openAction('act-unknown')
    })
    expect(opened).toBe(false)
    expect(screen.queryByRole('dialog')).toBeNull()

    act(() => {
      opened = openAction('act-draft')
    })
    expect(opened).toBe(true)
    const dialog = await screen.findByRole('dialog', { name: 'Edit action' })
    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe(
      'Welcome newsletter sign-ups',
    )
  })

  it('draws automationEditor in the editor of a saved action, naming it as it is stored', async () => {
    renderInShell()
    fireEvent.click(within(rowOf('Welcome new leads')).getByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit action' })
    expect(within(dialog).getByTestId('zone-automationEditor')).toBeTruthy()
    expect(lastDrawn('automationEditor')?.props).toEqual({
      hostId: 'host-1',
      orgId: 'org-1',
      target: { type: 'action', id: 'act-welcome', name: 'Welcome new leads' },
    })
    // A rename being typed is not a different automation.
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Renamed' } })
    expect(lastDrawn('automationEditor')?.props['target']).toEqual({
      type: 'action',
      id: 'act-welcome',
      name: 'Welcome new leads',
    })
  })

  it('draws no automationEditor for an action that is not saved yet', async () => {
    renderInShell()
    fireEvent.click(screen.getByRole('button', { name: 'Add action' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add action' })
    expect(within(dialog).queryByTestId('zone-automationEditor')).toBeNull()
  })

  it('draws no zone at all outside the console shell', () => {
    render(<HostActionsCard hostId="host-1" org={ORG} />)
    expect(screen.queryByTestId('zone-hostAutomations')).toBeNull()
    expect(screen.getByRole('button', { name: 'Add action' })).toBeTruthy()
  })
})

describe('a drafted automation’s placeholders (AGL-2919)', () => {
  it('says on the row how many are left to fill in, and nothing on a row that has none', () => {
    renderInShell()
    expect(within(rowOf('Welcome newsletter sign-ups')).getByText('1 placeholder to fill in')).toBeTruthy()
    expect(within(rowOf('Welcome new leads')).queryByText(/placeholder/)).toBeNull()
  })

  it('highlights the picker whose record the draft could not name, and a pick clears it', async () => {
    renderInShell()
    fireEvent.click(within(rowOf('Welcome newsletter sign-ups')).getByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit action' })
    expect(within(dialog).getByText('Pick the list — the draft asked for “newsletter”')).toBeTruthy()

    fireEvent.mouseDown(within(dialog).getByLabelText('List'))
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'VIP' }))
    await waitFor(() =>
      expect(within(dialog).queryByText('Pick the list — the draft asked for “newsletter”')).toBeNull(),
    )
  })

  it('asks before switching it on, naming what is missing, and writes nothing when the person backs out', async () => {
    mockConfirm.mockRejectedValueOnce(new Error('cancelled'))
    renderInShell()
    const toggle = rowOf('Welcome newsletter sign-ups').querySelector('input[type="checkbox"]') as HTMLInputElement
    fireEvent.click(toggle)
    await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1))
    expect(mockConfirm.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        title: 'Switch on with placeholders?',
        description: expect.stringContaining('Step 1: the list (“newsletter”)'),
      }),
    )
    await act(async () => undefined)
    expect(updateDoc).not.toHaveBeenCalled()
  })

  it('switches it on once the person confirms', async () => {
    mockConfirm.mockResolvedValueOnce(undefined)
    renderInShell()
    const toggle = rowOf('Welcome newsletter sign-ups').querySelector('input[type="checkbox"]') as HTMLInputElement
    fireEvent.click(toggle)
    await waitFor(() =>
      expect(updateDoc).toHaveBeenCalledWith('hosts/host-1/actions/act-draft', { enabled: true }),
    )
  })

  it('asks nothing to switch on an automation with no placeholder, or to switch any off', async () => {
    renderInShell()
    fireEvent.click(rowOf('Welcome new leads').querySelector('input[type="checkbox"]') as HTMLInputElement)
    await waitFor(() =>
      expect(updateDoc).toHaveBeenCalledWith('hosts/host-1/actions/act-welcome', { enabled: false }),
    )
    expect(mockConfirm).not.toHaveBeenCalled()
  })
})
