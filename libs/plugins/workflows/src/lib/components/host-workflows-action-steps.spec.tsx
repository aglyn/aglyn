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
 * THE WORKFLOW EDITOR OFFERS THE ACTIONS STEPS (AGL-3105).
 *
 * A workflow was a trigger and a list of function calls; everything a
 * merchant wants an automation to DO lived in Actions. The engine now runs
 * either as a step of one workflow, and this is the half of that a merchant
 * can see: the same "Do" picker, the same fields, in the Workflows builder.
 *
 * What it pins is the offer and what it writes — the picker holds a function
 * call and the server-side Actions steps and NOT the ones that only a
 * visitor's browser can run, the fields a chosen step takes are the Actions
 * builder's own, and Save stores the step in the Actions shape so the engine
 * reads back what the editor wrote.
 *
 * NO PRODUCTION DATA IS READ and nothing is sent.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'

const collections: Record<string, Array<Record<string, unknown>>> = {
  workflows: [],
  functions: [{ $id: 'fn-1', name: 'score', parameters: [] }],
  variables: [],
  datasets: [{ $id: 'ds-leads', displayName: 'Leads', visibleTo: ['org'] }],
  overlays: [],
  lists: [],
  emailCampaigns: [],
  webhooks: [],
}

const FIRESTORE = {}
const mockCreateResource = jest.fn().mockResolvedValue({ id: 'wf-new' })

jest.mock('@aglyn/tenant-feature-instance', () => ({
  DUPLICATE_MENU_LABEL: 'Duplicate…',
  useDuplicateResource: () => ({ request: jest.fn(), dialog: null }),
  useFirestore: () => FIRESTORE,
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'] }),
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

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  // Every query resolves to the collection it ends at, which is the key the
  // listener stub above reads its rows from.
  collection: (_db: unknown, ...segments: string[]) =>
    segments[segments.length - 1],
  query: (name: string) => name,
  limit: () => undefined,
  where: () => undefined,
  orderBy: () => undefined,
  documentId: () => '__name__',
  doc: () => ({}),
  getCountFromServer: async () => ({ data: () => ({ count: 0 }) }),
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
jest.mock('./host-activity-card.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('@aglyn/aglyn/app-utils/where-used', () => ({
  fetchWhereUsed: jest.fn().mockResolvedValue({}),
  summarizeDependents: () => '',
}))

import HostWorkflowsCard from './host-workflows-card.component'

/** Stock `business`: entitles workflows, actions and webhooks. */
const ORG = { $id: 'org-1', plan: 'business' } as never

/** The card with its editor open on a new workflow. */
const openEditor = async () => {
  render(<HostWorkflowsCard hostId="site-1" org={ORG} />)
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Add workflow' }))
  })
}

/** The "Do" picker's options, as a merchant reads them. */
const stepKinds = async () => {
  await act(async () => {
    fireEvent.mouseDown(screen.getByLabelText('Do'))
  })
  const options = within(screen.getByRole('listbox')).getAllByRole('option')
  return options.map((option) => option.textContent)
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('the workflow step picker', () => {
  it('offers a function call and the steps a server event can run', async () => {
    await openEditor()
    const kinds = await stepKinds()

    // A call first: it is what a workflow was, and what a new step is.
    expect(kinds[0]).toBe('Call a function')
    expect(kinds).toEqual(
      expect.arrayContaining([
        'Write to a dataset',
        'Send an email',
        'Tag the contact',
        'Wait',
        'End the flow here',
      ]),
    )
  })

  it('leaves out every step only the visitor’s browser can run', async () => {
    await openEditor()
    const kinds = await stepKinds()

    // A workflow runs on a server event, where there is no page to toggle a
    // class on, open a drawer in, or redirect.
    for (const client of [
      'Add a CSS class',
      'Open a drawer',
      'Redirect the visitor',
      'Show custom HTML',
      'Track an analytics event',
    ]) {
      expect(kinds).not.toContain(client)
    }
  })
})

describe('an Actions step in a workflow', () => {
  it('takes the fields the Actions builder gives it, and saves in its shape', async () => {
    await openEditor()
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/^Name/), {
        target: { value: 'Capture a lead' },
      })
    })
    await act(async () => {
      fireEvent.mouseDown(screen.getByLabelText('Do'))
    })
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole('listbox')).getByRole('option', {
          name: 'Write to a dataset',
        }),
      )
    })

    // The Actions field, offering this site's datasets — not a second copy
    // built for workflows.
    const dataset = screen.getByLabelText('Dataset')
    await act(async () => {
      fireEvent.mouseDown(dataset)
    })
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole('listbox')).getByRole('option', {
          name: 'Leads',
        }),
      )
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    })

    expect(mockCreateResource).toHaveBeenCalledTimes(1)
    const written = mockCreateResource.mock.calls[0][0] as {
      data: { steps: Array<Record<string, unknown>> }
    }
    expect(written.data.steps).toEqual([
      expect.objectContaining({ type: 'datasetAppend', datasetId: 'ds-leads' }),
    ])
  })
})
