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
 * THE ONE CONTROL BEHIND EVERY FILING UNDER A CONTAINER.
 *
 * A form's page, a screen's page, a contact's and a lead's all render this,
 * so the guarantees a caller stops thinking about live here:
 *
 *  - **Clearing is reachable.** Set-and-clear is one feature and only half of
 *    it is easy to ship. A picker that could add a container and not remove
 *    the last one would look complete and leave a merchant stuck.
 *  - **A container is drawn by NAME and stored by id.** The document holds
 *    ids; a control that showed them would be handing somebody raw storage.
 *  - **An id with no container left is still shown.** A deleted container
 *    is exactly that case, and a chip that vanished would report a filing as
 *    already gone.
 *  - **Its words are the kind's.** The owner declares what one and several
 *    are called and where one is made; the kind here is made up, declared by
 *    the mock below.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ContainerPicker, containerPickerWords } from './container-picker'

jest.mock('@aglyn/aglyn/plugin-manager/plugin-containers', () => ({
  pluginContainerKind: (kind: string) =>
    kind === 'tasting'
      ? {
          pluginId: 'cellar',
          kind: 'tasting',
          label: 'Tasting',
          pluralLabel: 'Tastings',
          ownerLabel: 'Cellar',
          orgCollection: 'tastings',
          nameField: 'title',
        }
      : null,
}))

const draw = (node: unknown) => render(node as ReactNode as never)

const OPTIONS = [
  { value: 'spring', label: 'Spring tasting' },
  { value: 'summer', label: 'Summer tasting' },
]

/** Opens the multi-select's menu, which MUI opens on mousedown. */
function openMenu() {
  fireEvent.mouseDown(screen.getByRole('combobox'))
}

describe('drawing what is assigned', () => {
  it('names each container rather than showing its id', () => {
    draw(
      <ContainerPicker
        kind="tasting"
        options={OPTIONS}
        value={['spring']}
        onChange={() => undefined}
      />,
    )
    expect(screen.getByText('Spring tasting')).toBeTruthy()
    expect(screen.queryByText('spring')).toBeNull()
  })

  it('keeps an id whose container is no longer in the list', () => {
    // The control: a picker that rendered only the ids it could label would
    // draw an empty field for a record that is still assigned.
    draw(
      <ContainerPicker
        kind="tasting"
        options={OPTIONS}
        value={['deleted-tasting']}
        onChange={() => undefined}
      />,
    )
    expect(screen.getByText('deleted-tasting')).toBeTruthy()
  })

  it('says so when nothing is assigned', () => {
    draw(
      <ContainerPicker
        kind="tasting"
        options={OPTIONS}
        value={[]}
        onChange={() => undefined}
      />,
    )
    expect(screen.getByText('No tasting')).toBeTruthy()
  })

  it('and shrinks its label out of the way of that placeholder', () => {
    /*
     * The other half of the line above. MUI shrinks a label when the input
     * reports itself filled and an empty multiple select reports the opposite,
     * so the "none" placeholder printed UNDER a full-size label — two lines of
     * text on one line, on every screen, form, contact and dynamic-list page
     * that renders this picker.
     *
     * `MuiInputLabel-shrink` is the state class MUI applies, so it is the one
     * thing that distinguishes the two paints in jsdom, which lays out nothing.
     */
    draw(
      <ContainerPicker
        kind="tasting"
        options={OPTIONS}
        value={[]}
        label="Tastings"
        onChange={() => undefined}
      />,
    )
    const label = document.querySelector('.MuiInputLabel-root') as HTMLElement
    expect(label.className).toContain('MuiInputLabel-shrink')
  })

  it('explains an empty site instead of offering an empty menu', () => {
    // An empty select and a site with no containers look identical, and only
    // one of them is a control that is working.
    draw(
      <ContainerPicker
        kind="tasting"
        options={[]}
        value={[]}
        onChange={() => undefined}
        empty
      />,
    )
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.getByText(/no tastings yet/i)).toBeTruthy()
  })
})

describe('changing what is assigned', () => {
  it('adds a container without dropping the ones already there', () => {
    const changes: string[][] = []
    draw(
      <ContainerPicker
        kind="tasting"
        options={OPTIONS}
        value={['spring']}
        onChange={(next) => changes.push(next)}
      />,
    )
    openMenu()
    fireEvent.click(screen.getByRole('option', { name: 'Summer tasting' }))
    expect(changes).toEqual([['spring', 'summer']])
  })

  it('removes the LAST container, and reports the empty selection', () => {
    /*
     * The clear path, which is the half that is easy to lose: a caller told
     * `[]` writes an empty array, and a caller told nothing writes nothing.
     */
    const changes: string[][] = []
    draw(
      <ContainerPicker
        kind="tasting"
        options={OPTIONS}
        value={['spring']}
        onChange={(next) => changes.push(next)}
      />,
    )
    openMenu()
    fireEvent.click(screen.getByRole('option', { name: 'Spring tasting' }))
    expect(changes).toEqual([[]])
  })

  it('cannot be changed while a save is in flight', () => {
    draw(
      <ContainerPicker
        kind="tasting"
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

describe('the words a kind is offered in', () => {
  it('are the declared labels, and name where one is made', () => {
    expect(containerPickerWords('tasting')).toEqual({
      label: 'Tastings',
      helperText: 'The tastings this belongs to. Clearing them all takes it out of every tasting.',
      none: 'No tasting',
      emptyText: 'This site has no tastings yet. Create one from Cellar to file records under it.',
    })
  })

  it('fall back to the kind itself, and promise no place to make one, for an undeclared kind', () => {
    expect(containerPickerWords('shelf').emptyText).toBe('This site has no shelf.')
    expect(containerPickerWords('shelf').none).toBe('No shelf')
  })
})
