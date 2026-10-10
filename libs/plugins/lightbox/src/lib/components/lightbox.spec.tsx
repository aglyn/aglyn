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
 * The Lightbox container (AGL-3717): hidden until the interactions system's
 * existing visibility steps open it, its children absent until then, and the
 * keyboard handed back to whatever opened it.
 */

import * as Aglyn from '@aglyn/aglyn'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import LightboxElement, { lightboxPresets, lightboxSchema } from './lightbox'

const SELECTOR = '[data-aglyn="leaf:box-1"]'

const page = (props: Record<string, unknown> = {}) => (
  <>
    <button
      type="button"
      onClick={() => Aglyn.runElementVisibilityStep('show', SELECTOR)}
    >
      {'Book a call'}
    </button>
    <LightboxElement
      {...{ 'data-aglyn': 'leaf:box-1' }}
      label="Booking"
      lightboxTransition="none"
      {...props}
    >
      <p>{'Pick a time'}</p>
      <button type="button" onClick={() => Aglyn.runElementVisibilityStep('hide', SELECTOR)}>
        {'Done'}
      </button>
    </LightboxElement>
  </>
)

const opened = async () => screen.findByRole('dialog', { name: 'Booking' })

afterEach(() => Aglyn.resetElementVisibilityChoreography())

describe('the Lightbox container', () => {
  it('ships hidden, with nothing of its contents in the page', () => {
    const html = renderToString(page())
    expect(html).toContain(Aglyn.ELEMENT_HIDDEN_CLASS)
    expect(html).not.toContain('Pick a time')
    render(page())
    expect(screen.queryByText('Pick a time')).toBeNull()
  })

  it('opens from a "Show an element" step and returns focus to the trigger', async () => {
    render(page())
    const trigger = screen.getByRole('button', { name: 'Book a call' })
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = await opened()
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(screen.getByText('Pick a time')).toBeTruthy()
    expect(dialog.contains(document.activeElement)).toBe(true)
    await act(async () => {
      fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
    })
    await waitFor(() => expect(screen.queryByText('Pick a time')).toBeNull())
    expect(document.activeElement).toBe(trigger)
    // Closed by the dialog, it takes the hidden class back, so a toggle opens it.
    const anchor = document.querySelector(SELECTOR) as HTMLElement
    expect(anchor.classList.contains(Aglyn.ELEMENT_HIDDEN_CLASS)).toBe(true)
    act(() => Aglyn.runElementVisibilityStep('toggle', SELECTOR))
    expect(await opened()).toBeTruthy()
  })

  it('closes from a "Hide an element" step inside it', async () => {
    render(page())
    fireEvent.click(screen.getByRole('button', { name: 'Book a call' }))
    await opened()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    })
    await waitFor(() => expect(screen.queryByText('Pick a time')).toBeNull())
  })

  it('names its close control after itself', async () => {
    render(page())
    fireEvent.click(screen.getByRole('button', { name: 'Book a call' }))
    await opened()
    expect(screen.getByRole('button', { name: 'Close Booking' })).toBeTruthy()
  })

  it('keeps open on Escape when the author turned that off', async () => {
    render(page({ lightboxCloseOnEscape: false }))
    fireEvent.click(screen.getByRole('button', { name: 'Book a call' }))
    await opened()
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
    expect(screen.getByText('Pick a time')).toBeTruthy()
  })

  it('never opens on the canvas, and shows its contents there while selected', () => {
    const { rerender } = render(
      <Aglyn.ScreenLinkContext.Provider value={{ suppressNavigation: true, editorInert: true }}>
        {page()}
      </Aglyn.ScreenLinkContext.Provider>,
    )
    expect(screen.getByText('Lightbox · Booking')).toBeTruthy()
    act(() => Aglyn.runElementVisibilityStep('show', SELECTOR))
    expect(screen.queryByRole('dialog')).toBeNull()
    rerender(
      <Aglyn.ScreenLinkContext.Provider value={{ suppressNavigation: true, editorInert: true }}>
        {page({ 'data-aglyn-selected-within': '' })}
      </Aglyn.ScreenLinkContext.Provider>,
    )
    expect(screen.getByText('Pick a time')).toBeTruthy()
  })

  it('keeps its settings off the anchor', () => {
    const html = renderToString(page({ lightboxRadius: 8 }))
    expect(html).not.toMatch(/lightboxradius/i)
  })

  it('offers its name and every appearance setting, and a preset with contents', () => {
    const names = (lightboxSchema.attributes ?? []).map((attribute) => attribute.name)
    expect(names[0]).toBe('label')
    expect(names).toEqual(
      expect.arrayContaining(['lightboxBackdropColor', 'lightboxTransition', 'lightboxCloseOnEscape']),
    )
    expect(lightboxPresets[0].data.nodes?.length).toBeGreaterThan(0)
  })
})
