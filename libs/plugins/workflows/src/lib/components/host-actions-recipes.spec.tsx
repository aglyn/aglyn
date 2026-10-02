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
 * The Recipes menu (AGL-2626): choosing a recipe opens the editor prefilled
 * and writes nothing. "Tag by form" asks for one of this site's forms first.
 *
 * The harness is the stale-seed spec's: a closed-world listener keyed by the
 * collection's last path segment, the real read-window helpers, and the two
 * writes a save would make — the server create and the merge-set — as spies
 * this suite asserts stay silent.
 */

import { fireEvent, render, screen, within } from '@testing-library/react'
import { setDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import { STAND_IN_RECIPES, standInFormList, standInRecipes } from '../testing/stand-in-recipes'
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
  forms: [
    { $id: 'form-contact', displayName: 'Contact us' },
    // A form with lead routing on files a lead and no contact (AGL-3458).
    { $id: 'form-quote', displayName: 'Request a quote', routing: { lead: true } },
    // Archived forms collect nothing and are not offered.
    { $id: 'form-old', displayName: 'Old campaign', archivedAt: 1 },
  ],
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

const PRO = { plan: 'business' } as never
const FREE = { plan: 'free' } as never

// The recipes are the CRM's, and the forms the Forms plugin's, both reached
// through the platform's seams (AGL-3080); this plugin's specs stand them in.
beforeAll(() => {
  standInRecipes()
  standInFormList()
})

beforeEach(() => {
  jest.clearAllMocks()
})

function openRecipes() {
  fireEvent.click(screen.getByRole('button', { name: 'Recipes' }))
  return screen.getByRole('menu')
}

function chooseRecipe(title: string) {
  const menu = openRecipes()
  fireEvent.click(within(menu).getByText(title))
}

/** The editor's dialog, found by its title. */
function editor() {
  return screen.getByRole('dialog', { name: 'Add action' })
}

describe('the Recipes menu (AGL-2626)', () => {
  it('sits beside Add action and lists the four recipes with their descriptions', () => {
    render(<HostActionsCard hostId="host-1" org={PRO} />)
    expect(screen.getByRole('button', { name: 'Add action' })).toBeTruthy()
    const menu = openRecipes()
    const items = within(menu).getAllByRole('menuitem')
    expect(items).toHaveLength(STAND_IN_RECIPES.length)
    for (const recipe of STAND_IN_RECIPES) {
      expect(within(menu).getByText(recipe.title)).toBeTruthy()
      expect(within(menu).getByText(recipe.description)).toBeTruthy()
    }
  })

  it('opens the editor prefilled from the recipe and saves nothing until the person does', () => {
    render(<HostActionsCard hostId="host-1" org={PRO} />)
    chooseRecipe('Welcome a new lead')

    const dialog = editor()
    expect(
      (within(dialog).getByLabelText('Name') as HTMLInputElement).value,
    ).toBe('Welcome a new lead')
    expect(
      within(dialog).getByText(
        'Started from the “Welcome a new lead” recipe — change anything, then save.',
      ),
    ).toBeTruthy()
    // The trigger and its condition, as the recipe wrote them: a NEW LEAD a
    // form filed (AGL-3458), which is what a lead-routed form makes.
    expect(within(dialog).getByDisplayValue('lead')).toBeTruthy()
    expect(within(dialog).getByDisplayValue('notEmpty')).toBeTruthy()
    expect(
      (within(dialog).getByLabelText('Field') as HTMLInputElement).value,
    ).toBe('formId')
    // The email is a transactional reply, said on the step (AGL-3458).
    expect(
      (within(dialog).getByLabelText('Transactional reply (no unsubscribe)') as HTMLInputElement)
        .checked,
    ).toBe(true)
    // The four steps, in order, with the owner step on the rotation.
    expect(within(dialog).getByDisplayValue('roundRobin')).toBeTruthy()
    expect(
      (within(dialog).getByLabelText('Title') as HTMLInputElement).value,
    ).toBe('Call the new lead')
    expect(
      (within(dialog).getByLabelText('Subject') as HTMLInputElement).value,
    ).toBe('Thanks for getting in touch')
    expect(
      (within(dialog).getByLabelText('Tag') as HTMLInputElement).value,
    ).toBe('website')

    expect(mockCreateResource).not.toHaveBeenCalled()
    expect(setDoc).not.toHaveBeenCalled()
  })

  it('carries a step guard through to the editor — the stale-lead task runs only on the timeout branch', () => {
    render(<HostActionsCard hostId="host-1" org={PRO} />)
    chooseRecipe('Re-engage a stale lead')
    const dialog = editor()
    // Twice: the trigger, and the event the wait step watches for.
    expect(within(dialog).getAllByDisplayValue('contactStageChanged')).toHaveLength(2)
    expect(within(dialog).getByDisplayValue('_waitTimedOut')).toBeTruthy()
    expect(setDoc).not.toHaveBeenCalled()
  })

  it('asks for one of this site’s forms before building Tag by form, and skips archived ones', () => {
    render(<HostActionsCard hostId="host-1" org={PRO} />)
    chooseRecipe('Tag by form')

    const picker = screen.getByRole('dialog', { name: 'Tag by form' })
    expect(screen.queryByRole('dialog', { name: 'Add action' })).toBeNull()
    const useRecipe = within(picker).getByRole('button', { name: 'Use recipe' })
    expect((useRecipe as HTMLButtonElement).disabled).toBe(true)

    fireEvent.mouseDown(within(picker).getByRole('combobox', { name: 'Form' }))
    const listbox = screen.getByRole('listbox')
    expect(within(listbox).queryByText('Old campaign')).toBeNull()
    fireEvent.click(within(listbox).getByText('Contact us'))
    fireEvent.click(useRecipe)

    const dialog = editor()
    expect(
      (within(dialog).getByLabelText('Name') as HTMLInputElement).value,
    ).toBe('Tag Contact us submissions')
    // `formId equals …` reads back as "Form is" with the form picked by id
    // (AGL-3458), not as a field and a value to type.
    expect(within(dialog).getByDisplayValue('formIs')).toBeTruthy()
    expect(within(dialog).getByDisplayValue('form-contact')).toBeTruthy()
    expect(within(dialog).getByRole('combobox', { name: 'Form' }).textContent).toBe('Contact us')
    expect(
      (within(dialog).getByLabelText('Tag') as HTMLInputElement).value,
    ).toBe('Contact us')
    expect(mockCreateResource).not.toHaveBeenCalled()
    expect(setDoc).not.toHaveBeenCalled()
  })

  it('listens for a new lead when the form picked for Tag by form files leads (AGL-3458)', () => {
    render(<HostActionsCard hostId="host-1" org={PRO} />)
    chooseRecipe('Tag by form')

    const picker = screen.getByRole('dialog', { name: 'Tag by form' })
    fireEvent.mouseDown(within(picker).getByRole('combobox', { name: 'Form' }))
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Request a quote'))
    fireEvent.click(within(picker).getByRole('button', { name: 'Use recipe' }))

    const dialog = editor()
    expect(within(dialog).getByDisplayValue('lead')).toBeTruthy()
    expect(within(dialog).getByDisplayValue('form-quote')).toBeTruthy()
  })

  it('refuses a recipe on a plan without the builder, the way Add action does', () => {
    render(<HostActionsCard hostId="host-1" org={FREE} />)
    chooseRecipe('Follow up a won deal')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(enqueueSnackbar).toHaveBeenCalledWith(
      expect.stringContaining('requires a Pro plan'),
      expect.objectContaining({ variant: 'warning' }),
    )
  })
})
