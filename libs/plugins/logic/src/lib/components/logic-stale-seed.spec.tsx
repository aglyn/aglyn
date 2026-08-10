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
 * The logic cards must not rewrite a variable or a function from a seed the
 * server never confirmed (AGL-1358).
 *
 * Both open an editor by copying a whole stored row out of a LISTENER and
 * write every field of it back under `merge: true`, which protects nothing —
 * the untouched fields are all in the payload.
 *
 * What that costs:
 *
 * - variables — `value` is the literal every `{{name}}` binding on every
 *   published page resolves to, and `workflowId` is what points a computed
 *   variable at its source (AGL-261). A cached seed puts a live binding back
 *   on a value, or a workflow, the author replaced.
 * - functions — the payload is the definition itself. `parameters` and
 *   `operations` are arrays, and a merge replaces an array wholesale rather
 *   than diffing it, so a stale seed restores that snapshot's entire logic
 *   body and parameter list — and every caller's arguments are positional
 *   against the list it just reverted.
 *
 * Both directions asserted at both sites. The positive control matters most:
 * these guards stand in front of the ordinary save.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { setDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import HostFunctionsCard from './host-functions-card.component'
import HostVariablesCard from './host-variables-card.component'

/** Mutable so each spec picks the listener's verdict before rendering. */
const listener = {
  fromCache: false,
  status: 'success' as 'success' | 'error',
}

const variableDocs = [
  {
    $id: 'var-1',
    // Must satisfy VARIABLE_NAME_PATTERN or the dialog's save is disabled and
    // the click is a no-op rather than a refusal.
    name: 'siteTagline',
    type: 'text',
    // The literal every {{siteTagline}} binding resolves to.
    value: 'Built for makers',
    workflowId: '',
    workflowName: '',
  },
]
const functionDocs = [
  {
    $id: 'fn-1',
    name: 'formatPrice',
    // The arrays a merge replaces wholesale.
    parameters: [{ name: 'P1', type: 'number', required: true }],
    variables: [],
    operations: [
      {
        if: { left: 'P1', comparator: '<=', right: '0' },
        then: [{ set: 'P1', expression: '0' }],
        otherwise: [],
      },
    ],
    returnValue: 'P1',
  },
]
const collections: Record<string, Array<Record<string, unknown>>> = {
  variables: variableDocs,
  functions: functionDocs,
  workflows: [],
}

/** The quota-enforcing create path, so a NEW row is distinguishable. */
const mockCreateResource = jest.fn().mockResolvedValue({ id: 'new-1' })

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
  // the card passed it, which is the one thing these specs disprove.
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
// The where-used scan reads its own sources and is not part of this shape.
jest.mock('./where-used-dialog.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../utils/fetch-where-used', () => ({
  fetchWhereUsed: jest.fn().mockResolvedValue({}),
  summarizeDependents: () => '',
}))

/** A plan that clears the per-host caps, so nothing is refused for a quota
 * reason instead of the one under test. */
const ORG = { plan: 'business' } as never

beforeEach(() => {
  jest.clearAllMocks()
  listener.fromCache = false
  listener.status = 'success'
})

describe('HostVariablesCard (AGL-1358)', () => {
  const editFirstVariableAndSave = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save variable' }))
  }

  it('REFUSES to rewrite a variable seeded from an unconfirmed read', async () => {
    listener.fromCache = true
    render(<HostVariablesCard hostId="host-1" org={ORG} />)

    editFirstVariableAndSave()

    // Settled, so this cannot pass merely by asserting too early.
    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(setDoc).not.toHaveBeenCalled()
    const [message] = enqueueSnackbar.mock.calls[0]
    expect(message).toEqual(expect.stringContaining('variable'))
    expect(message).toEqual(expect.stringMatching(/reload/i))
    // …and the dialog is still open with what was being edited.
    expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toEqual(
      'siteTagline',
    )
  })

  it('SAVES normally once the server has confirmed the seed', async () => {
    render(<HostVariablesCard hostId="host-1" org={ORG} />)

    editFirstVariableAndSave()

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    const [, payload] = (setDoc as jest.Mock).mock.calls[0]
    expect(payload.value).toBe('Built for makers')
  })

  it('REFUSES when the variables read failed, and says so differently', async () => {
    listener.status = 'error'
    render(<HostVariablesCard hostId="host-1" org={ORG} />)

    editFirstVariableAndSave()

    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(setDoc).not.toHaveBeenCalled()
    expect(enqueueSnackbar.mock.calls[0][0]).toEqual(
      expect.stringMatching(/could not be loaded/i),
    )
  })

  /**
   * A NEW variable is built from blanks and goes through the quota-enforcing
   * resources API at a fresh uid, so it can overwrite nothing — and the first
   * snapshot of any listener is `fromCache: true`, so guarding it would
   * refuse a save that was never unsafe. Asserted, not assumed.
   */
  it('still creates a NEW variable while the listener is unconfirmed', async () => {
    listener.fromCache = true
    render(<HostVariablesCard hostId="host-1" org={ORG} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add variable' }))
    fireEvent.change(screen.getByLabelText(/^Name/), {
      target: { value: 'supportEmail' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save variable' }))

    await waitFor(() => expect(mockCreateResource).toHaveBeenCalledTimes(1))
    expect(setDoc).not.toHaveBeenCalled()
  })
})

describe('HostFunctionsCard (AGL-1358)', () => {
  const editFirstFunctionAndSave = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  }

  it('REFUSES to rewrite a function seeded from an unconfirmed read', async () => {
    listener.fromCache = true
    render(<HostFunctionsCard hostId="host-1" org={ORG} />)

    editFirstFunctionAndSave()

    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(setDoc).not.toHaveBeenCalled()
    const [message] = enqueueSnackbar.mock.calls[0]
    expect(message).toEqual(expect.stringContaining('function'))
    expect(message).toEqual(expect.stringMatching(/reload/i))
    // Parameter rows reuse the `Name` label, so the function's own field is
    // the first one in the dialog.
    expect(
      (screen.getAllByLabelText(/^Name/)[0] as HTMLInputElement).value,
    ).toEqual('formatPrice')
  })

  it('SAVES normally once the server has confirmed the seed', async () => {
    render(<HostFunctionsCard hostId="host-1" org={ORG} />)

    editFirstFunctionAndSave()

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    const [, payload] = (setDoc as jest.Mock).mock.calls[0]
    // The whole definition, arrays included.
    expect(payload.parameters).toHaveLength(1)
    expect(payload.returnValue).toBe('P1')
  })

  it('still creates a NEW function while the listener is unconfirmed', async () => {
    listener.fromCache = true
    render(<HostFunctionsCard hostId="host-1" org={ORG} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add function' }))
    fireEvent.change(screen.getAllByLabelText(/^Name/)[0], {
      target: { value: 'roundUp' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))

    await waitFor(() => expect(mockCreateResource).toHaveBeenCalledTimes(1))
    expect(setDoc).not.toHaveBeenCalled()
  })
})
