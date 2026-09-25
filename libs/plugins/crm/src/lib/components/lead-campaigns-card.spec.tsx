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
 * THE LEAD'S CAMPAIGNS CARD (AGL-3274).
 *
 * What it must hold: the header names campaigns and never prints an id;
 * Save stays quiet while the picker only reorders what is stored, and a
 * change lands as the shared membership value through the lead's own
 * document with the diff reported to the page; a site with no campaigns
 * says so in place of the picker.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { LeadCampaignsCard, leadCampaignNames } from './lead-campaigns-card'

const updateDoc = jest.fn(async (..._args: unknown[]) => undefined)
jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  serverTimestamp: () => ({ op: 'serverTimestamp' }),
  updateDoc: (...args: unknown[]) => updateDoc(...(args as [])),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  // The viewer's reach, which `useCrmScope` reads only for a site in a
  // declared consent group (AGL-3320); an org-wide member here.
  useScopeTokens: () => ({ tokens: ['org'], orgWide: true, loaded: true }),
  // The lead collection is the org's now (AGL-3275), so the surface resolves
  // its org through the shared scope hook.
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'], orgId: 'org-1', ready: true }),
  useFirestore: () => ({}),
  writeGuardedBySeed: async (_seed: unknown, run: () => Promise<unknown>) => {
    await run()
    return { ok: true }
  },
}))
let notices: string[]
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({
    enqueueSnackbar: (message: unknown) => void notices.push(String(message)),
  }),
}))

const options = [
  { value: 'founder-icp1', label: 'Founder · ICP 1' },
  { value: 'founder-icp2', label: 'Founder · ICP 2' },
]

beforeEach(() => {
  notices = []
  updateDoc.mockClear()
})

/** Save filing, which is the card's action and sits in its header (AGL-3334). */
const saveFiling = () => {
  const header = document.querySelector('.MuiCardHeader-action')
  expect(header).not.toBeNull()
  return within(header as HTMLElement).getByRole('button', { name: 'Save filing' })
}

describe('leadCampaignNames', () => {
  it('names the campaigns from the containers and drops an id nothing answers for', () => {
    expect(leadCampaignNames({ campaignIds: ['founder-icp2', 'gone', 'founder-icp1'] }, options)).toEqual([
      'Founder · ICP 2',
      'Founder · ICP 1',
    ])
    expect(leadCampaignNames({}, options)).toEqual([])
    expect(leadCampaignNames({ campaignIds: ['founder-icp2'] }, [])).toEqual([])
  })
})

describe('LeadCampaignsCard', () => {
  const mount = (lead: Record<string, unknown>, onFiled = jest.fn()) => {
    render(
      <LeadCampaignsCard
        hostId="site-1"
        leadId="lead-key"
        lead={lead}
        leadStatus="success"
        fromCache={false}
        options={options}
        optionsReady
        onFiled={onFiled}
      />,
    )
    return onFiled
  }

  it('offers the picker as Filed under campaigns, with Save quiet while nothing changed', () => {
    mount({ campaignIds: ['founder-icp1'] })
    expect(screen.getByRole('combobox', { name: 'Filed under campaigns' })).toBeTruthy()
    expect(screen.getByText('Your own filing. It never adds anyone to a send — a campaign mails its lists.')).toBeTruthy()
    expect((saveFiling() as HTMLButtonElement).disabled).toBe(true)
  })

  it('saves the membership value on the lead’s own document and reports the diff', async () => {
    const onFiled = mount({ campaignIds: ['founder-icp1'] })
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Filed under campaigns' }))
    fireEvent.click(screen.getByRole('option', { name: 'Founder · ICP 2' }))
    fireEvent.click(screen.getByRole('option', { name: 'Founder · ICP 1' }))
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
    const save = saveFiling() as HTMLButtonElement
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await waitFor(() => expect(notices).toEqual(['Filing saved']))
    expect(updateDoc).toHaveBeenCalledWith(
      { path: 'orgs/org-1/leads/lead-key' },
      { campaignIds: ['founder-icp2'], updatedAt: { op: 'serverTimestamp' } },
    )
    expect(onFiled).toHaveBeenCalledWith({ added: ['founder-icp2'], removed: ['founder-icp1'] })
  })

  it('says so in place of the picker when the site has no campaigns', () => {
    render(
      <LeadCampaignsCard
        hostId="site-1"
        leadId="lead-key"
        lead={{}}
        leadStatus="success"
        fromCache={false}
        options={[]}
        optionsReady
      />,
    )
    expect(screen.getByText(/no campaigns to file this lead under yet/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save filing' })).toBeNull()
  })
})
