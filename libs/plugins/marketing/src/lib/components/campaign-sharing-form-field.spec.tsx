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

// The drawer's mapper loads its fields through next/dynamic, which renders
// nothing under jest; this is the one the name field needs.
jest.mock('@aglyn/shared-ui-jsx-forms/constants/dynamic-fields', () => ({
  ...jest.requireActual('@aglyn/shared-ui-jsx-forms/constants/dynamic-fields'),
  FieldTextField: jest.requireActual('@aglyn/shared-ui-jsx-forms/mapper/text-field').default,
}))

import { act, fireEvent, render, screen } from '@testing-library/react'
import { CreateArtifactDrawer } from '@aglyn/shared-ui-jsx-forms'
import { CAMPAIGN_SHARING_FIELD, CampaignSharingFormField } from './campaign-sharing-form-field'

/**
 * WHO A NEW CAMPAIGN IS SHARED WITH, IN THE CREATE DRAWER (AGL-4047).
 *
 * The org hub's create drawer is the shared one, and its sharing field is the
 * shared `SiteSharingField`: radios and a visible list of sites, never the
 * dropdown it replaces, starting on All sites as an empty selection did.
 */
const SITES = [
  { id: 'a', name: 'Store' },
  { id: 'b', name: 'Blog' },
]

function renderDrawer(onSubmit: (values: Record<string, unknown>) => void, sitesReady = true) {
  render(
    <CreateArtifactDrawer
      open
      onClose={() => undefined}
      title="Create campaign"
      submitLabel="Create campaign"
      includeDescription={false}
      onSubmit={onSubmit}
      componentMapper={{ [CAMPAIGN_SHARING_FIELD]: CampaignSharingFormField }}
      extraFields={[
        {
          component: CAMPAIGN_SHARING_FIELD,
          name: 'sharing',
          label: 'Shared with',
          initialValue: { mode: 'all' },
          helperText: 'The sites this campaign is offered on.',
          sites: SITES,
          sitesReady,
        },
      ]}
    />,
  )
}

const submit = async () => {
  await act(async () => {
    fireEvent.change(screen.getByRole('textbox', { name: /name/i }), { target: { value: 'Spring' } })
  })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Create campaign' }))
  })
}

describe('the create drawer’s sharing field', () => {
  it('is radios and a visible list, starting on All sites, and no dropdown', async () => {
    const onSubmit = jest.fn()
    renderDrawer(onSubmit)

    expect(screen.getByRole('radiogroup', { name: 'Shared with' })).toBeTruthy()
    expect((screen.getByRole('radio', { name: 'All sites' }) as HTMLInputElement).checked).toBe(true)
    expect(screen.queryByRole('combobox', { name: /Sites|Shared with/ })).toBeNull()
    expect(screen.getByText('The sites this campaign is offered on.')).toBeTruthy()

    await submit()
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ displayName: 'Spring', sharing: { mode: 'all' } })
  })

  it('hands back all sites except the ones left out', async () => {
    const onSubmit = jest.fn()
    renderDrawer(onSubmit)

    fireEvent.click(screen.getByRole('radio', { name: /All sites except/ }))
    // Nothing left out yet is All sites, and the field says why it can't be saved.
    expect(screen.getByText(/Choose at least one site to leave out/)).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Blog' }))
    expect(screen.queryByText(/Choose at least one site to leave out/)).toBeNull()

    await submit()
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      sharing: { mode: 'allExcept', exceptHostIds: ['b'] },
    })
  })

  it('says nothing about leaving sites out until the sites are read', () => {
    renderDrawer(jest.fn(), false)
    expect((screen.getByRole('radio', { name: /All sites except/ }) as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText(/Reading this workspace’s sites/)).toBeTruthy()
  })
})
