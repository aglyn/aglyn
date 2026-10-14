/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://acme.aglyn.app/?aglyn-pick=1"}
 *
 * Pragmas must stay in the FIRST block comment — behind the license header
 * they are silently ignored.
 *
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

import { act, fireEvent, render, screen } from '@testing-library/react'
import ElementPickMode from '../app/[host]/admin-bar/element-pick-mode'

/**
 * Pick mode on a published page (AGL-3758): what the console's Actions card
 * reads in its picker frame. jsdom has no parent frame, so `window.parent`
 * is this window and the messages land on its own `postMessage`.
 */
describe('element pick mode on a published page', () => {
  it('announces itself, swallows the click, and posts the element picked', () => {
    const post = jest.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    document.body.innerHTML =
      '<a data-aglyn="leaf:cta_1" href="/elsewhere"><span>Book now</span></a>'
    render(<ElementPickMode consoleOrigin="https://app.aglyn.com" />)
    expect(post).toHaveBeenCalledWith(
      { type: 'aglyn-pick-element', event: 'ready' },
      'https://app.aglyn.com',
    )
    expect(screen.getByRole('status').textContent).toMatch(/Click the element/)

    const span = document.querySelector('span') as HTMLElement
    act(() => {
      fireEvent.mouseMove(span)
    })
    expect(screen.getByText('“Book now”')).toBeTruthy()
    const followed = fireEvent.click(span)
    expect(followed).toBe(false)
    expect(post).toHaveBeenLastCalledWith(
      {
        type: 'aglyn-pick-element',
        event: 'picked',
        selector: '[data-aglyn="leaf:cta_1"]',
        label: '“Book now”',
      },
      'https://app.aglyn.com',
    )

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(post).toHaveBeenLastCalledWith(
      { type: 'aglyn-pick-element', event: 'cancel' },
      'https://app.aglyn.com',
    )
    post.mockRestore()
  })
})
