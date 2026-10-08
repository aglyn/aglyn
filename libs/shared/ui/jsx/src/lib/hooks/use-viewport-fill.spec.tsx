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

import { act, render, screen } from '@testing-library/react'
import { useViewportFill } from './use-viewport-fill'

const Probe = ({ min }: { min?: number }) => {
  const fill = useViewportFill(min === undefined ? {} : { min })
  return (
    <div ref={fill.ref} data-testid="probe">
      {fill.height}
    </div>
  )
}

const placeAt = (top: number) =>
  jest
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockReturnValue({ top, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) })

describe('useViewportFill', () => {
  afterEach(() => jest.restoreAllMocks())

  it('fills from where the element starts to the bottom of the window', () => {
    window.innerHeight = 1000
    placeAt(220)
    render(<Probe />)
    expect(screen.getByTestId('probe').textContent).toBe('780px')
  })

  it('re-measures when the window resizes', () => {
    window.innerHeight = 1000
    placeAt(220)
    render(<Probe />)
    act(() => {
      window.innerHeight = 800
      window.dispatchEvent(new Event('resize'))
    })
    expect(screen.getByTestId('probe').textContent).toBe('580px')
  })

  it('never answers less than the minimum', () => {
    window.innerHeight = 600
    placeAt(400)
    render(<Probe min={480} />)
    expect(screen.getByTestId('probe').textContent).toBe('480px')
  })
})
