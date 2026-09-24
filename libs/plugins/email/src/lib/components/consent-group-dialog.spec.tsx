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
 *
 * @jest-environment jsdom
 */

/**
 * Declaring, changing and dissolving a consent group (AGL-3320), against the
 * route as the dialog sees it: the edit step shows what signup forms will say
 * exactly as they will say it and marks every site another group already
 * holds; the review is asked for with the WHOLE next declaration and the one
 * the dialog opened against; a refusal lands on the field it is about; a
 * change somebody else made first is reloaded, not overwritten; and a group
 * left with one site becomes the dissolve.
 */

import {
  consentGroupDisclosure,
  consentGroupForHost,
} from '@aglyn/aglyn/app-utils/consent-groups'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'uid-1' } }),
}))

/** What the route answers, by action; every call is recorded. */
let mockAnswers: Record<string, { status: number; body: unknown }> = {}
const mockAuthorizedFetch = jest.fn(async (_user: unknown, _url: string, init: RequestInit) => {
  const action = JSON.parse(String(init.body)).action as string
  const answer = mockAnswers[action] ?? { status: 500, body: {} }
  return {
    ok: answer.status >= 200 && answer.status < 300,
    status: answer.status,
    json: async () => answer.body,
  }
})
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: [unknown, string, RequestInit]) => mockAuthorizedFetch(...args),
}))

import ConsentGroupDialog, { type ConsentGroupDialogMode } from './consent-group-dialog'

const ORG = {
  consentGroups: {
    g_acme: { name: 'Acme', hostIds: ['acme-a', 'acme-b', 'acme-c'] },
    g_home: { name: 'Home goods', hostIds: ['shop', 'blog'] },
  },
}
const SITES = [
  { id: 'shop', name: 'Shop', subdomain: 'shop' },
  { id: 'blog', name: 'Blog', subdomain: 'blog' },
  { id: 'deals', name: 'Deals', subdomain: 'deals' },
  { id: 'camp', name: 'Camp', subdomain: 'camp' },
  { id: 'acme-a', name: 'Acme East', subdomain: 'acme-a' },
  { id: 'acme-b', name: 'Acme West', subdomain: 'acme-b' },
  { id: 'acme-c', name: 'Acme North', subdomain: 'acme-c' },
]
const PREVIEW = {
  ok: true,
  preview: {
    before: {},
    after: {},
    discarded: [],
    lines: [],
    disclosures: [],
    carries: [],
    inherited: [{ hostId: 'camp', refusals: 4 }],
    pendingHolds: [],
    partialAccessMembers: 0,
    forwardPolicyWarning: null,
    participants: [],
    capturesDisclosing: ['form'],
    estimate: 'under-a-minute',
  },
}

const onApplied = jest.fn()
const onClose = jest.fn()

function renderDialog(
  mode: ConsentGroupDialogMode,
  groupId: string | null = null,
  org: Record<string, unknown> = ORG,
) {
  return render(
    <ConsentGroupDialog
      open
      mode={mode}
      groupId={groupId}
      org={org}
      orgId="org-1"
      sites={SITES}
      onClose={onClose}
      onApplied={onApplied}
    />,
  )
}

/** The body of the `n`th call to the route, parsed. */
const posted = (n: number) => JSON.parse(String(mockAuthorizedFetch.mock.calls[n][2].body))

const nameField = () => screen.getByRole('textbox', { name: /Name/ })
/**
 * Resolves once the preview has answered. The review's button is drawn — and
 * disabled — while the preview is still being counted, so waiting for the
 * button alone would act on a review that has nothing in it yet.
 */
const reviewed = () =>
  screen.findByText('You can leave this page; it finishes on its own.')
const tick = (site: string) => fireEvent.click(screen.getByRole('checkbox', { name: site }))

beforeEach(() => {
  jest.clearAllMocks()
  mockAnswers = {
    preview: { status: 200, body: PREVIEW },
    apply: { status: 200, body: { ok: true, changeId: 'chg_1', phase: 'carry', done: false } },
  }
})

describe('the edit step', () => {
  it('shows what signup forms will say, exactly as the forms will say it', () => {
    renderDialog('create')
    expect(screen.getByTestId('consent-group-disclosure').textContent).toBe(
      'Choose a name and at least two sites to see it.',
    )
    fireEvent.change(nameField(), { target: { value: 'Outdoors' } })
    tick('Camp')
    tick('Deals')
    const declared = {
      consentGroups: { g_new: { name: 'Outdoors', hostIds: ['camp', 'deals'] } },
    }
    expect(screen.getByTestId('consent-group-disclosure').textContent).toBe(
      consentGroupDisclosure(consentGroupForHost(declared, 'camp')),
    )
  })

  it('marks a site another group holds, and says that ticking it moves it', () => {
    renderDialog('create')
    expect(screen.getAllByText('In Acme')).toHaveLength(3)
    expect(screen.getAllByText('In Home goods')).toHaveLength(2)
    tick('Acme East')
    expect(screen.getByText('Moves from Acme')).toBeTruthy()
    expect(screen.getAllByText('In Acme')).toHaveLength(2)
  })

  it('carries no badge on the edited group’s own sites', () => {
    renderDialog('edit', 'g_home')
    expect(screen.queryByText('In Home goods')).toBeNull()
    expect((screen.getByRole('checkbox', { name: 'Shop' }) as HTMLInputElement).checked).toBe(true)
  })

  it('checks the name beside the field before asking the route', () => {
    renderDialog('create')
    fireEvent.change(nameField(), { target: { value: 'acme' } })
    fireEvent.blur(nameField())
    tick('Camp')
    tick('Deals')
    expect(screen.getByText('Another consent group already has this name.')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Review' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(mockAuthorizedFetch).not.toHaveBeenCalled()
  })

  it('asks for two sites', () => {
    renderDialog('create')
    fireEvent.change(nameField(), { target: { value: 'Outdoors' } })
    tick('Camp')
    expect(screen.getByText('Choose at least two sites.')).toBeTruthy()
  })
})

describe('the review', () => {
  async function createOutdoors() {
    renderDialog('create')
    fireEvent.change(nameField(), { target: { value: 'Outdoors' } })
    tick('Camp')
    tick('Deals')
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    await reviewed()
  }

  it('is asked for with the whole next declaration and the one the dialog opened with', async () => {
    await createOutdoors()
    expect(mockAuthorizedFetch).toHaveBeenCalledTimes(1)
    expect(mockAuthorizedFetch.mock.calls[0][1]).toBe('/api/orgs/consent-groups')
    expect(posted(0)).toEqual({
      orgId: 'org-1',
      action: 'preview',
      expected: ORG.consentGroups,
      groups: [
        { id: 'g_acme', name: 'Acme', hostIds: ['acme-a', 'acme-b', 'acme-c'] },
        { id: 'g_home', name: 'Home goods', hostIds: ['blog', 'shop'] },
        { name: 'Outdoors', hostIds: ['camp', 'deals'] },
      ],
    })
  })

  it('says what the change does, with the preview’s counts, and how long it takes', async () => {
    await createOutdoors()
    expect(screen.getByText('Create “Outdoors”')).toBeTruthy()
    expect(
      screen.getByText(/stop getting marketing email from all of them \(4 opt-outs on record\)/),
    ).toBeTruthy()
    expect(screen.getByText('This should take less than a minute.')).toBeTruthy()
    expect(screen.getByText('You can leave this page; it finishes on its own.')).toBeTruthy()
  })

  it('applies the same declaration and hands the change back', async () => {
    await createOutdoors()
    fireEvent.click(screen.getByRole('button', { name: 'Create group' }))
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith({ changeId: 'chg_1', done: false }))
    expect(posted(1)).toEqual({ ...posted(0), action: 'apply' })
  })

  it('goes back to the edit step, draft intact', async () => {
    await createOutdoors()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect((nameField() as HTMLInputElement).value).toBe('Outdoors')
    expect((screen.getByRole('checkbox', { name: 'Camp' }) as HTMLInputElement).checked).toBe(true)
  })

  it('reloads, and says so, when somebody else changed consent groups first', async () => {
    const current = {
      ...ORG.consentGroups,
      g_new: { name: 'Weekend', hostIds: ['camp', 'deals'] },
    }
    mockAnswers.apply = { status: 409, body: { error: 'Stale', current } }
    await createOutdoors()
    fireEvent.click(screen.getByRole('button', { name: 'Create group' }))
    await screen.findByText(/Someone else changed consent groups while you were editing\./)
    expect(onApplied).not.toHaveBeenCalled()
    // Back on the edit step, over the declaration as it now stands: the new
    // group's draft is kept, and its sites now say whose they became.
    expect((nameField() as HTMLInputElement).value).toBe('Outdoors')
    expect(screen.getAllByText('Moves from Weekend')).toHaveLength(2)
    // And the next ask is made against it.
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    await reviewed()
    expect(posted(2).expected).toEqual(current)
    expect(posted(2).groups).toEqual([
      { id: 'g_acme', name: 'Acme', hostIds: ['acme-a', 'acme-b', 'acme-c'] },
      { id: 'g_home', name: 'Home goods', hostIds: ['blog', 'shop'] },
      { name: 'Outdoors', hostIds: ['camp', 'deals'] },
    ])
  })

  it('puts a refusal on the field it is about', async () => {
    mockAnswers.preview = {
      status: 400,
      body: { error: 'Invalid', errors: [{ code: 'name-duplicate', groupIndex: 2 }] },
    }
    renderDialog('create')
    fireEvent.change(nameField(), { target: { value: 'Outdoors' } })
    tick('Camp')
    tick('Deals')
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    await screen.findByText('Another consent group already has this name.')
    expect(nameField()).toBeTruthy()
  })

  it('says a change is still running', async () => {
    mockAnswers.preview = {
      status: 409,
      body: { error: 'Busy', changeId: 'chg_0', phase: 'sweep' },
    }
    renderDialog('create')
    fireEvent.change(nameField(), { target: { value: 'Outdoors' } })
    tick('Camp')
    tick('Deals')
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    await screen.findByText('Finishing the last change. You can make another once it’s done.')
    expect(
      (screen.getByRole('button', { name: 'Create group' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('starts an edit over from the group as it now stands after a stale answer', async () => {
    const current = {
      ...ORG.consentGroups,
      g_acme: { name: 'Acme Co', hostIds: ['acme-a', 'acme-b'] },
    }
    mockAnswers.preview = { status: 409, body: { error: 'Stale', current } }
    renderDialog('edit', 'g_acme')
    fireEvent.change(nameField(), { target: { value: 'Acme Outfitters' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    await screen.findByText(/Someone else changed consent groups while you were editing\./)
    expect((nameField() as HTMLInputElement).value).toBe('Acme Co')
    expect((screen.getByRole('checkbox', { name: 'Acme North' }) as HTMLInputElement).checked).toBe(
      false,
    )
  })

  it('names the button for a rename', async () => {
    renderDialog('edit', 'g_acme')
    fireEvent.change(nameField(), { target: { value: 'Acme Outfitters' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    await reviewed()
    expect(screen.getByRole('button', { name: 'Rename group' })).toBeTruthy()
    expect(posted(0).groups).toContainEqual({
      id: 'g_acme',
      name: 'Acme Outfitters',
      hostIds: ['acme-a', 'acme-b', 'acme-c'],
    })
  })

  it('does not ask for a review of an edit that changes nothing', () => {
    renderDialog('edit', 'g_acme')
    expect(
      (screen.getByRole('button', { name: 'Review' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})

describe('dissolving', () => {
  it('is where an edit left with one site goes, and the dialog says so first', async () => {
    renderDialog('edit', 'g_home')
    tick('Blog')
    expect(
      screen.getByText(
        'A consent group needs at least two sites. Removing Blog dissolves Home goods. Review it to see what that changes.',
      ),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Review dissolving' }))
    await reviewed()
    expect(screen.getByRole('button', { name: 'Dissolve group' })).toBeTruthy()
    expect(posted(0).groups).toEqual([
      { id: 'g_acme', name: 'Acme', hostIds: ['acme-a', 'acme-b', 'acme-c'] },
    ])
  })

  it('from the menu asks for its review at once, with the group left out', async () => {
    renderDialog('dissolve', 'g_acme')
    await reviewed()
    expect(screen.getByRole('button', { name: 'Dissolve group' })).toBeTruthy()
    expect(mockAuthorizedFetch).toHaveBeenCalledTimes(1)
    expect(posted(0)).toEqual({
      orgId: 'org-1',
      action: 'preview',
      expected: ORG.consentGroups,
      groups: [{ id: 'g_home', name: 'Home goods', hostIds: ['blog', 'shop'] }],
    })
    expect(screen.getByText('Dissolve “Acme”')).toBeTruthy()
  })

  it('applies the dissolve', async () => {
    renderDialog('dissolve', 'g_acme')
    await reviewed()
    fireEvent.click(screen.getByRole('button', { name: 'Dissolve group' }))
    await waitFor(() => expect(onApplied).toHaveBeenCalled())
    expect(posted(1)).toMatchObject({ action: 'apply', groups: posted(0).groups })
  })
})
