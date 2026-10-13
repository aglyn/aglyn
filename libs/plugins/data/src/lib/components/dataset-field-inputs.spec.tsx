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
 * The record editor's Image and Page inputs (AGL-3763): both are pickers, so
 * a site owner filling a record never types an address or a path.
 */

import { MediaPickerContext } from '@aglyn/aglyn'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import {
  DatasetImageFieldInput,
  DatasetPageFieldInput,
  DatasetRecordSiteContext,
} from './dataset-field-inputs.component'

let screenDocs: unknown[] = []
const listened: Array<string | null> = []
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreCollection: (build: () => string | null) => {
    listened.push(build())
    return { data: screenDocs, status: 'success', fromCache: false }
  },
}))
jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) => segments.join('/'),
  query: (path: string) => path,
  limit: () => 'limit',
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({ MdiIcon: () => null }))

beforeEach(() => {
  screenDocs = []
  listened.length = 0
})

describe('the Image input', () => {
  it('chooses a photo from the media library and stores it by reference', async () => {
    const onChange = jest.fn()
    const pickMedia = jest.fn().mockResolvedValue({
      url: '/api/media/cdn/org:org-1/m-1',
      mediaId: 'm-1',
      mediaScope: 'org:org-1',
    })
    render(
      <MediaPickerContext.Provider value={{ pickMedia }}>
        <DatasetImageFieldInput value="" label="Photo" onChange={onChange} />
      </MediaPickerContext.Provider>,
    )
    expect(screen.queryByLabelText('Photo link')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Choose from media' }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('media:org:org-1/m-1'))
    expect(pickMedia).toHaveBeenCalledWith({ kind: 'image' })
  })

  it('reads a CDN path back to a reference when the picker names no id', async () => {
    const onChange = jest.fn()
    const pickMedia = jest.fn().mockResolvedValue({ url: '/api/media/cdn/host-1/m-2' })
    render(
      <MediaPickerContext.Provider value={{ pickMedia }}>
        <DatasetImageFieldInput value="" onChange={onChange} />
      </MediaPickerContext.Provider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Choose from media' }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('media:host-1/m-2'))
  })

  it('previews a chosen photo and removes it', () => {
    const onChange = jest.fn()
    const { container } = render(
      <MediaPickerContext.Provider value={{ pickMedia: jest.fn() }}>
        <DatasetImageFieldInput value="media:org:org-1/m-1" onChange={onChange} />
      </MediaPickerContext.Provider>,
    )
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/api/media/cdn/org:org-1/m-1')
    expect(screen.getByRole('button', { name: 'Change photo' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('keeps an https link as the advanced option, open when one is stored', () => {
    const onChange = jest.fn()
    render(
      <MediaPickerContext.Provider value={{ pickMedia: jest.fn() }}>
        <DatasetImageFieldInput value="https://images.example.com/a.jpg" onChange={onChange} />
      </MediaPickerContext.Provider>,
    )
    const link = screen.getByLabelText('Photo link') as HTMLInputElement
    expect(link.value).toBe('https://images.example.com/a.jpg')
    fireEvent.change(link, { target: { value: 'https://images.example.com/b.jpg' } })
    expect(onChange).toHaveBeenCalledWith('https://images.example.com/b.jpg')
  })
})

describe('the Page input', () => {
  it('lists the site’s pages by name and stores the picked one as a page reference', async () => {
    screenDocs = [
      { $id: 'drywall', displayName: 'Drywall repair' },
      { $id: 'home', displayName: 'Home' },
      { $id: 'welcome-email', displayName: 'Welcome email', kind: 'email' },
      { $id: 'services', displayName: 'Services', kind: 'group' },
      { $id: 'old', displayName: 'Old page', deletedAt: 1 },
    ]
    const onChange = jest.fn()
    render(
      <DatasetRecordSiteContext.Provider value={{ hostId: 'host-1' }}>
        <DatasetPageFieldInput value="" label="Details page" onChange={onChange} />
      </DatasetRecordSiteContext.Provider>,
    )
    expect(listened).toContain('hosts/host-1/screens')
    fireEvent.mouseDown(screen.getByRole('combobox'))
    const options = within(screen.getByRole('listbox')).getAllByRole('option').map((option) => option.textContent)
    expect(options).toEqual(['No page', 'Drywall repair', 'Home'])
    fireEvent.click(screen.getByRole('option', { name: 'Drywall repair' }))
    expect(onChange).toHaveBeenCalledWith('screen:drywall')
  })

  it('shows the chosen page by name', () => {
    screenDocs = [{ $id: 'drywall', displayName: 'Drywall repair' }]
    render(
      <DatasetRecordSiteContext.Provider value={{ hostId: 'host-1' }}>
        <DatasetPageFieldInput value="screen:drywall" label="Details page" onChange={jest.fn()} />
      </DatasetRecordSiteContext.Provider>,
    )
    expect(screen.getByRole('combobox').textContent).toBe('Drywall repair')
  })

  it('reads no pages and says where to go when no site is open', () => {
    render(<DatasetPageFieldInput value="" label="Details page" onChange={jest.fn()} />)
    expect(listened.every((path) => path === null)).toBe(true)
    expect(screen.getByText(/Open this dataset from that site’s Data page/)).toBeTruthy()
  })
})
