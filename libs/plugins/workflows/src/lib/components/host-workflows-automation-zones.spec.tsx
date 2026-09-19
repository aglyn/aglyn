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
 * What the Workflows card hosts for other plugins (AGL-2919): the
 * `automationEditor` zone in the editor of a SAVED workflow, named as it is
 * stored, and — through the run history it opens — what the history needs to
 * host `automationRun` on a failed run: the org, and that the runs are a
 * workflow's.
 */

import { ConsoleWidgetSlotContext } from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import HostWorkflowsCard from './host-workflows-card.component'

const collections: Record<string, Array<Record<string, unknown>>> = {
  workflows: [
    {
      $id: 'wf-1',
      name: 'Notify on signup',
      trigger: { event: 'formSubmission', filter: '' },
      steps: [{ functionName: 'sendEmail', args: [], resultName: 'sent' }],
      returnValue: 'sent',
    },
  ],
  functions: [],
  variables: [],
  actions: [],
}

const mockFirestore = {}
let mockRunsProps: Record<string, unknown> | null = null

jest.mock('@aglyn/tenant-feature-instance', () => ({
  DUPLICATE_MENU_LABEL: 'Duplicate…',
  useDuplicateResource: () => ({ request: jest.fn(), dialog: null }),
  useFirestore: () => mockFirestore,
  useFirestoreCollection: (build: () => unknown) => ({
    data: collections[build() as string] ?? [],
    status: 'success',
    fromCache: false,
  }),
  useHostResourceApi: () => jest.fn(async () => ({ id: 'wf-new' })),
  useUser: () => ({ data: { uid: 'uid-owner', getIdToken: jest.fn() } }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance').writeGuardedBySeed,
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) => segments[segments.length - 1],
  query: (name: string) => name,
  limit: () => undefined,
  doc: () => ({}),
  setDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
  getCountFromServer: async (name: string) => ({
    data: () => ({ count: (collections[name] ?? []).length }),
  }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({ confirm: jest.fn().mockResolvedValue(undefined) }),
}))
jest.mock('./host-activity-card.component', () => ({ __esModule: true, default: () => null }))
jest.mock('./host-run-history-card.component', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    mockRunsProps = props
    return null
  },
}))
jest.mock('@aglyn/plugins-logic', () => ({
  WhereUsedDialog: () => null,
  fetchWhereUsed: jest.fn().mockResolvedValue({}),
  summarizeDependents: () => '',
}))

const ORG = { $id: 'org-1', plan: 'business' } as never

let drawn: Array<{ slot: string; props: Record<string, unknown> }> = []

function ShellSlot({ slot, ...props }: { slot: string } & Record<string, unknown>) {
  drawn.push({ slot, props })
  return <div data-testid={`zone-${slot}`} />
}

function renderInShell() {
  return render(
    <ConsoleWidgetSlotContext.Provider value={ShellSlot}>
      <HostWorkflowsCard hostId="host-1" org={ORG} />
    </ConsoleWidgetSlotContext.Provider>,
  )
}

beforeEach(() => {
  drawn = []
  mockRunsProps = null
})

describe('the Workflows card’s automation zones (AGL-2919)', () => {
  it('draws automationEditor in the editor of a saved workflow, naming it as it is stored', async () => {
    renderInShell()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByTestId('zone-automationEditor')).toBeTruthy()
    expect([...drawn].reverse().find((entry) => entry.slot === 'automationEditor')?.props).toEqual({
      hostId: 'host-1',
      orgId: 'org-1',
      target: { type: 'workflow', id: 'wf-1', name: 'Notify on signup' },
    })
  })

  it('draws none for a workflow that is not saved yet', async () => {
    renderInShell()
    fireEvent.click(screen.getByRole('button', { name: 'Add workflow' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByTestId('zone-automationEditor')).toBeNull()
  })

  it('tells the run history it opens whose runs they are, for the zone on a failed run', () => {
    renderInShell()
    fireEvent.click(screen.getByRole('button', { name: 'Runs' }))
    expect(mockRunsProps).toEqual(
      expect.objectContaining({
        hostId: 'host-1',
        orgId: 'org-1',
        targetId: 'wf-1',
        targetType: 'workflow',
        targetName: 'Notify on signup',
      }),
    )
  })
})
