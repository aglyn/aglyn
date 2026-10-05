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
 * Exporting part of a site (AGL-3534): items picked by kind, what they need
 * shown before anything downloads, and everything one press away.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react'

import { createFakeSitePackageClient } from '../fixtures/site-package'
import { PackageExportDialog } from './package-export-dialog.component'

async function renderDialog() {
  const client = createFakeSitePackageClient()
  const download = jest.fn()
  const onClose = jest.fn()
  render(<PackageExportDialog open client={client} download={download} onClose={onClose} />)
  await screen.findByRole('group', { name: 'Pages' })
  return { client, download, onClose }
}

describe('PackageExportDialog', () => {
  it('shows what a selection needs, and exports it with its dependencies', async () => {
    const { client, download, onClose } = await renderDialog()
    fireEvent.click(within(screen.getByRole('group', { name: 'Pages' })).getByRole('checkbox', { name: 'Home' }))
    expect(screen.getByText('2 items in the file, 1 item of them because your selection needs it.')).toBeTruthy()
    expect(screen.getByText(/needed by your selection/)).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export 2 items' }))
    })
    expect(client.calls.exportPackage).toEqual([{ items: ['page/home'], dependencies: true }])
    expect(download).toHaveBeenCalledWith('aglyn-acme.json', expect.any(Blob))
    expect(onClose).toHaveBeenCalled()
  })

  it('leaves dependencies out when asked, and selects a whole kind at once', async () => {
    const { client } = await renderDialog()
    fireEvent.click(screen.getByLabelText('Include what they need'))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pages (2)' }))
    expect(screen.getByText('2 items in the file.')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export 2 items' }))
    })
    expect(client.calls.exportPackage).toEqual([{ items: ['page/home', 'page/about'], dependencies: false }])
  })

  it('exports everything without a selection', async () => {
    const { client } = await renderDialog()
    expect(screen.getByRole('button', { name: 'Export selected' }).hasAttribute('disabled')).toBe(true)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export everything' }))
    })
    expect(client.calls.exportPackage).toEqual([{}])
  })
})
