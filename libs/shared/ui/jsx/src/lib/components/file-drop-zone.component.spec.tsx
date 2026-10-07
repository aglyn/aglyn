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
import { FileDropZone, fileMatchesAccept } from './file-drop-zone.component'

const font = (name: string, type = '') => new File([new Uint8Array([1, 2, 3])], name, { type })

describe('FileDropZone (AGL-3656)', () => {
  it('matches files against an accept list of extensions, types and wildcards', () => {
    const accept = '.woff2,.ttf,font/otf,image/*'
    expect(fileMatchesAccept(font('Acme.WOFF2'), accept)).toBe(true)
    expect(fileMatchesAccept(font('acme.otf', 'font/otf'), accept)).toBe(true)
    expect(fileMatchesAccept(font('logo.png', 'image/png'), accept)).toBe(true)
    expect(fileMatchesAccept(font('notes.txt', 'text/plain'), accept)).toBe(false)
    expect(fileMatchesAccept(font('anything.bin'), undefined)).toBe(true)
  })

  it('hands back dropped files it accepts and reports the rest', () => {
    const onFiles = jest.fn()
    const onRejected = jest.fn()
    render(<FileDropZone label="Drop fonts" accept=".ttf" onFiles={onFiles} onRejected={onRejected} />)
    const zone = screen.getByRole('button', { name: /drop fonts/i })
    const files = [font('a.ttf'), font('b.txt')]
    fireEvent.drop(zone, { dataTransfer: { files } })
    expect(onFiles).toHaveBeenCalledWith([files[0]])
    expect(onRejected).toHaveBeenCalledWith([files[1]])
  })

  it('hands back chosen files from its file input', () => {
    const onFiles = jest.fn()
    const { container } = render(<FileDropZone label="Drop fonts" onFiles={onFiles} />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const files = [font('a.woff2')]
    fireEvent.change(input, { target: { files } })
    expect(onFiles).toHaveBeenCalledWith(files)
  })

  it('takes nothing while disabled', () => {
    const onFiles = jest.fn()
    render(<FileDropZone label="Drop fonts" onFiles={onFiles} disabled />)
    fireEvent.drop(screen.getByRole('button', { name: /drop fonts/i }), { dataTransfer: { files: [font('a.ttf')] } })
    expect(onFiles).not.toHaveBeenCalled()
  })
})
