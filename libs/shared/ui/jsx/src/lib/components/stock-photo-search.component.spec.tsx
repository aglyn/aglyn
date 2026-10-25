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

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createTheme, ThemeProvider } from '@mui/material/styles'
import {
  StockPhotoDetails,
  StockPhotoSearchPanel,
  type StockPhotoDetailsHit,
  type StockPhotoSearchClient,
  STOCK_PHOTO_SEARCH_PAGE,
} from './stock-photo-search.component'

/**
 * The Stock photos tab of the media picker (AGL-4066): it says why there is
 * nothing to search when there is not, shows every result with its
 * photographer and its library, and its thumbnails come from the caller's
 * client, never from an address at the library.
 */

const hit = (n: number): StockPhotoDetailsHit => ({
  ref: { query: 'yoga', orientation: 'any', id: String(n) },
  sourceKey: `pixabay:${n}`,
  width: 1280,
  height: 853,
  photographer: `Photographer ${n}`,
  tags: ['yoga', 'studio'],
  pageUrl: `https://pixabay.com/photos/yoga-${n}/`,
  credit: `Photo by Photographer ${n} on Pixabay.`,
  license: 'Pixabay Content License',
  licenseUrl: 'https://pixabay.com/service/license-summary/',
})

function client(overrides: Partial<StockPhotoSearchClient<StockPhotoDetailsHit>> = {}) {
  return {
    status: jest.fn(async () => ({ status: 'ready' as const, library: { label: 'Pixabay' } })),
    search: jest.fn(async () => ({ status: 'ok' as const, library: { label: 'Pixabay' }, hits: [hit(1), hit(2)] })),
    preview: jest.fn(async () => new Blob([new Uint8Array([1])], { type: 'image/jpeg' })),
    ...overrides,
  }
}

const renderPanel = (api: StockPhotoSearchClient<StockPhotoDetailsHit>, onSelect = jest.fn()) => {
  render(
    <ThemeProvider theme={createTheme()}>
      <StockPhotoSearchPanel client={api} libraryName="this site's library" maxQueryLength={100} onSelect={onSelect} />
    </ThemeProvider>,
  )
  return onSelect
}

const searchFor = async (words: string) => {
  fireEvent.change(await screen.findByRole('textbox', { name: 'Search Pixabay photos' }), { target: { value: words } })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
  })
}

let created = 0
beforeEach(() => {
  created = 0
  Object.assign(URL, {
    createObjectURL: jest.fn(() => `blob:preview-${++created}`),
    revokeObjectURL: jest.fn(),
  })
})
// Previews still arriving when a test ends land inside act.
afterEach(async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})

describe('the Stock photos tab', () => {
  it('says plainly why there is nothing to search on a deployment with no library', async () => {
    renderPanel(client({ status: jest.fn(async () => ({ status: 'unconfigured' as const, message: 'Stock photos are not set up on this Aglyn deployment.' })) }))
    expect(await screen.findByText('Stock photos are not set up on this Aglyn deployment.')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('invites a search before showing anything, and names the library and where a photo goes', async () => {
    renderPanel(client())
    expect(await screen.findByText('Find a photo for your page')).toBeTruthy()
    expect(screen.getByText(/Photos come from Pixabay\. The one you use is saved to this site's library/)).toBeTruthy()
  })

  it('shows each result with its photographer and library, and its thumbnail from the client', async () => {
    const api = client()
    const onSelect = renderPanel(api)
    await searchFor('  yoga  ')
    const tiles = await screen.findAllByTestId('stock-photo-tile')
    expect(api.search).toHaveBeenCalledWith('yoga', 'any')
    expect(tiles).toHaveLength(2)
    expect(within(tiles[0]).getByText('Photographer 1')).toBeTruthy()
    expect(within(tiles[0]).getByText('Pixabay')).toBeTruthy()
    await waitFor(() => expect(tiles[0].querySelector('img')?.getAttribute('src')).toMatch(/^blob:preview-/))
    expect(api.preview).toHaveBeenCalledWith(hit(1).ref)

    fireEvent.click(tiles[1])
    expect(onSelect).toHaveBeenCalledWith(hit(2), { previewUrl: expect.stringMatching(/^blob:/), libraryLabel: 'Pixabay' })
  })

  it('searches again in the shape chosen', async () => {
    const api = client()
    renderPanel(api)
    await searchFor('yoga')
    await screen.findAllByTestId('stock-photo-tile')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Portrait' }))
    })
    await waitFor(() => expect(api.search).toHaveBeenLastCalledWith('yoga', 'vertical'))
  })

  it('tells a busy library apart from no results, and offers to try again', async () => {
    const search = jest
      .fn()
      .mockResolvedValueOnce({ status: 'busy', message: 'Pixabay is busy right now. Try again in a minute.' })
      .mockResolvedValueOnce({ status: 'ok', library: { label: 'Pixabay' }, hits: [] })
    renderPanel(client({ search }))
    await searchFor('yoga')
    expect(await screen.findByText('Pixabay is busy right now. Try again in a minute.')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    })
    expect(await screen.findByText('No photos found for “yoga”')).toBeTruthy()
  })

  it('shows a page of results at a time, fetching previews only for those on screen', async () => {
    const many = Array.from({ length: STOCK_PHOTO_SEARCH_PAGE + 5 }, (_, index) => hit(index + 1))
    const api = client({ search: jest.fn(async () => ({ status: 'ok' as const, library: { label: 'Pixabay' }, hits: many })) })
    renderPanel(api)
    await searchFor('yoga')
    expect(await screen.findAllByTestId('stock-photo-tile')).toHaveLength(STOCK_PHOTO_SEARCH_PAGE)
    await waitFor(() => expect(api.preview).toHaveBeenCalledTimes(STOCK_PHOTO_SEARCH_PAGE))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Show more photos' }))
    })
    expect(screen.getAllByTestId('stock-photo-tile')).toHaveLength(STOCK_PHOTO_SEARCH_PAGE + 5)
    await waitFor(() => expect(api.preview).toHaveBeenCalledTimes(STOCK_PHOTO_SEARCH_PAGE + 5))
  })
})

describe('the chosen stock photo', () => {
  it('shows who took it, the credit kept, the license and where it will be saved', () => {
    render(
      <ThemeProvider theme={createTheme()}>
        <StockPhotoDetails
          hit={{ ...hit(1), photographerUrl: 'https://pixabay.com/users/p-1/' }}
          previewUrl="blob:preview-1"
          libraryLabel="Pixabay"
          libraryName="this site's library"
          error="Storage limit reached (100 MB)"
        />
      </ThemeProvider>,
    )
    const details = screen.getByTestId('stock-photo-details')
    expect(within(details).getByRole('link', { name: 'Photographer 1' }).getAttribute('href')).toBe('https://pixabay.com/users/p-1/')
    expect(within(details).getByText('Photo by Photographer 1 on Pixabay.')).toBeTruthy()
    expect(within(details).getByRole('link', { name: 'Pixabay Content License' }).getAttribute('rel')).toBe('noopener noreferrer')
    expect(within(details).getByText('1280 × 853 pixels')).toBeTruthy()
    expect(within(details).getByText('Storage limit reached (100 MB)')).toBeTruthy()
    expect(within(details).getByText(/a copy is saved to this site's library/)).toBeTruthy()
  })
})
