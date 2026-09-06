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
 * The recipe stamp on a saved action (AGL-2639).
 *
 * The organization-level CRM reports which sites carry a recipe by the
 * `recipe` field on the site's action documents, so the site editor has to
 * write it — and has to keep the three cases apart. An action begun from a
 * recipe saves the id; one begun blank saves `null`; and an action stored
 * before the stamp existed is saved back WITHOUT the key, because the
 * editor cannot know where it came from and a `null` would read as "no
 * recipe" to the org-level card ever after. The write is the shared stored
 * shape, so the caps and lists a recipe install writes are what an edit
 * writes too.
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
  forms: [],
}

const mockCreateResource = jest.fn(async () => ({ id: 'created-id' }))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useHostResourceApi: () => mockCreateResource,
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

/** A plan that entitles the builder, so nothing is refused for that reason. */
const ORG = { plan: 'business' } as never

/** A stored action, as the list reads one: an id, a name, a trigger, steps. */
const stored = (extra: Record<string, unknown>) => ({
  $id: 'ac-1',
  name: 'Older action',
  trigger: { event: 'formSubmission' },
  steps: [{ type: 'addContactTag', tag: 'old' }],
  ...extra,
})

beforeEach(() => {
  jest.clearAllMocks()
  collections.actions = []
})

function pick(label: string, option: string) {
  fireEvent.mouseDown(screen.getByLabelText(label))
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: option }))
}

async function save() {
  fireEvent.click(screen.getByRole('button', { name: 'Save action' }))
  await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
  return (setDoc as jest.Mock).mock.calls[0][1] as Record<string, any>
}

describe('the recipe stamp the site editor saves (AGL-2639)', () => {
  it('saves an action begun from a recipe with the recipe’s id, in the shared stored shape', async () => {
    render(<HostActionsCard hostId="host-1" org={ORG} />)
    fireEvent.click(screen.getByRole('button', { name: 'Recipes' }))
    fireEvent.click(screen.getByText('Follow up a won deal'))
    expect(
      screen.getByText('Started from the “Follow up a won deal” recipe — change anything, then save.'),
    ).toBeTruthy()

    const payload = await save()
    expect(payload.recipe).toBe('followUpWonDeal')
    expect(payload.name).toBe('Follow up a won deal')
    // The caps are written OUT, not merely omitted — the stored shape.
    expect(payload.trigger).toMatchObject({
      event: 'dealWon',
      oncePerVisitor: false,
      oncePerSession: false,
      cooldownMinutes: null,
      everyTime: false,
      condition: null,
      conditions: null,
      combinator: null,
    })
    expect(payload.enabled).toBe(true)
  })

  it('saves an action begun blank with recipe: null — a known "no recipe"', async () => {
    render(<HostActionsCard hostId="host-1" org={ORG} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add action' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Blank' } })
    pick('Do', 'Tag the contact')
    fireEvent.change(screen.getByLabelText('Tag'), { target: { value: 'vip' } })

    const payload = await save()
    expect(payload).toHaveProperty('recipe', null)
  })

  it('saves an older action back WITHOUT the key, so an edit never turns unknown into "no recipe"', async () => {
    collections.actions = [stored({})]
    render(<HostActionsCard hostId="host-1" org={ORG} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.queryByText(/Started from the/)).toBeNull()

    const payload = await save()
    expect('recipe' in payload).toBe(false)
    expect(payload.name).toBe('Older action')
  })

  it('keeps the stamp on a stored action through an edit, and says which recipe it was', async () => {
    collections.actions = [stored({ name: 'Welcome a new lead', recipe: 'welcomeNewLead' })]
    render(<HostActionsCard hostId="host-1" org={ORG} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(
      screen.getByText('Started from the “Welcome a new lead” recipe — change anything, then save.'),
    ).toBeTruthy()

    const payload = await save()
    expect(payload.recipe).toBe('welcomeNewLead')
  })
})
