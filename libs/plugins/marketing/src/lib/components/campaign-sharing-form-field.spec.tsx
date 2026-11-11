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

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { ScopeSharingChoice } from '@aglyn/aglyn/app-utils/scope-tokens'
import { CreateArtifactDrawer } from '@aglyn/shared-ui-jsx-forms'
import { useState } from 'react'
import { campaignSharingWrite } from '../model/campaign-container'
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

/**
 * A REFUSED CREATE KEEPS THE CHOICE (AGL-4047, production check 11/10).
 *
 * Choosing more sites than a campaign can name is refused and nothing is
 * saved. The card then draws again, with its fields built afresh, and the
 * drawer used to put "Shared with" back on All sites and drop the ticked
 * sites while the refusal still showed under the form: a second press made
 * an all-sites campaign nobody chose. The card is mirrored here as it is
 * built: fields made on every draw, and the refusal handed back by the
 * create as the sharing field's own.
 */
const MANY_SITES = Array.from({ length: 31 }, (_, index) => ({
  id: `s${index + 1}`,
  name: `Site ${index + 1}`,
}))

function RefusingCard(props: { onCreate: (values: Record<string, unknown>) => void }) {
  const [refusals, setRefusals] = useState(0)
  const handleCreate = (values: Record<string, unknown>) => {
    const placed = campaignSharingWrite(
      values.sharing as ScopeSharingChoice,
      MANY_SITES.map((site) => site.id),
    )
    if (!placed.fields) {
      // The card draws again, as a refusal makes it.
      setRefusals((count) => count + 1)
      return { sharing: placed.problem }
    }
    props.onCreate(values)
    return undefined
  }
  return (
    <CreateArtifactDrawer
      open
      onClose={() => undefined}
      title={`Create campaign (${refusals})`}
      submitLabel="Create campaign"
      includeDescription={false}
      onSubmit={handleCreate}
      componentMapper={{ [CAMPAIGN_SHARING_FIELD]: CampaignSharingFormField }}
      // Built on every draw, as the card's `campaignFields` is.
      extraFields={[
        {
          component: CAMPAIGN_SHARING_FIELD,
          name: 'sharing',
          label: 'Shared with',
          initialValue: { mode: 'all' },
          sites: MANY_SITES,
          sitesReady: true,
        },
      ]}
    />
  )
}

describe('a refused create', () => {
  const REFUSAL = /Choose 30 sites or fewer/
  const nameIt = async () => {
    await act(async () => {
      fireEvent.change(screen.getByRole('textbox', { name: /name/i }), { target: { value: 'Spring' } })
    })
  }
  const tickAll = () => {
    fireEvent.click(screen.getByRole('radio', { name: /Selected sites/ }))
    for (const site of MANY_SITES) {
      fireEvent.click(screen.getByRole('checkbox', { name: site.name }))
    }
  }
  const ticked = () =>
    MANY_SITES.filter(
      (site) => (screen.getByRole('checkbox', { name: site.name }) as HTMLInputElement).checked,
    ).length
  const press = async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create campaign' }))
    })
  }

  it('keeps exactly the sites chosen, with the reason beside the field', async () => {
    const onCreate = jest.fn()
    render(<RefusingCard onCreate={onCreate} />)
    await nameIt()
    tickAll()
    await press()

    expect(screen.getByText('Create campaign (1)')).toBeTruthy()
    expect(onCreate).not.toHaveBeenCalled()
    expect((screen.getByRole('radio', { name: /Selected sites/ }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('radio', { name: 'All sites' }) as HTMLInputElement).checked).toBe(false)
    expect(ticked()).toBe(31)
    // Once, inside the field's own fieldset.
    const field = screen.getByRole('group', { name: 'Shared with' })
    expect(within(field).getAllByText(REFUSAL)).toHaveLength(1)
    expect(screen.getAllByText(REFUSAL)).toHaveLength(1)

    // A second press is refused again rather than making an all-sites campaign.
    await press()
    expect(screen.getByText('Create campaign (2)')).toBeTruthy()
    expect(onCreate).not.toHaveBeenCalled()
    expect(ticked()).toBe(31)
  })

  it('clears the reason once the choice changes, and then creates what was chosen', async () => {
    const onCreate = jest.fn()
    render(<RefusingCard onCreate={onCreate} />)
    await nameIt()
    tickAll()
    await press()
    expect(screen.getAllByText(REFUSAL)).toHaveLength(1)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Site 31' }))
    expect(screen.queryByText(REFUSAL)).toBeNull()
    expect(ticked()).toBe(30)

    await press()
    expect(onCreate).toHaveBeenCalledTimes(1)
    expect(onCreate.mock.calls[0][0]).toMatchObject({
      displayName: 'Spring',
      sharing: { mode: 'selected', hostIds: MANY_SITES.slice(0, 30).map((site) => site.id) },
    })
  })

  it('says a reason only the create knows beside the field, until the choice changes', async () => {
    const onSubmit = jest.fn().mockReturnValue({ sharing: 'This workspace’s sites are still loading — try again' })
    renderDrawer(onSubmit)
    fireEvent.click(screen.getByRole('radio', { name: /Selected sites/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Blog' }))
    await submit()

    const field = screen.getByRole('group', { name: 'Shared with' })
    expect(within(field).getByText(/sites are still loading/)).toBeTruthy()
    expect((screen.getByRole('checkbox', { name: 'Blog' }) as HTMLInputElement).checked).toBe(true)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Store' }))
    expect(screen.queryByText(/sites are still loading/)).toBeNull()
  })
})
