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
 * The media picker shows a file before it uses it: a click opens the file's
 * details beside the files, and only the confirm button hands it back.
 */

import { fireEvent, render, screen, within } from '@testing-library/react'
import MediaPickerDialog, { mediaPickerConfirmLabel } from './media-picker-dialog.component'

const LOGO = {
  $id: 'FsZiR8vTA3',
  fileName: 'aglyn-logo-mark-padded.png',
  contentType: 'image/png',
  sizeBytes: 20151,
  width: 1024,
  height: 1024,
  alt: 'Aglyn logo mark',
  cdnPath: '/api/media/cdn/h1/FsZiR8vTA3',
  url: 'https://storage.example/FsZiR8vTA3',
}

jest.mock('./media-library.component', () => ({
  __esModule: true,
  default: (props: { onSelect?: (media: unknown) => void; pickedId?: string }) => (
    <div data-testid="library-stub" data-picked={props.pickedId ?? ''}>
      <button onClick={() => props.onSelect?.(LOGO)}>{'logo card'}</button>
      <button onClick={() => props.onSelect?.({ ...LOGO, $id: 'priv1', private: true })}>
        {'private card'}
      </button>
    </div>
  ),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useHostOrgId: () => undefined,
}))
jest.mock('notistack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('./media-file-info.component', () => ({
  MediaFactRows: ({ facts }: { facts: Array<{ label: string; value: string }> }) => (
    <dl>
      {facts.map((fact) => (
        <div key={fact.label}>
          <dt>{fact.label}</dt>
          <dd>{fact.value}</dd>
        </div>
      ))}
    </dl>
  ),
}))

function open(overrides: Partial<Parameters<typeof MediaPickerDialog>[0]> = {}) {
  const onPick = jest.fn()
  const onClose = jest.fn()
  render(
    <MediaPickerDialog hostId="h1" open onClose={onClose} onPick={onPick} {...overrides} />,
  )
  return { onPick, onClose }
}

describe('choosing a file in the media picker', () => {
  it('shows the clicked file’s details and places nothing until confirmed', () => {
    const { onPick, onClose } = open()
    const confirm = screen.getByRole('button', { name: 'Use this file' })
    expect((confirm as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByText('logo card'))
    expect(onPick).not.toHaveBeenCalled()
    const details = screen.getByTestId('media-picker-details')
    expect(within(details).getByText('aglyn-logo-mark-padded.png')).toBeTruthy()
    expect(within(details).getByText('Aglyn logo mark')).toBeTruthy()
    expect(within(details).getByText('FsZiR8vTA3')).toBeTruthy()
    expect(screen.getByTestId('library-stub').getAttribute('data-picked')).toBe('FsZiR8vTA3')

    fireEvent.click(screen.getByRole('button', { name: 'Use this image' }))
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick.mock.calls[0][0].$id).toBe('FsZiR8vTA3')
    expect(onPick.mock.calls[0][1]).toEqual({ cdnScope: 'h1' })
    expect(onClose).toHaveBeenCalled()
  })

  it('says why a private file cannot be placed, and will not place it', () => {
    const { onPick } = open()
    fireEvent.click(screen.getByText('private card'))
    expect(
      within(screen.getByTestId('media-picker-details')).getByText(/That file is private/),
    ).toBeTruthy()
    const confirm = screen.getByRole('button', { name: 'Use this image' })
    expect((confirm as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(confirm)
    expect(onPick).not.toHaveBeenCalled()
  })

  it('places a private file for a caller that signs its own links', () => {
    const { onPick } = open({ allowPrivate: true })
    fireEvent.click(screen.getByText('private card'))
    fireEvent.click(screen.getByRole('button', { name: 'Use this image' }))
    expect(onPick).toHaveBeenCalledTimes(1)
  })
})

describe('the confirm button names what it places', () => {
  it('by the file, else by the kind the picker takes', () => {
    expect(mediaPickerConfirmLabel('image/png')).toBe('Use this image')
    expect(mediaPickerConfirmLabel('video/mp4')).toBe('Use this video')
    expect(mediaPickerConfirmLabel('audio/mpeg')).toBe('Use this audio')
    expect(mediaPickerConfirmLabel('application/pdf')).toBe('Use this PDF')
    expect(mediaPickerConfirmLabel('application/zip')).toBe('Use this file')
    expect(mediaPickerConfirmLabel(undefined, 'video')).toBe('Use this video')
    expect(mediaPickerConfirmLabel(undefined)).toBe('Use this file')
  })
})
