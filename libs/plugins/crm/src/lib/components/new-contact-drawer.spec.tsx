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
 * The new-contact drawer's consent box records what its helper line says
 * (AGL-3320).
 *
 * On a site in a declared consent group the line under the box names the
 * group, and the drawer hands the route the key of exactly that sentence —
 * the capture pools the opt-in over the group on that key and on nothing
 * else. On a site alone there is no sentence and no key.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import {
  consentGroupDisclosure,
  consentGroupDisclosureKey,
  consentGroupForHost,
} from '@aglyn/aglyn'
import { NewContactDrawer, type NewContactValues } from './new-contact-drawer'

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'], orgId: 'org-1', ready: true }),
  useScopeTokens: () => ({ tokens: ['org'], orgWide: true, loaded: true }),
}))
// The company listen and create are the picker's own, and not what this
// file is about.
jest.mock('./company-picker', () => ({
  CompanyPicker: () => null,
  useCompanyOptions: () => ({ options: [], ready: true }),
  useCreateCompany: () => async () => null,
}))

const GROUPED = {
  consentGroups: { nw: { name: 'Northwind', hostIds: ['site-a', 'site-b'] } },
}

function submitWith(org: Record<string, unknown>): NewContactValues {
  const onSubmit = jest.fn()
  render(
    <NewContactDrawer
      open
      onClose={() => undefined}
      hostId="site-a"
      org={org}
      owners={[]}
      ownersReady
      onSubmit={onSubmit}
    />,
  )
  fireEvent.change(screen.getByLabelText(/Email/), {
    target: { value: 'ann@example.com' },
  })
  fireEvent.click(screen.getByLabelText('This person opted in to marketing email'))
  fireEvent.click(screen.getByRole('button', { name: 'Add contact' }))
  expect(onSubmit).toHaveBeenCalledTimes(1)
  return onSubmit.mock.calls[0][0] as NewContactValues
}

describe('the consent box on a grouped site', () => {
  it('shows the group’s sentence and hands over the key of that sentence', () => {
    const group = consentGroupForHost(GROUPED, 'site-a')
    const values = submitWith(GROUPED)
    expect(
      screen.getByText(new RegExp(String(consentGroupDisclosure(group)).slice(0, 40))),
    ).toBeTruthy()
    expect(values.marketingConsent).toBe(true)
    expect(values.disclosedConsentGroup).toBe(consentGroupDisclosureKey(group))
  })

  it('THE CONTROL: a site alone shows no sentence and hands over no key', () => {
    const values = submitWith({})
    expect(values.marketingConsent).toBe(true)
    expect(values.disclosedConsentGroup).toBeNull()
  })
})
