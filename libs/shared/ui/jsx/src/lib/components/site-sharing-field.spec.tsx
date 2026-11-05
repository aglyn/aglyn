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

import { fireEvent, render, screen } from '@testing-library/react'
import { SiteSharingField, type SiteSharingFieldProps, type SiteSharingValue } from './site-sharing-field.component'

/**
 * Who a shared resource is shared with (AGL-4047). Radios and a visible list,
 * two choices that are never right kept out of reach with the reason, and picks
 * carried across the modes.
 */

const SITES = [
  { id: 'a', name: 'Site A' },
  { id: 'b', name: 'Site B' },
  { id: 'c', name: 'Site C' },
]

const setup = (value: SiteSharingValue | null, props: Partial<SiteSharingFieldProps> = {}) => {
  const onChange = jest.fn()
  render(<SiteSharingField value={value} onChange={onChange} sites={SITES} sitesReady {...props} />)
  return onChange
}

const radio = (name: RegExp | string) => screen.getByRole('radio', { name }) as HTMLInputElement
const box = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement
const EXCEPT = /^All sites except/
const SELECTED = /^Selected sites/

describe('SiteSharingField', () => {
  it('is radios, with no dropdown', () => {
    setup({ mode: 'all' })
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(radio('All sites').checked).toBe(true)
  })

  it('shows nothing picked for a resource nobody has shared', () => {
    setup(null)
    for (const each of screen.getAllByRole('radio')) expect((each as HTMLInputElement).checked).toBe(false)
  })

  it('offers only the modes it is given', () => {
    setup({ mode: 'all' }, { modes: ['all', 'selected'] })
    expect(screen.queryByRole('radio', { name: EXCEPT })).toBeNull()
  })

  describe('the list is on screen whenever a mode acts on it', () => {
    it('none for All sites', () => {
      setup({ mode: 'all' })
      expect(screen.queryByRole('checkbox')).toBeNull()
    })

    it('every site, the picks ticked', () => {
      setup({ mode: 'allExcept', exceptHostIds: ['b'] })
      expect(screen.getByText('Sites to leave out')).toBeTruthy()
      expect(box('Site A').checked).toBe(false)
      expect(box('Site B').checked).toBe(true)
      expect(box('Site C').checked).toBe(false)
    })

    it('says the sites are being read rather than showing none', () => {
      setup({ mode: 'selected', hostIds: ['a'] }, { sites: [], sitesReady: false })
      expect(screen.getAllByText('Reading this workspace’s sites…').length).toBeGreaterThan(0)
      expect(screen.queryByRole('checkbox')).toBeNull()
    })
  })

  describe('moving between the modes carries the picks across', () => {
    it('All sites to except starts with nothing left out', () => {
      expect(fireThen(setup({ mode: 'all' }), EXCEPT)).toEqual({ mode: 'allExcept', exceptHostIds: [] })
    })

    it('chosen sites to except leaves out the ones not chosen', () => {
      expect(fireThen(setup({ mode: 'selected', hostIds: ['a', 'c'] }), EXCEPT)).toEqual({
        mode: 'allExcept',
        exceptHostIds: ['b'],
      })
    })

    it('except to chosen sites chooses the ones not left out', () => {
      expect(fireThen(setup({ mode: 'allExcept', exceptHostIds: ['b'] }), SELECTED)).toEqual({
        mode: 'selected',
        hostIds: ['a', 'c'],
      })
    })

    it('except to All sites drops them', () => {
      expect(fireThen(setup({ mode: 'allExcept', exceptHostIds: ['b'] }), 'All sites')).toEqual({ mode: 'all' })
    })
  })

  describe('ticking', () => {
    it('leaves a site out, and takes it back', () => {
      const onChange = setup({ mode: 'allExcept', exceptHostIds: ['b'] })
      fireEvent.click(box('Site A'))
      expect(onChange).toHaveBeenLastCalledWith({ mode: 'allExcept', exceptHostIds: ['b', 'a'] })
      fireEvent.click(box('Site B'))
      expect(onChange).toHaveBeenLastCalledWith({ mode: 'allExcept', exceptHostIds: [] })
    })

    it('chooses a site', () => {
      const onChange = setup({ mode: 'selected', hostIds: ['a'] })
      fireEvent.click(box('Site B'))
      expect(onChange).toHaveBeenLastCalledWith({ mode: 'selected', hostIds: ['a', 'b'] })
    })
  })

  describe('kept out of reach, with the reason', () => {
    it('one site: nothing to leave out', () => {
      setup({ mode: 'all' }, { sites: [SITES[0]] })
      expect(radio(EXCEPT).disabled).toBe(true)
      expect(screen.getByText('This workspace has one site, so there is nothing to leave out.')).toBeTruthy()
      // Every other choice stays what it is today.
      expect(radio(SELECTED).disabled).toBe(false)
    })

    it('leaving out every site: the last one in can’t be', () => {
      setup({ mode: 'allExcept', exceptHostIds: ['a', 'b'] })
      expect((screen.getByRole('checkbox', { name: /^Site C/ }) as HTMLInputElement).disabled).toBe(true)
      expect(screen.getByText(/At least one site has to stay in/)).toBeTruthy()
      expect(box('Site A').disabled).toBe(false)
    })

    it('past the most sites it can reach', () => {
      setup({ mode: 'all' }, { maxIncluded: 2 })
      expect(radio(EXCEPT).disabled).toBe(true)
      expect(screen.getByText(/works up to 2 sites, and this workspace has 3/)).toBeTruthy()
    })

    it('THE CONTROL: at exactly that limit it is on', () => {
      setup({ mode: 'all' }, { maxIncluded: 3 })
      expect(radio(EXCEPT).disabled).toBe(false)
    })

    it('while the sites are being read', () => {
      setup({ mode: 'all' }, { sites: [], sitesReady: false })
      expect(radio(EXCEPT).disabled).toBe(true)
    })

    it('never switches off the choice a resource already has', () => {
      setup({ mode: 'allExcept', exceptHostIds: ['b'] }, { sites: [SITES[0]] })
      expect(radio(EXCEPT).disabled).toBe(false)
    })
  })

  it('keeps a site this member can’t name on the choice, and says so', () => {
    const onChange = setup({ mode: 'allExcept', exceptHostIds: ['hidden'] })
    expect(screen.getByText(/1 site you don’t have access to/)).toBeTruthy()
    fireEvent.click(box('Site A'))
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'allExcept', exceptHostIds: ['hidden', 'a'] })
  })

  it('read-only switches everything off, with the reason', () => {
    setup({ mode: 'selected', hostIds: ['a'] }, { readOnly: true, readOnlyReason: 'You can’t change this.' })
    expect(screen.getByText('You can’t change this.')).toBeTruthy()
    for (const each of screen.getAllByRole('radio')) expect((each as HTMLInputElement).disabled).toBe(true)
    for (const each of screen.getAllByRole('checkbox')) expect((each as HTMLInputElement).disabled).toBe(true)
  })

  it('says the caller’s problem', () => {
    setup({ mode: 'allExcept', exceptHostIds: [] }, { problem: 'Choose at least one site to leave out.' })
    expect(screen.getByText('Choose at least one site to leave out.')).toBeTruthy()
  })
})

function fireThen(onChange: jest.Mock, name: RegExp | string) {
  fireEvent.click(radio(name))
  return onChange.mock.lastCall?.[0]
}
