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
 * The media picker's Stock photos tab (AGL-4066): offered wherever an image
 * can be placed, a photo is chosen before it is used, and Use this image
 * copies it into the library and places that copy as a library pick.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import MediaPickerDialog from './media-picker-dialog.component'

const HIT = {
  ref: { query: 'yoga', orientation: 'any', id: '7101001' },
  sourceKey: 'pixabay:7101001',
  width: 1280,
  height: 853,
  photographer: 'StudioLight',
  pageUrl: 'https://pixabay.com/photos/yoga-7101001/',
  tags: ['yoga'],
  credit: 'Photo by StudioLight on Pixabay.',
  license: 'Pixabay Content License',
  licenseUrl: 'https://pixabay.com/service/license-summary/',
  attributionRequired: false,
}

const STORED = {
  $id: 'new-1',
  fileName: 'pixabay-7101001.jpg',
  contentType: 'image/jpeg',
  cdnPath: '/api/media/cdn/h1/new-1',
  url: 'https://storage.example/new-1',
  width: 1280,
  height: 853,
}

const mockImport = jest.fn()
const mockPaneTargets: unknown[] = []

jest.mock('./stock-photos-pane.component', () => {
  const { useEffect } = jest.requireActual('react')
  return {
    __esModule: true,
    default: (props: {
      target: unknown
      libraryName: string
      onClient: (client: unknown) => void
      onSelect: (hit: unknown, context: unknown) => void
    }) => {
      useEffect(() => {
        props.onClient({ importPhoto: mockImport })
        return () => props.onClient(null)
      }, [])
      mockPaneTargets.push(props.target)
      return (
        <div data-testid="stock-pane" data-library={props.libraryName}>
          <button onClick={() => props.onSelect(HIT, { previewUrl: 'blob:p1', libraryLabel: 'Pixabay' })}>{'yoga photo'}</button>
        </div>
      )
    },
  }
})
jest.mock('./media-library.component', () => ({
  __esModule: true,
  default: () => <div data-testid="library-stub" />,
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useHostOrgId: () => undefined,
}))
jest.mock('notistack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

beforeEach(() => {
  mockImport.mockReset()
  mockPaneTargets.length = 0
})

function open(overrides: Partial<Parameters<typeof MediaPickerDialog>[0]> = {}) {
  const onPick = jest.fn()
  const onClose = jest.fn()
  render(<MediaPickerDialog hostId="h1" open onClose={onClose} onPick={onPick} {...overrides} />)
  return { onPick, onClose }
}

describe('the media picker’s Stock photos tab', () => {
  it('is offered for an image, and not for a film, a PDF or audio', () => {
    open({ kind: 'image' })
    expect(screen.getByRole('tab', { name: 'Stock photos' })).toBeTruthy()
  })

  it.each(['video', 'pdf', 'audio'] as const)('is not offered in a picker for %s', (kind) => {
    open({ kind })
    expect(screen.queryByRole('tab', { name: 'Stock photos' })).toBeNull()
  })

  it('copies the chosen photo into this site’s library and places that copy', async () => {
    mockImport.mockResolvedValue({ status: 'ok', reused: false, media: STORED })
    const { onPick, onClose } = open()
    fireEvent.click(screen.getByRole('tab', { name: 'Stock photos' }))
    expect(screen.getByTestId('stock-pane').getAttribute('data-library')).toBe("this site's library")
    expect(mockPaneTargets[0]).toEqual({ hostId: 'h1' })
    const confirm = screen.getByRole('button', { name: 'Use this image' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)

    fireEvent.click(screen.getByText('yoga photo'))
    expect(within(screen.getByTestId('stock-photo-details')).getByText('Photo by StudioLight on Pixabay.')).toBeTruthy()
    expect(onPick).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Use this image' }))
    })
    expect(mockImport).toHaveBeenCalledWith(HIT.ref)
    expect(onPick).toHaveBeenCalledWith(STORED, { cdnScope: 'h1' })
    expect(onClose).toHaveBeenCalled()
  })

  it('says why a photo could not be used, and places nothing', async () => {
    mockImport.mockResolvedValue({ status: 'refused', message: 'Storage limit reached (100 MB)' })
    const { onPick } = open()
    fireEvent.click(screen.getByRole('tab', { name: 'Stock photos' }))
    fireEvent.click(screen.getByText('yoga photo'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Use this image' }))
    })
    expect(within(screen.getByTestId('stock-photo-details')).getByText('Storage limit reached (100 MB)')).toBeTruthy()
    expect(onPick).not.toHaveBeenCalled()
  })

  it('saves to the workspace’s shared library when no site is open', async () => {
    mockImport.mockResolvedValue({ status: 'ok', reused: true, media: { ...STORED, cdnPath: '/api/media/cdn/org:o1/new-1', visibleTo: ['org'] } })
    const { onPick } = open({ hostId: undefined, orgId: 'o1' })
    fireEvent.click(screen.getByRole('tab', { name: 'Stock photos' }))
    expect(mockPaneTargets[0]).toEqual({ orgId: 'o1' })
    expect(screen.getByTestId('stock-pane').getAttribute('data-library')).toBe("your workspace's shared library")
    fireEvent.click(screen.getByText('yoga photo'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Use this image' }))
    })
    expect(onPick.mock.calls[0][1]).toEqual({ cdnScope: 'org:o1' })
  })

  it('goes back to the library tab when opened again for a film', () => {
    const onPick = jest.fn()
    const { rerender } = render(<MediaPickerDialog hostId="h1" open onClose={jest.fn()} onPick={onPick} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Stock photos' }))
    expect(screen.getByTestId('stock-pane')).toBeTruthy()
    rerender(<MediaPickerDialog hostId="h1" open onClose={jest.fn()} onPick={onPick} kind="video" />)
    expect(screen.queryByTestId('stock-pane')).toBeNull()
    expect(screen.getByTestId('library-stub')).toBeTruthy()
  })
})
