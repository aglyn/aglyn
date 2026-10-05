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
 * Export offers every field and exports only the ones the person picked, in
 * the order they set: Re-importable by default, presets that fill the
 * picker, a hand-picked list, saved presets, and the whole choice
 * remembered for the next export.
 */

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'

import { createPeopleClient } from '../fixtures/people'
import type { TransferExportResponse } from './transfer-client'
import { TransferExportDialog } from './transfer-export-dialog.component'

const order = () =>
  within(screen.getByRole('list', { name: /Columns in the file/ }))
    .getAllByRole('listitem')
    .map((item) => item.textContent)

function renderDialog(
  client = createPeopleClient(),
  props: Partial<Parameters<typeof TransferExportDialog>[0]> = {},
) {
  const download = jest.fn<void, [TransferExportResponse]>()
  const onClose = jest.fn()
  render(
    <TransferExportDialog
      open
      client={client}
      resource="people"
      onClose={onClose}
      download={download}
      {...props}
    />,
  )
  return { client, download, onClose }
}

describe('TransferExportDialog', () => {
  it('starts on Re-importable: the Aglyn ID and the match keys first, then every writable field', async () => {
    renderDialog()
    await screen.findByRole('dialog', { name: 'Export people' })
    expect(order()).toEqual([
      '1. Aglyn ID',
      '2. Email',
      '3. Name',
      '4. Phone',
      '5. Joined',
      '6. Stage',
      '7. Team',
      '8. Score',
      '9. Shoe size',
    ])
    expect(screen.getByRole('checkbox', { name: /Days known/ })).toBeTruthy()
    expect(
      (screen.getByRole('checkbox', { name: /Days known/ }) as HTMLInputElement)
        .checked,
    ).toBe(false)
  })

  it('fills the picker from a preset, and any change after it is a hand-picked list', async () => {
    renderDialog()
    await screen.findByRole('dialog', { name: 'Export people' })
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /Preset/ }))
    fireEvent.click(
      within(screen.getByRole('listbox')).getByRole('option', {
        name: /^Everything/,
      }),
    )
    expect(order()).toHaveLength(11)
    fireEvent.click(screen.getByRole('button', { name: 'Select none' }))
    expect(
      screen
        .getByRole('button', { name: 'Export 0 fields' })
        .hasAttribute('disabled'),
    ).toBe(true)
    expect(screen.getByRole('combobox', { name: /Preset/ }).textContent).toBe(
      'Hand-picked',
    )
    fireEvent.change(screen.getByLabelText('Search fields'), {
      target: { value: 'mail' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Select shown' }))
    expect(order()).toEqual(['1. Email'])
  })

  it("offers the resource's own preset, and writes its columns under that product's names", async () => {
    const client = createPeopleClient({
      resourcePresets: [
        {
          id: 'crm-x',
          label: 'CRM X layout',
          description: 'The columns CRM X imports.',
          fieldIds: ['email', 'name'],
          headers: { email: 'E-mail Address', name: 'Full Name' },
        },
      ],
    })
    const exported = jest.spyOn(client, 'export')
    const { download } = renderDialog(client)
    await screen.findByRole('dialog', { name: 'Export people' })
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /Preset/ }))
    fireEvent.click(
      within(screen.getByRole('listbox')).getByRole('option', {
        name: /^CRM X layout/,
      }),
    )
    expect(order()).toEqual(['1. Email', '2. Name'])
    fireEvent.click(screen.getByRole('button', { name: 'Export 2 fields' }))
    await waitFor(() => expect(download).toHaveBeenCalled())
    expect(exported.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        fieldIds: ['email', 'name'],
        headers: { email: 'E-mail Address', name: 'Full Name' },
      }),
    )
  })

  it('exports the fields in the order set, for the selection, and remembers the choice', async () => {
    const { client, download } = renderDialog(createPeopleClient(), {
      selection: ['rec-1'],
    })
    await screen.findByRole('dialog', { name: 'Export people' })
    fireEvent.click(screen.getByRole('button', { name: 'Select none' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /^Name/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /^Email/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Move Email up' }))
    expect(order()).toEqual(['1. Email', '2. Name'])
    expect(
      (
        screen.getByRole('radio', {
          name: 'The 1 selected record',
        }) as HTMLInputElement
      ).checked,
    ).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: /^JSON/ }))
    expect(
      screen.queryByRole('checkbox', { name: /byte-order mark/ }),
    ).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Export 2 fields' }))
    await waitFor(() => expect(download).toHaveBeenCalled())
    expect(download.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ fileName: 'people.json', rowCount: 1 }),
    )
    const prefs = (await client.fields({ resource: 'people' })).prefs
    expect(prefs.export).toEqual({
      presetId: null,
      fieldIds: ['email', 'name'],
      format: 'json',
      bom: false,
      scope: 'selection',
    })
  })

  it('saves the current fields as a preset, and reports fields a saved choice no longer has', async () => {
    const client = createPeopleClient({
      prefs: {
        presets: [],
        export: {
          presetId: null,
          fieldIds: ['email', 'gone'],
          format: 'csv',
          bom: true,
          scope: 'all',
        },
      },
    })
    renderDialog(client)
    await screen.findByRole('dialog', { name: 'Export people' })
    expect(order()).toEqual(['1. Email'])
    expect(
      screen.getByText(
        /1 field in this choice no longer exists and is left out: gone/,
      ),
    ).toBeTruthy()
    expect(
      (
        screen.getByRole('checkbox', {
          name: /byte-order mark/,
        }) as HTMLInputElement
      ).checked,
    ).toBe(true)
    fireEvent.change(screen.getByLabelText('Save these fields as'), {
      target: { value: 'Just email' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save preset' }))
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: /Preset/ }).textContent).toBe(
        'Just email',
      ),
    )
    expect((await client.fields({ resource: 'people' })).prefs.presets).toEqual(
      [expect.objectContaining({ label: 'Just email', fieldIds: ['email'] })],
    )
  })
})
