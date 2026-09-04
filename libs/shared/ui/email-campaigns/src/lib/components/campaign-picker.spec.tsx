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
 * THE ONE CONTROL BEHIND EVERY CAMPAIGN ASSIGNMENT.
 *
 * A form's page, a screen's page and a contact's drawer all render this, so
 * the guarantees a caller stops thinking about live here:
 *
 *  - **Clearing is reachable.** Set-and-clear is one feature and only half of
 *    it is easy to ship. A picker that could add a campaign and not remove
 *    the last one would look complete and leave a merchant stuck.
 *  - **A campaign is drawn by NAME and stored by id.** The document holds
 *    ids; a control that showed them would be handing somebody raw storage.
 *  - **An id with no campaign left is still shown.** A deleted campaign is
 *    exactly that case, and a chip that vanished would report an assignment
 *    as already gone.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { CampaignPicker } from './campaign-picker.component'

const draw = (node: unknown) => render(node as ReactNode as never)

const OPTIONS = [
  { value: 'spring', label: 'Spring sale' },
  { value: 'summer', label: 'Summer push' },
]

/** Opens the multi-select's menu, which MUI opens on mousedown. */
function openMenu() {
  fireEvent.mouseDown(screen.getByRole('combobox'))
}

describe('drawing what is assigned', () => {
  it('names each campaign rather than showing its id', () => {
    draw(
      <CampaignPicker
        options={OPTIONS}
        value={['spring']}
        onChange={() => undefined}
      />,
    )
    expect(screen.getByText('Spring sale')).toBeTruthy()
    expect(screen.queryByText('spring')).toBeNull()
  })

  it('keeps an id whose campaign is no longer in the list', () => {
    // The control: a picker that rendered only the ids it could label would
    // draw an empty field for a record that is still assigned.
    draw(
      <CampaignPicker
        options={OPTIONS}
        value={['deleted-campaign']}
        onChange={() => undefined}
      />,
    )
    expect(screen.getByText('deleted-campaign')).toBeTruthy()
  })

  it('says so when nothing is assigned', () => {
    draw(
      <CampaignPicker
        options={OPTIONS}
        value={[]}
        onChange={() => undefined}
      />,
    )
    expect(screen.getByText('No campaign')).toBeTruthy()
  })

  it('explains an empty site instead of offering an empty menu', () => {
    // An empty select and a site with no campaigns look identical, and only
    // one of them is a control that is working.
    draw(
      <CampaignPicker
        options={[]}
        value={[]}
        onChange={() => undefined}
        empty
      />,
    )
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.getByText(/no campaigns yet/i)).toBeTruthy()
  })
})

describe('changing what is assigned', () => {
  it('adds a campaign without dropping the ones already there', () => {
    const changes: string[][] = []
    draw(
      <CampaignPicker
        options={OPTIONS}
        value={['spring']}
        onChange={(next) => changes.push(next)}
      />,
    )
    openMenu()
    fireEvent.click(screen.getByRole('option', { name: 'Summer push' }))
    expect(changes).toEqual([['spring', 'summer']])
  })

  it('removes the LAST campaign, and reports the empty selection', () => {
    /*
     * The clear path, which is the half that is easy to lose: a caller told
     * `[]` writes an empty array, and a caller told nothing writes nothing.
     */
    const changes: string[][] = []
    draw(
      <CampaignPicker
        options={OPTIONS}
        value={['spring']}
        onChange={(next) => changes.push(next)}
      />,
    )
    openMenu()
    fireEvent.click(screen.getByRole('option', { name: 'Spring sale' }))
    expect(changes).toEqual([[]])
  })

  it('cannot be changed while a save is in flight', () => {
    draw(
      <CampaignPicker
        options={OPTIONS}
        value={['spring']}
        onChange={() => undefined}
        disabled
      />,
    )
    expect(screen.getByRole('combobox').getAttribute('aria-disabled')).toBe(
      'true',
    )
  })
})
