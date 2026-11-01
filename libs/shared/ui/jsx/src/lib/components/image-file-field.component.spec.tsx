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
import { ImageFileField } from './image-file-field.component'

const png = (name = 'logo.png') => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' })

const pick = (file: File) =>
  fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [file] },
  })

beforeEach(() => {
  URL.createObjectURL = jest.fn(() => 'blob:preview')
  URL.revokeObjectURL = jest.fn()
})

describe('ImageFileField (AGL-4119)', () => {
  it('offers a file with the helper text under it while none is held', () => {
    render(<ImageFileField label="Favicon" file={null} onChange={jest.fn()} helperText="Leave this blank." />)
    expect(screen.getByRole('button', { name: 'Choose Favicon' })).toBeTruthy()
    expect(screen.getByText('Leave this blank.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Remove Favicon' })).toBeNull()
  })

  it('hands back the one file chosen', () => {
    const onChange = jest.fn()
    render(<ImageFileField label="Logo" file={null} onChange={onChange} accept="image/png" />)
    const file = png()
    pick(file)
    expect(onChange).toHaveBeenCalledWith(file)
  })

  it('shows the file held with its name, and takes it away again', () => {
    const onChange = jest.fn()
    const { container } = render(<ImageFileField label="Logo" file={png()} onChange={onChange} helperText="Hint" />)
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:preview')
    expect(screen.getByText('logo.png')).toBeTruthy()
    expect(screen.queryByText('Hint')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Logo' }))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('lets go of the preview when the file goes', () => {
    const { rerender } = render(<ImageFileField label="Logo" file={png()} onChange={jest.fn()} />)
    rerender(<ImageFileField label="Logo" file={null} onChange={jest.fn()} />)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
  })

  it('says what was refused, over the helper text', () => {
    render(<ImageFileField label="Logo" file={null} onChange={jest.fn()} helperText="Hint" error="Use a PNG." />)
    expect(screen.getByRole('alert').textContent).toBe('Use a PNG.')
    expect(screen.queryByText('Hint')).toBeNull()
  })

  it('hands a file its accept list refuses to the caller to explain', () => {
    const onChange = jest.fn()
    const onRejected = jest.fn()
    render(<ImageFileField label="Logo" file={null} onChange={onChange} onRejected={onRejected} accept="image/png" />)
    const text = new File(['x'], 'notes.txt', { type: 'text/plain' })
    pick(text)
    expect(onRejected).toHaveBeenCalledWith(text)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('still draws in a browser with no preview to give', () => {
    ;(URL as { createObjectURL?: unknown }).createObjectURL = undefined
    render(<ImageFileField label="Logo" file={png()} onChange={jest.fn()} />)
    expect(screen.getAllByText('logo.png').length).toBeGreaterThan(0)
  })
})
