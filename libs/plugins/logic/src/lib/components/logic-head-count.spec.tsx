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
  // A server aggregate is a NETWORK round-trip: its answer cannot land in
  // the same drain as the mount that asked for it. Resolving it there was
  // the fixture's own fiction, and it is what let a settle helper that
  // flushed a fixed number of microtasks look correct (AGL-1756/1758/1759).
  //
  // TWO macrotasks, not one, and the difference is measured rather than
  // guessed: `await act(async () => …)` resolves through React's
  // `enqueueTask` (`setImmediate`, else a `MessageChannel`), so the old
  // helper's own settle already yielded to the task queue once for free.
  // Two is the first schedule it cannot beat, and still orders of magnitude
  // cheaper than any real `getCountFromServer`. Any tick-counting settle now
  // fails deterministically instead of only under a loaded worker.
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
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
 * The aggregate for `name` has ANSWERED — settled either way, and its
 * answer has reached a render.
 *
 * This replaces a helper that waited for `countSpy` to have been CALLED and
 * then flushed a fixed two microtasks, assuming the answer had arrived
 * (AGL-1759, the byte-identical helper AGL-1756/AGL-1758 removed from the
 * two commerce specs). On any promise chain longer than those two ticks it
 * returned early, the click read the `limit(100)` window — under Business's
 * 1,000 variables and 250 functions, so nothing was refused — and the
 * trailing `waitFor` spent RTL's 1,000ms default, NOT this file's jest
 * budget, before reporting a value mismatch that reads as a timeout.
 *
 * A tick budget cannot be made large enough, only large enough for today's
 * promise chain, so the condition replaces it rather than widening it.
 *
 * NEITHER earlier remedy transfers here, and both were checked first.
 * AGL-1758's is a `waitFor` on a rendered caption: these two cards render
 * no consequence of the count at all — `variableCount` and `functionCount`
 * reach nothing but `checkQuota`, and `quota.limit` appears only inside the
 * refusal snackbar. AGL-1756's is a wrapping mock over `checkQuota`, waited
 * on for the number it was computed FROM: that card calls it in a `useMemo`
 * during render, while these two call it inside the click handler, so there
 * is nothing to observe until after the click that the count was supposed
 * to have settled before.
 *
 * So the condition is the card's OWN promise. Awaiting it is not a tick
 * count at any remove: reactions run in registration order, the card
 * registered its `.then` on mount and this registers later, so its
 * `setServerCount` has already been called when this resumes — and `act`'s
 * exit yields a macrotask and flushes the work loop, which renders it.
 *
 * It subsumes AGL-1756's separate `readRejected()`: a denied read is
 * settled too, and awaiting it is the only way to tell "the read failed and
 * the rows stood in" from "the read has not answered yet", since the
 * fallback is also the value the FIRST render used.
 */
const countAnswered = async (name: 'variables' | 'functions') => {
  await waitFor(() => expect(countSpy).toHaveBeenCalledWith(name))
  await act(async () => {
    const index = countSpy.mock.calls.findIndex(([called]) => called === name)
    await countSpy.mock.results[index].value.catch(() => undefined)
  })
}

describe('the variables cap is a server aggregate (AGL-1716)', () => {
  /** Stock `business`: `variablesPerHost: 1000`. */
  const ORG = { $id: 'org-1', plan: 'business' } as any

  it('refuses Add over the band the loaded window hid', async () => {
    render(<HostVariablesCard hostId="host-1" org={ORG} />)
    await countAnswered('variables')

    // 2,000 variables against Business's 1,000. Before the fix the input was
    // the window's 100, under every band from Business up, so the draft
    // dialog opened and `api/hosts/resources` refused the save afterwards.
    fireEvent.click(screen.getByText('Add variable'))

    // Asserted directly, not inside a `waitFor`: the handler enqueues before
    // it awaits anything, so there is nothing here to wait FOR. A budget
    // around a synchronous assertion only decides how long a real failure
    // takes to report.
    expect(
      enqueueSnackbar.mock.calls.some((call) =>
        String(call[0]).includes('Variable limit reached (1000)'),
      ),
    ).toBe(true)
  })

  it('keeps the list capped and reads the count once, from variables', async () => {
    render(<HostVariablesCard hostId="host-1" org={ORG} />)
    await countAnswered('variables')

    // The cap was never the defect; fixing the count must not start
    // streaming 2,000 rows into this list.
    expect(limitSpy).toHaveBeenCalledWith(100)
    expect(countSpy).toHaveBeenCalledTimes(1)
    expect(countSpy).toHaveBeenCalledWith('variables')
  })

  it('falls back to the loaded rows, never to zero, when the read fails', async () => {
    aggregate.variables = null
    // Awaiting the card's own promise is what makes this case non-vacuous:
    // its fallback of 100 is also the value the FIRST render used, so any
    // condition that did not await the read itself would be satisfied
    // BEFORE the read had failed — passing while proving nothing.
    render(<HostVariablesCard hostId="host-1" org={ORG} />)
    await countAnswered('variables')

    // 100 known rows stand in — a lower bound and the card's prior
    // behaviour, under Business's 1,000, so the draft opens. A defaulted 0
    // would be the same verdict reached by a confident wrong number.
    fireEvent.click(screen.getByText('Add variable'))

    expect(screen.queryByText('Cancel')).not.toBeNull()
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
    await countAnswered('functions')

    // 300 functions against Business's 250; the window's 100 hid it.
    fireEvent.click(screen.getByText('Add function'))

    // Direct, for the same reason as the variables case above.
    expect(
      enqueueSnackbar.mock.calls.some((call) =>
        String(call[0]).includes('Function limit reached (250)'),
      ),
    ).toBe(true)
  })

  it('keeps the list capped and reads the count once, from functions', async () => {
    render(<HostFunctionsCard hostId="host-1" org={ORG} />)
    await countAnswered('functions')

    expect(limitSpy).toHaveBeenCalledWith(100)
    expect(countSpy).toHaveBeenCalledTimes(1)
    expect(countSpy).toHaveBeenCalledWith('functions')
  })

  it('falls back to the loaded rows, never to zero, when the read fails', async () => {
    aggregate.functions = null
    // Same shape as the variables denial: only awaiting the read itself
    // tells "it failed and the rows stood in" from "it has not answered".
    render(<HostFunctionsCard hostId="host-1" org={ORG} />)
    await countAnswered('functions')

    fireEvent.click(screen.getByText('Add function'))

    expect(screen.queryByText('Cancel')).not.toBeNull()
    expect(
      enqueueSnackbar.mock.calls.some((call) =>
        String(call[0]).includes('Function limit reached'),
      ),
    ).toBe(false)
  })
})
