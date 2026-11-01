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

// The org's salutations (AGL-3515), read as the standard values.
jest.mock('../hooks/use-crm-picklist', () => {
  const { effectiveCrmPicklist } = jest.requireActual('@aglyn/aglyn/app-utils/crm')
  return {
    useCrmPicklist: (id: string) => ({
      picklist: effectiveCrmPicklist(id, null),
      stored: false,
      ready: true,
      fromCache: false,
    }),
  }
})

function renderDrawer(hostId: string | null = 'site-a', org: Record<string, unknown> = {}) {
  const onSubmit = jest.fn()
  render(
    <NewContactDrawer
      open
      onClose={() => undefined}
      hostId={hostId}
      org={org}
      owners={[]}
      ownersReady
      onSubmit={onSubmit}
    />,
  )
  return onSubmit
}
const addContact = () => fireEvent.click(screen.getByRole('button', { name: 'Add contact' }))
const typeInto = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })

const GROUPED = {
  consentGroups: { nw: { name: 'Northwind', hostIds: ['site-a', 'site-b'] } },
}

function submitWith(
  org: Record<string, unknown>,
  fill: () => void = () => undefined,
): NewContactValues {
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
  fill()
  fireEvent.click(screen.getByRole('button', { name: 'Add contact' }))
  expect(onSubmit).toHaveBeenCalledTimes(1)
  return onSubmit.mock.calls[0][0] as NewContactValues
}

/** A contact needs a name, an email or a number, and any one will do (AGL-4122). */
describe('who a contact needs to be', () => {
  it('takes a name with no email', () => {
    const onSubmit = renderDrawer()
    typeInto('First name', 'Jordan')
    addContact()
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ email: '', name: 'Jordan' })
  })

  it('takes a phone number with no name and no email', () => {
    const onSubmit = renderDrawer()
    typeInto('Mobile phone', '(512) 555-0101')
    addContact()
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ email: '', mobilePhone: '+15125550101' })
  })

  it('says so when there is nothing to call them by', () => {
    const onSubmit = renderDrawer()
    addContact()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('Enter a name, an email or a phone number.')).toBeTruthy()
  })

  it('still refuses an address that is not one', () => {
    const onSubmit = renderDrawer()
    typeInto(/Email/, 'not an address')
    addContact()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('Enter a valid email address.')).toBeTruthy()
  })

  it('offers no marketing opt-in without an address to send it to', () => {
    renderDrawer()
    const box = screen.getByLabelText('This person opted in to marketing email') as HTMLInputElement
    expect(box.disabled).toBe(true)
    typeInto(/Email/, 'ann@example.com')
    expect(box.disabled).toBe(false)
  })
})

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

/**
 * Salesforce's standard contact fields (AGL-3515): the name is the first
 * and last names' while either is typed, and the rest leave as typed.
 */
describe("the drawer's standard contact fields", () => {
  it('composes the name from the parts and hands over the mobile, the department and do not call', () => {
    const values = submitWith({}, () => {
      fireEvent.change(screen.getByLabelText('First name'), { target: { value: ' Ann ' } })
      fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Lee' } })
      fireEvent.change(screen.getByLabelText('Mobile phone'), {
        target: { value: '(512) 555-0101' },
      })
      fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'Ops' } })
      fireEvent.click(screen.getByLabelText('Do not call'))
    })
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Ann Lee')
    expect(values).toMatchObject({
      name: 'Ann Lee',
      firstName: 'Ann',
      lastName: 'Lee',
      mobilePhone: '+15125550101',
      department: 'Ops',
      doNotCall: true,
      salutation: '',
    })
  })
})
