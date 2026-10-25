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

import { fireEvent, render, screen, within } from '@testing-library/react'
import { PermissionChoiceList, type PermissionChoiceSection } from './permission-choice-list.component'

const SECTIONS: PermissionChoiceSection[] = [
  {
    id: 'sites',
    label: 'Sites',
    items: [
      { key: 'hosts.create', label: 'Create sites', description: 'Create new sites.', choice: 'grant' },
      { key: 'hosts.delete', label: 'Delete sites', choice: 'inherit', inheritHint: 'Inherit: allowed for Owner, Admin by default' },
    ],
  },
  {
    id: 'commerce',
    label: 'Commerce',
    items: [
      {
        key: 'managePos',
        label: 'Use the point of sale',
        choice: 'deny',
        effective: { granted: false, source: 'Denied for this member' },
      },
    ],
  },
]

describe('PermissionChoiceList (AGL-4047)', () => {
  it('draws each group with its keys, their three states and the counts', () => {
    render(<PermissionChoiceList sections={SECTIONS} onChange={jest.fn()} />)
    const sites = screen.getByRole('region', { name: 'Sites' })
    expect(within(sites).getByText('1 allowed')).toBeTruthy()
    const create = within(sites).getByRole('group', { name: 'Create sites' })
    expect(within(create).getByRole('button', { name: 'Allow' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Inherit: allowed for Owner, Admin by default')).toBeTruthy()
    expect(screen.getByText('Not allowed · Denied for this member')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Commerce' })).getByText('1 denied')).toBeTruthy()
  })

  it('answers a key’s new choice, and a group heading’s for every key in it', () => {
    const onChange = jest.fn()
    render(<PermissionChoiceList sections={SECTIONS} onChange={onChange} groupActions />)
    fireEvent.click(within(screen.getByRole('group', { name: 'Delete sites' })).getByRole('button', { name: 'Deny' }))
    expect(onChange).toHaveBeenLastCalledWith(['hosts.delete'], 'deny')
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Set every Sites permission' })).getByRole('button', { name: 'Inherit' }),
    )
    expect(onChange).toHaveBeenLastCalledWith(['hosts.create', 'hosts.delete'], 'inherit')
  })

  it('searches through the caller, and says so when nothing is left', () => {
    const onSearchChange = jest.fn()
    const { rerender } = render(
      <PermissionChoiceList sections={SECTIONS} onChange={jest.fn()} search="" onSearchChange={onSearchChange} />,
    )
    fireEvent.change(screen.getByLabelText('Search permissions'), { target: { value: 'pos' } })
    expect(onSearchChange).toHaveBeenCalledWith('pos')
    rerender(
      <PermissionChoiceList
        sections={[]}
        onChange={jest.fn()}
        search="zzz"
        onSearchChange={onSearchChange}
      />,
    )
    expect(screen.getByText('No permission matches your search.')).toBeTruthy()
  })

  it('locks a row it was told cannot change', () => {
    const onChange = jest.fn()
    render(
      <PermissionChoiceList
        sections={[{ id: 'team', label: 'Team', items: [{ key: 'members.manage', label: 'Manage members', choice: 'inherit', lockedReason: 'Owners keep every permission' }] }]}
        onChange={onChange}
      />,
    )
    const deny = within(screen.getByRole('group', { name: 'Manage members' })).getByRole('button', { name: 'Deny' })
    expect((deny as HTMLButtonElement).disabled).toBe(true)
  })
})
