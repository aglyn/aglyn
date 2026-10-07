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
 * The zones the Functions & Variables page hosts for other plugins
 * (AGL-3603): `hostLogic` in each card's header, `logicFunctionEditor` in a
 * SAVED function's editor, `logicReferenceIssue` on a broken reference —
 * and `propose`, which opens a proposal in the editor UNSAVED, after the
 * plan's cap, writing nothing.
 *
 * The shell's renderer is a probe that records each zone it is asked to draw
 * and the props it is handed.
 */

import { ConsoleWidgetSlotContext } from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { setDoc, updateDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'

const collections: Record<string, Array<Record<string, unknown>>> = {
  variables: [{ $id: 'var-1', name: 'flat_rate', type: 'number', value: '6', workflowId: '', workflowName: '' }],
  functions: [
    {
      $id: 'fn-1',
      name: 'shippingQuote',
      parameters: [{ name: 'order_total', type: 'number', required: true }],
      variables: [{ name: 'quote', type: 'number' }],
      operations: [],
      returnValue: 'quote',
    },
  ],
  workflows: [],
}
let serverCount = 1

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreCollection: (build: () => unknown) => ({
    data: collections[build() as string] ?? [],
    status: 'success',
    fromCache: false,
  }),
  useHostResourceApi: () => jest.fn().mockResolvedValue({ id: 'new-1' }),
  useUser: () => ({ data: { uid: 'uid-owner', getIdToken: jest.fn() } }),
  useConsoleHostRoute: () => ({ base: null, orgSlug: null, subdomain: null }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance').writeGuardedBySeed,
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) => segments[segments.length - 1],
  query: (name: string) => name,
  limit: () => undefined,
  where: () => undefined,
  doc: () => ({}),
  getCountFromServer: async () => ({ data: () => ({ count: serverCount }) }),
  setDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
}))

const enqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({ useSnackbar: () => ({ enqueueSnackbar }) }))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children, actions }: { children: ReactNode; actions?: ReactNode }) => (
    <div>
      <div data-testid="card-header-actions">{actions}</div>
      {children}
    </div>
  ),
  MdiIcon: () => null,
  useConfirmationContext: () => ({ confirm: jest.fn().mockResolvedValue(undefined) }),
}))

import HostFunctionsCard from './host-functions-card.component'
import HostVariablesCard from './host-variables-card.component'
import type { LogicProposal } from './logic-zones'

let drawn: Array<{ slot: string; props: Record<string, unknown> }> = []
function ShellSlot({ slot, ...props }: { slot: string } & Record<string, unknown>) {
  drawn.push({ slot, props })
  return <div data-testid={`zone-${slot}`} />
}
const lastDrawn = (slot: string) => [...drawn].reverse().find((entry) => entry.slot === slot)
const inShell = (node: ReactNode) =>
  render(<ConsoleWidgetSlotContext.Provider value={ShellSlot}>{node}</ConsoleWidgetSlotContext.Provider>)

const ORG = { $id: 'org-1', plan: 'business' } as never
const FREE = { $id: 'org-1', plan: 'free' } as never

const PROPOSED: LogicProposal = {
  kind: 'function',
  functionId: null,
  definition: {
    name: 'priceWithTax',
    parameters: [{ name: 'price', type: 'number', required: true }],
    variables: [{ name: 'total', type: 'number' }],
    operations: [
      { if: { left: '1', comparator: '==', right: '1' }, then: [{ set: 'total', expression: 'price * 1.2' }], otherwise: [] },
    ],
    returnValue: 'total',
  },
}

beforeEach(() => {
  drawn = []
  serverCount = 1
  jest.clearAllMocks()
})

afterEach(() => {
  // A proposal opens in the editor; nothing is written for it.
  expect(setDoc).not.toHaveBeenCalled()
  expect(updateDoc).not.toHaveBeenCalled()
})

describe('the Functions card', () => {
  it('draws hostLogic in its header for functions, and opens a proposed function unsaved', async () => {
    inShell(<HostFunctionsCard hostId="host-1" org={ORG} />)
    const header = screen.getByTestId('card-header-actions')
    expect(within(header).getByTestId('zone-hostLogic')).toBeTruthy()
    const props = lastDrawn('hostLogic')?.props as { kind: string; propose: (proposal: LogicProposal) => boolean }
    expect(props).toEqual(expect.objectContaining({ hostId: 'host-1', orgId: 'org-1', kind: 'function' }))

    // A variable is not this card's to open.
    expect(props.propose({ kind: 'variable', variable: { name: 'a', type: 'text', value: '' } })).toBe(false)
    let opened = false
    act(() => {
      opened = props.propose(PROPOSED)
    })
    expect(opened).toBe(true)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Add Function')).toBeTruthy()
    expect(within(dialog).getByDisplayValue('priceWithTax')).toBeTruthy()
    // A new function's editor is not a saved one's: no editor zone.
    expect(within(dialog).queryByTestId('zone-logicFunctionEditor')).toBeNull()
  })

  it('draws logicFunctionEditor in a saved function’s editor, and a change replaces what the editor holds', async () => {
    inShell(<HostFunctionsCard hostId="host-1" org={ORG} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByTestId('zone-logicFunctionEditor')).toBeTruthy()
    const props = lastDrawn('logicFunctionEditor')?.props as {
      target: unknown
      propose: (proposal: LogicProposal) => boolean
    }
    expect(props.target).toEqual({ id: 'fn-1', name: 'shippingQuote' })
    act(() => {
      props.propose({ ...PROPOSED, functionId: 'fn-1', definition: { ...PROPOSED.definition, name: 'shippingQuote' } })
    })
    expect(within(dialog).getByText('Edit Function')).toBeTruthy()
    expect(screen.getByDisplayValue('price * 1.2')).toBeTruthy()
  })

  it('refuses a new proposed function over the plan’s cap, as Add function does', async () => {
    serverCount = 50
    inShell(<HostFunctionsCard hostId="host-1" org={FREE} />)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    const props = lastDrawn('hostLogic')?.props as { propose: (proposal: LogicProposal) => boolean }
    let opened = true
    act(() => {
      opened = props.propose(PROPOSED)
    })
    expect(opened).toBe(false)
    expect(enqueueSnackbar).toHaveBeenCalledWith(expect.stringMatching(/^Function limit reached/), expect.anything())
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('the Variables card', () => {
  it('draws hostLogic in its header for variables, and opens a proposed variable unsaved', async () => {
    inShell(<HostVariablesCard hostId="host-1" org={ORG} />)
    const props = lastDrawn('hostLogic')?.props as { kind: string; propose: (proposal: LogicProposal) => boolean }
    expect(props.kind).toBe('variable')
    expect(props.propose(PROPOSED)).toBe(false)
    act(() => {
      props.propose({ kind: 'variable', variable: { name: 'plan_prices', type: 'dictionary', value: '{"pro":49}' } })
    })
    const dialog = await screen.findByRole('dialog')
    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe('plan_prices')
  })
})

describe('outside the console shell', () => {
  it('draws no zone at all', () => {
    render(<HostFunctionsCard hostId="host-1" org={ORG} />)
    expect(screen.queryByTestId('zone-hostLogic')).toBeNull()
  })
})
