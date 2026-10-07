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
import type { FunnelInventory } from '../model/funnel-inventory'
import { FunnelEditorDialog } from './funnel-editor.dialog'

jest.mock('@aglyn/shared-ui-jsx', () => ({ MdiIcon: () => null }))

const INVENTORY: FunnelInventory = {
  pages: ['/', '/pricing'],
  forms: [{ id: 'f1', name: 'Contact' }],
  services: [],
  products: [],
  overlays: [],
}

function open(initial: Parameters<typeof FunnelEditorDialog>[0]['initial'] = null) {
  const onSave = jest.fn()
  render(
    <FunnelEditorDialog
      open
      initial={initial}
      inventory={INVENTORY}
      saving={false}
      error={null}
      onClose={() => undefined}
      onSave={onSave}
    />,
  )
  return onSave
}

describe('the funnel editor (AGL-3605)', () => {
  it('starts a new funnel on the site’s first page and any form, and asks for a name', () => {
    const onSave = open()
    fireEvent.click(screen.getByText('Save'))
    expect(screen.getByText('Name the funnel.')).toBeTruthy()
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Mine' } })
    fireEvent.click(screen.getByText('Save'))
    expect(onSave).toHaveBeenCalledWith({
      name: 'Mine',
      steps: [
        { type: 'page', key: '/', match: 'exact' },
        { type: 'form', key: '' },
      ],
    })
  })

  it('reorders, adds and removes steps, and never goes below two', () => {
    const onSave = open({
      name: 'X',
      steps: [
        { type: 'page', key: '/pricing', match: 'exact' },
        { type: 'form', key: 'f1', label: 'Contact' },
      ],
    })
    expect((screen.getByLabelText('Remove step 1') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('Move step 2 up'))
    fireEvent.click(screen.getByText('Add a step'))
    fireEvent.click(screen.getByLabelText('Remove step 3'))
    fireEvent.click(screen.getByText('Save'))
    expect(onSave.mock.calls[0][0].steps.map((step: { type: string }) => step.type)).toEqual(['form', 'page'])
  })

  it('names a step the site does not have before anything is sent', () => {
    const onSave = open({
      name: 'X',
      steps: [
        { type: 'page', key: '/gone', match: 'exact' },
        { type: 'order', key: '' },
      ],
    })
    fireEvent.click(screen.getByText('Save'))
    expect(screen.getByText('Step 1: This site has no page at /gone.')).toBeTruthy()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('lists the dropped steps of an AI draft', () => {
    render(
      <FunnelEditorDialog
        open
        initial={{ name: 'Draft', steps: [{ type: 'order', key: '' }, { type: 'order', key: '' }] }}
        dropped={['No page on this site is at or under /shop.']}
        inventory={INVENTORY}
        saving={false}
        error={null}
        onClose={() => undefined}
        onSave={() => undefined}
      />,
    )
    const alert = screen.getByText(/Left out of the suggestion/)
    expect(within(alert).getByText(/\/shop/)).toBeTruthy()
  })
})
