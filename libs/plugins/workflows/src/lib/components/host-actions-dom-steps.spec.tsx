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
 * The in-page steps in the actions editor, as an author builds them.
 *
 * The "Do" menu is every entry of `HOST_ACTION_STEP_LABELS`, so a step added
 * to that map is offered here whether or not this editor knows how to build
 * one. A step the editor has no starting shape for turns into "Write to a
 * dataset" — the fallback the shape table ends on — and cannot be chosen at
 * all (AGL-2876). Each case below picks a step from the menu, fills its fields
 * and asserts the step that is saved.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { setDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import HostActionsCard from './host-actions-card.component'

const collections: Record<string, Array<Record<string, unknown>>> = {
  actions: [],
  workflows: [],
  overlays: [],
  datasets: [],
  lists: [],
  campaigns: [],
  webhooks: [],
  screens: [],
}

const mockCreateResource = jest.fn(async () => ({ id: 'created-id' }))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useHostResourceApi: () => mockCreateResource,
  useUser: () => ({ data: null }),
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
const TARGET = '[data-aglyn="leaf:film"]'

beforeEach(() => {
  jest.clearAllMocks()
})

function pick(label: string, option: string) {
  fireEvent.mouseDown(screen.getByLabelText(label))
  fireEvent.click(
    within(screen.getByRole('listbox')).getByRole('option', { name: option }),
  )
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

function startAction() {
  render(<HostActionsCard hostId="host-1" org={ORG} />)
  fireEvent.click(screen.getByRole('button', { name: 'Add action' }))
  type('Name', 'In-page step')
  pick('Trigger event', 'pageVisit (on page)')
}

async function savedStep() {
  fireEvent.click(screen.getByRole('button', { name: 'Save action' }))
  await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
  const payload = (setDoc as jest.Mock).mock.calls[0][1] as {
    steps: Array<Record<string, unknown>>
  }
  expect(payload.steps).toHaveLength(1)
  return payload.steps[0]
}

describe('HostActionsCard in-page steps', () => {
  it('builds "Toggle a CSS class" rather than turning it into a dataset write', async () => {
    startAction()
    pick('Do', 'Toggle a CSS class')
    type('CSS selector', '.menu')
    type('Class name', 'is-open')
    expect(await savedStep()).toEqual({
      type: 'toggleClass',
      selector: '.menu',
      className: 'is-open',
    })
  })

  it('builds "Set an ARIA or data attribute"', async () => {
    startAction()
    pick('Do', 'Set an ARIA or data attribute')
    type('CSS selector', TARGET)
    type('Attribute', 'aria-expanded')
    type('Value', 'true')
    expect(await savedStep()).toEqual({
      type: 'setAttribute',
      selector: TARGET,
      name: 'aria-expanded',
      value: 'true',
    })
  })

  it('builds "Remove an ARIA or data attribute"', async () => {
    startAction()
    pick('Do', 'Remove an ARIA or data attribute')
    type('CSS selector', TARGET)
    type('Attribute', 'aria-expanded')
    expect(screen.queryByLabelText('Value')).toBeNull()
    expect(await savedStep()).toEqual({
      type: 'removeAttribute',
      selector: TARGET,
      name: 'aria-expanded',
    })
  })

  it('builds "Scroll to element" with how and where it stops (AGL-2867)', async () => {
    startAction()
    pick('Do', 'Scroll to element')
    type('CSS selector', TARGET)
    pick('Scroll', 'Instantly')
    type('Offset (px)', '80')
    expect(await savedStep()).toEqual({
      type: 'scrollTo',
      selector: TARGET,
      behavior: 'instant',
      offsetPx: 80,
    })
  })

  it('builds "Play a video" (AGL-2867)', async () => {
    startAction()
    pick('Do', 'Play a video')
    type('CSS selector', TARGET)
    expect(await savedStep()).toEqual({ type: 'playVideo', selector: TARGET })
  })

  it('says so while the attribute is one the page will not apply', () => {
    startAction()
    pick('Do', 'Set an ARIA or data attribute')
    type('Attribute', 'onclick')
    expect(screen.getByText('Must start with aria- or data-')).toBeTruthy()
    type('Attribute', 'data-state')
    expect(screen.queryByText('Must start with aria- or data-')).toBeNull()
  })
})
