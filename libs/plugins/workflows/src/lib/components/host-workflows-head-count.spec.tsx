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
 * The workflows card reads its cap from a server aggregate, not from the
 * length of a capped listener (AGL-1716, the AGL-1706 shape).
 *
 * The listener is `limit(100)` and `workflows.length` fed
 * `checkQuota(org, 'workflowsPerHost', …)`, whose bands are 0 / 3 / 25 / 100
 * / 250 / 500. The window TIES Business's 100 and hides Scale's 250 and
 * Advanced's 500, so on those plans the gate compared 100 against hundreds
 * and could never refuse — while `api/hosts/resources` counted the
 * collection for real and did. The card offered headroom that did not exist
 * and then failed the create.
 *
 * The aggregate is UNFILTERED, matching that route's plain
 * `collection('workflows').count()`; its `softDeletes` branch governs only
 * the flat per-host webhook cap, so soft-deleted workflows have always
 * counted server-side while this card excluded them.
 *
 * Contracts: the gate refuses over the band the window hid (red before the
 * fix), the list keeps its cap, the count is read once per mount from the
 * workflows collection, and an unanswered aggregate falls back to the loaded
 * rows rather than to 0 — which `checkQuota` would answer as "no usage" on a
 * site that is over its band.
 *
 * No counting RULE moves: `checkQuota` is untouched and this number is not
 * metered by `report-usage`.
 *
 * NO STRIPE PATH IS EXERCISED and no production data is read.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

/** What the server says the site actually has. */
const SERVER_WORKFLOWS = 400
/** What the `limit(100)` listener can ever hand back. */
const ROWS = 100

const workflowDocs = Array.from({ length: ROWS }, (_, index) => ({
  $id: `wf-${index}`,
  name: `Workflow ${String(index).padStart(3, '0')}`,
  trigger: null,
  steps: [],
  returnValue: '',
}))
const collections: Record<string, Array<Record<string, unknown>>> = {
  workflows: workflowDocs,
  functions: [],
  variables: [],
  actions: [],
}

/** Mutable so a spec can choose how the aggregate resolves. */
const aggregate: { count: number | null } = { count: SERVER_WORKFLOWS }

/** Stable, like the real hook — `firestore` keys the head-count effect. */
const FIRESTORE = {}
const mockCreateResource = jest.fn().mockResolvedValue({ id: 'wf-new' })

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useFirestoreCollection: (build: () => unknown) => ({
    data: collections[build() as string] ?? [],
    status: 'success',
    fromCache: false,
  }),
  useHostResourceApi: () => mockCreateResource,
  useUser: () => ({ data: { uid: 'uid-owner', getIdToken: jest.fn() } }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))

const limitSpy = jest.fn((value: number) => value)
const countSpy = jest.fn(async (name: string) => {
  if (aggregate.count == null) {
    throw Object.assign(new Error('denied'), { code: 'permission-denied' })
  }
  return { data: () => ({ count: aggregate.count }), name } as any
})

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) =>
    segments[segments.length - 1],
  query: (name: string) => name,
  limit: (value: number) => limitSpy(value),
  doc: () => ({}),
  getCountFromServer: (name: string) => countSpy(name),
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

import HostWorkflowsCard from './host-workflows-card.component'

/** Stock `scale`: entitles workflows, `workflowsPerHost: 250`. */
const ORG = { $id: 'org-1', plan: 'scale' } as never

beforeEach(() => {
  jest.clearAllMocks()
  aggregate.count = SERVER_WORKFLOWS
})

/**
 * The aggregate has answered AND its answer has reached state. The call
 * count lands on mount while the resolution is still a microtask, so a
 * click on that signal alone would read the fallback this suite exists to
 * leave behind.
 */
const settled = async () => {
  await waitFor(() => expect(countSpy).toHaveBeenCalled())
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('the workflows cap is a server aggregate (AGL-1716)', () => {
  it('refuses Add over the band the loaded window hid', async () => {
    render(<HostWorkflowsCard hostId="host-1" org={ORG} />)
    await settled()

    // 400 workflows against Scale's 250. Before the fix the input was the
    // window's 100, under every band from Business up, so the draft opened
    // and `api/hosts/resources` refused the save afterwards.
    fireEvent.click(screen.getByText('Add workflow'))

    await waitFor(() =>
      expect(
        enqueueSnackbar.mock.calls.some((call) =>
          String(call[0]).includes('Workflow limit reached (250)'),
        ),
      ).toBe(true),
    )
  })

  it('keeps the list capped and reads the count once, from workflows', async () => {
    render(<HostWorkflowsCard hostId="host-1" org={ORG} />)
    await settled()

    // The cap was never the defect; fixing the count must not start
    // streaming 400 rows into this list.
    expect(limitSpy).toHaveBeenCalledWith(100)
    expect(countSpy).toHaveBeenCalledTimes(1)
    expect(countSpy).toHaveBeenCalledWith('workflows')
  })

  it('falls back to the loaded rows, never to zero, when the read fails', async () => {
    aggregate.count = null
    render(<HostWorkflowsCard hostId="host-1" org={ORG} />)
    await settled()

    // 100 known rows stand in — a lower bound and the card's prior
    // behaviour, under Scale's 250, so the draft opens. A defaulted 0 would
    // reach the same verdict by way of a confident wrong number.
    fireEvent.click(screen.getByText('Add workflow'))

    await waitFor(() => expect(screen.queryByText('Cancel')).not.toBeNull())
    expect(
      enqueueSnackbar.mock.calls.some((call) =>
        String(call[0]).includes('Workflow limit reached'),
      ),
    ).toBe(false)
  })
})
