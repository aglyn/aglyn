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
 * Both logic cards read their cap from a server aggregate, not from the
 * length of a capped listener (AGL-1716, the AGL-1706 shape).
 *
 * Each listener is `limit(100)` and each array's length was handed straight
 * to `checkQuota`:
 *
 *  * `variablesPerHost` runs 3 / 25 / 100 / 1,000 / 5,000 — the window TIES
 *    Pro's 100 and hides Business and Scale entirely.
 *  * `functionsPerHost` runs 1 / 10 / 50 / 250 / 500 / 1,000 — everything
 *    from Business up sits above the window.
 *
 * On those plans the gate compared 100 against hundreds or thousands and
 * could never refuse, while `api/hosts/resources` counted the collection for
 * real and did. The card offered headroom that did not exist and then failed
 * the create — the AGL-1716 shape exactly.
 *
 * Both aggregates are UNFILTERED, matching the enforcing route's plain
 * `collection(…).count()`; its `softDeletes` branch governs only the flat
 * per-host webhook cap, so soft-deleted rows have always counted server-side
 * while these cards excluded them.
 *
 * Contracts, per card: the gate refuses over the band the window hid (red
 * before the fix), the list keeps its cap, the count is read once per mount
 * from the right collection, and an unanswered aggregate falls back to the
 * loaded rows rather than to 0 — which `checkQuota` would answer as "no
 * usage" on a site that is over its band.
 *
 * No counting RULE moves: `checkQuota` is untouched and neither number is
 * metered by `report-usage`.
 *
 * NO STRIPE PATH IS EXERCISED and no production data is read.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

/** What the server says the site actually has. */
const SERVER_VARIABLES = 2_000
const SERVER_FUNCTIONS = 300
/** What each `limit(100)` listener can ever hand back. */
const ROWS = 100

const variableDocs = Array.from({ length: ROWS }, (_, index) => ({
  $id: `var-${index}`,
  name: `variable${String(index).padStart(3, '0')}`,
  type: 'text',
  value: `value ${index}`,
  workflowId: '',
  workflowName: '',
}))
const functionDocs = Array.from({ length: ROWS }, (_, index) => ({
  $id: `fn-${index}`,
  name: `fn${String(index).padStart(3, '0')}`,
  parameters: [],
  variables: [],
  operations: [],
  returnValue: '',
}))
const collections: Record<string, Array<Record<string, unknown>>> = {
  variables: variableDocs,
  functions: functionDocs,
  workflows: [],
}

/** Mutable so a spec can choose how each aggregate resolves. */
const aggregate: { variables: number | null; functions: number | null } = {
  variables: SERVER_VARIABLES,
  functions: SERVER_FUNCTIONS,
}

/** Stable, like the real hook — `firestore` keys the head-count effect. */
const FIRESTORE = {}
const mockCreateResource = jest.fn().mockResolvedValue({ id: 'new-1' })

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useFirestoreCollection: (build: () => unknown) => ({
    data: collections[build() as string] ?? [],
    status: 'success',
    fromCache: false,
  }),
  useHostResourceApi: () => mockCreateResource,
  useUser: () => ({ data: { uid: 'uid-owner', getIdToken: jest.fn() } }),
  // The variables card always mounts `WhereUsedDialog` (closed), and the
  // dialog calls this at the top of its body regardless of `open`.
  useConsoleHostRoute: () => ({ base: null, orgSlug: null, subdomain: null }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))

const limitSpy = jest.fn((value: number) => value)
const countSpy = jest.fn(async (name: 'variables' | 'functions') => {
  if (aggregate[name] == null) {
    throw Object.assign(new Error('denied'), { code: 'permission-denied' })
  }
  return { data: () => ({ count: aggregate[name] }) } as any
})

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) =>
    segments[segments.length - 1],
  query: (name: string) => name,
  limit: (value: number) => limitSpy(value),
  doc: () => ({}),
  getCountFromServer: (name: any) => countSpy(name),
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

import HostFunctionsCard from './host-functions-card.component'
import HostVariablesCard from './host-variables-card.component'

beforeEach(() => {
  jest.clearAllMocks()
  aggregate.variables = SERVER_VARIABLES
  aggregate.functions = SERVER_FUNCTIONS
})

/**
 * The aggregate has answered AND its answer has reached state. The call
 * count lands on mount while the resolution is still a microtask, so a
 * click on that signal alone would read the fallback these cases exist to
 * leave behind.
 */
const settled = async () => {
  await waitFor(() => expect(countSpy).toHaveBeenCalled())
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('the variables cap is a server aggregate (AGL-1716)', () => {
  /** Stock `business`: `variablesPerHost: 1000`. */
  const ORG = { $id: 'org-1', plan: 'business' } as any

  it('refuses Add over the band the loaded window hid', async () => {
    render(<HostVariablesCard hostId="host-1" org={ORG} />)
    await settled()

    // 2,000 variables against Business's 1,000. Before the fix the input was
    // the window's 100, under every band from Business up, so the draft
    // dialog opened and `api/hosts/resources` refused the save afterwards.
    fireEvent.click(screen.getByText('Add variable'))

    await waitFor(() =>
      expect(
        enqueueSnackbar.mock.calls.some((call) =>
          String(call[0]).includes('Variable limit reached (1000)'),
        ),
      ).toBe(true),
    )
  })

  it('keeps the list capped and reads the count once, from variables', async () => {
    render(<HostVariablesCard hostId="host-1" org={ORG} />)
    await settled()

    // The cap was never the defect; fixing the count must not start
    // streaming 2,000 rows into this list.
    expect(limitSpy).toHaveBeenCalledWith(100)
    expect(countSpy).toHaveBeenCalledTimes(1)
    expect(countSpy).toHaveBeenCalledWith('variables')
  })

  it('falls back to the loaded rows, never to zero, when the read fails', async () => {
    aggregate.variables = null
    render(<HostVariablesCard hostId="host-1" org={ORG} />)
    await settled()

    // 100 known rows stand in — a lower bound and the card's prior
    // behaviour, under Business's 1,000, so the draft opens. A defaulted 0
    // would be the same verdict reached by a confident wrong number.
    fireEvent.click(screen.getByText('Add variable'))

    await waitFor(() => expect(screen.queryByText('Cancel')).not.toBeNull())
    expect(
      enqueueSnackbar.mock.calls.some((call) =>
        String(call[0]).includes('Variable limit reached'),
      ),
    ).toBe(false)
  })
})

describe('the functions cap is a server aggregate (AGL-1716)', () => {
  /** Stock `business`: `functionsPerHost: 250`. */
  const ORG = { $id: 'org-1', plan: 'business' } as any

  it('refuses Add over the band the loaded window hid', async () => {
    render(<HostFunctionsCard hostId="host-1" org={ORG} />)
    await settled()

    // 300 functions against Business's 250; the window's 100 hid it.
    fireEvent.click(screen.getByText('Add function'))

    await waitFor(() =>
      expect(
        enqueueSnackbar.mock.calls.some((call) =>
          String(call[0]).includes('Function limit reached (250)'),
        ),
      ).toBe(true),
    )
  })

  it('keeps the list capped and reads the count once, from functions', async () => {
    render(<HostFunctionsCard hostId="host-1" org={ORG} />)
    await settled()

    expect(limitSpy).toHaveBeenCalledWith(100)
    expect(countSpy).toHaveBeenCalledTimes(1)
    expect(countSpy).toHaveBeenCalledWith('functions')
  })

  it('falls back to the loaded rows, never to zero, when the read fails', async () => {
    aggregate.functions = null
    render(<HostFunctionsCard hostId="host-1" org={ORG} />)
    await settled()

    fireEvent.click(screen.getByText('Add function'))

    await waitFor(() => expect(screen.queryByText('Cancel')).not.toBeNull())
    expect(
      enqueueSnackbar.mock.calls.some((call) =>
        String(call[0]).includes('Function limit reached'),
      ),
    ).toBe(false)
  })
})
