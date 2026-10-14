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
import { contentBelow, useViewportFill } from './use-viewport-fill'

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

  describe('with content below the element (AGL-3710)', () => {
    /**
     * A console page in miniature: a container with bottom padding holding
     * the element, then a footer, then a fixed dock that takes no room.
     * Rects are given per test id, in viewport coordinates at scroll 0.
     */
    const Page = ({ min }: { min?: number }) => (
      <div data-testid="shell">
        <div data-testid="header" />
        <div data-testid="container" style={{ paddingBottom: '24px' }}>
          <Probe {...(min === undefined ? {} : { min })} />
        </div>
        <footer data-testid="footer" style={{ marginBottom: '8px' }} />
        <div data-testid="dock" style={{ position: 'fixed' }} />
      </div>
    )

    const layout = (rects: Record<string, { top: number; bottom: number }>) =>
      jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        const rect = rects[this.dataset['testid'] ?? ''] ?? { top: 0, bottom: 0 }
        return {
          ...rect,
          left: 0,
          right: 0,
          width: 0,
          height: rect.bottom - rect.top,
          x: 0,
          y: rect.top,
          toJSON: () => ({}),
        }
      })

    it('leaves room for the padding and the footer, so the page fits the window', () => {
      window.innerHeight = 900
      // Element 300 → 1200 as first rendered; padding 24, a 48px gap, then
      // a 100px footer with an 8px bottom margin.
      layout({
        probe: { top: 300, bottom: 1200 },
        container: { top: 280, bottom: 1224 },
        footer: { top: 1272, bottom: 1372 },
        shell: { top: 0, bottom: 1380 },
        dock: { top: 9000, bottom: 9999 },
      })
      render(<Page />)
      // 900 − 300 − (24 + 48 + 100 + 8) = 420
      expect(screen.getByTestId('probe').textContent).toBe('420px')
    })

    it('does not count the element or a stretched parent, so its own height cannot feed back', () => {
      window.innerHeight = 900
      const tall = {
        probe: { top: 300, bottom: 1200 },
        container: { top: 280, bottom: 1224 },
        footer: { top: 1272, bottom: 1372 },
      }
      // The same page with the element at its answer, its parent stretched
      // by a min-height shell to well past it.
      const fitted = {
        probe: { top: 300, bottom: 720 },
        container: { top: 280, bottom: 744 },
        footer: { top: 792, bottom: 892 },
      }
      layout(tall)
      render(<Page />)
      const element = screen.getByTestId('probe')
      const before = contentBelow(element)
      jest.restoreAllMocks()
      layout(fitted)
      expect(contentBelow(element)).toBe(before)
      expect(before).toBe(180)
    })

    it('skips boxes that take no room in the flow', () => {
      window.innerHeight = 900
      layout({
        probe: { top: 300, bottom: 500 },
        container: { top: 280, bottom: 524 },
        footer: { top: 524, bottom: 524 },
        dock: { top: 9000, bottom: 9999 },
      })
      render(<Page />)
      // The fixed dock below everything adds nothing: 24 + 0 + 8.
      expect(contentBelow(screen.getByTestId('probe'))).toBe(32)
    })

    it('still stops at the minimum in a short window', () => {
      window.innerHeight = 600
      layout({
        probe: { top: 300, bottom: 1200 },
        container: { top: 280, bottom: 1224 },
        footer: { top: 1272, bottom: 1372 },
      })
      render(<Page min={480} />)
      expect(screen.getByTestId('probe').textContent).toBe('480px')
    })
  })
})
