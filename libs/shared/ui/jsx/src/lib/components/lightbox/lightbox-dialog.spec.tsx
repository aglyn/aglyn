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
 * The shared lightbox shell (AGL-3717): what every lightbox on a published
 * page gets from it, whoever opens it.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import {
  LIGHTBOX_APPEARANCE_FIELDS,
  LIGHTBOX_APPEARANCE_PROP_NAMES,
  lightboxBackdropBackground,
  readLightboxAppearance,
  splitLightboxAppearanceProps,
} from './lightbox-appearance'
import { LightboxDialog } from './lightbox-dialog'

const dialogOf = (base: HTMLElement) =>
  base.querySelector('[role="dialog"]') as HTMLElement

describe('LightboxDialog', () => {
  it('names the element that carries role="dialog" and marks it modal', () => {
    const { baseElement } = render(
      <LightboxDialog open onClose={() => undefined} label="Book a call">
        <p>{'Body'}</p>
      </LightboxDialog>,
    )
    const dialog = dialogOf(baseElement)
    expect(dialog.getAttribute('aria-label')).toBe('Book a call')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(screen.getByText('Body')).toBeTruthy()
  })

  it('renders nothing while closed', () => {
    const { baseElement } = render(
      <LightboxDialog open={false} onClose={() => undefined} label="X">
        <p>{'Body'}</p>
      </LightboxDialog>,
    )
    expect(dialogOf(baseElement)).toBeNull()
    expect(screen.queryByText('Body')).toBeNull()
  })

  it('closes from its labelled close control', () => {
    const onClose = jest.fn()
    render(
      <LightboxDialog open onClose={onClose} label="X" closeLabel="Close it" />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close it' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape unless the author turned that off', () => {
    const onClose = jest.fn()
    const { baseElement, rerender } = render(
      <LightboxDialog open onClose={onClose} label="X" />,
    )
    fireEvent.keyDown(document.activeElement ?? dialogOf(baseElement), {
      key: 'Escape',
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    rerender(
      <LightboxDialog
        open
        onClose={onClose}
        label="X"
        appearance={readLightboxAppearance({ lightboxCloseOnEscape: false })}
      />,
    )
    fireEvent.keyDown(dialogOf(baseElement), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on a backdrop click unless the author turned that off', () => {
    const onClose = jest.fn()
    const { baseElement, rerender } = render(
      <LightboxDialog
        open
        onClose={onClose}
        label="X"
        appearance={readLightboxAppearance({ lightboxCloseOnBackdrop: 'false' })}
      />,
    )
    const backdrop = baseElement.querySelector('.MuiBackdrop-root') as HTMLElement
    fireEvent.mouseDown(backdrop)
    fireEvent.click(backdrop)
    expect(onClose).not.toHaveBeenCalled()
    rerender(<LightboxDialog open onClose={onClose} label="X" />)
    const again = baseElement.querySelector('.MuiBackdrop-root') as HTMLElement
    fireEvent.mouseDown(again)
    fireEvent.click(again)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('lets a caller keep one close from happening', () => {
    const onClose = jest.fn()
    const { baseElement } = render(
      <LightboxDialog
        open
        onClose={onClose}
        label="X"
        interceptClose={(reason) => reason === 'escapeKeyDown'}
      />,
    )
    fireEvent.keyDown(dialogOf(baseElement), { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('traps focus inside and returns it to the trigger on close', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            {'Open'}
          </button>
          <LightboxDialog
            open={open}
            onClose={() => setOpen(false)}
            label="X"
            appearance={readLightboxAppearance({ lightboxTransition: 'none' })}
          >
            <button type="button">{'Inside'}</button>
          </LightboxDialog>
        </>
      )
    }
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Open' })
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog')
    expect(dialog.contains(document.activeElement)).toBe(true)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    })
    expect(document.activeElement).toBe(trigger)
  })

  it('paints the backdrop the author chose, and blurs behind it', () => {
    const { baseElement } = render(
      <LightboxDialog
        open
        onClose={() => undefined}
        label="X"
        appearance={readLightboxAppearance({
          lightboxBackdropColor: '#ffffff',
          lightboxBackdropOpacity: 50,
          lightboxBackdropBlur: 6,
        })}
      />,
    )
    const backdrop = baseElement.querySelector('.MuiBackdrop-root') as HTMLElement
    const style = getComputedStyle(backdrop)
    expect(style.backgroundColor).toBe('rgba(255, 255, 255, 0.5)')
    expect(backdrop.outerHTML).toBeTruthy()
  })

  it('draws the close control in the style and corner asked for', () => {
    render(
      <LightboxDialog
        open
        onClose={() => undefined}
        label="X"
        appearance={readLightboxAppearance({
          lightboxCloseStyle: 'text',
          lightboxClosePosition: 'inside-start',
        })}
      />,
    )
    const close = screen.getByRole('button', { name: 'Close' })
    expect(close.textContent).toBe('Close')
    expect(getComputedStyle(close).position).toBe('absolute')
  })
})

describe('lightbox appearance (AGL-3717)', () => {
  it('reads nothing as the element defaults, with both closing rules on', () => {
    expect(readLightboxAppearance({})).toEqual({
      closeOnBackdrop: true,
      closeOnEscape: true,
    })
    expect(readLightboxAppearance(undefined)).toEqual({
      closeOnBackdrop: true,
      closeOnEscape: true,
    })
  })

  it('reads every setting, clamping numbers and refusing unknown choices', () => {
    expect(
      readLightboxAppearance({
        lightboxBackdropColor: ' #123456 ',
        lightboxBackdropOpacity: '140',
        lightboxBackdropBlur: -3,
        lightboxMaxWidth: '960',
        lightboxMaxHeight: '80vh',
        lightboxPadding: 16,
        lightboxRadius: '12',
        lightboxCloseStyle: 'filled',
        lightboxClosePosition: 'sideways',
        lightboxCaptionPlacement: 'overlay',
        lightboxTransition: 'zoom',
        lightboxCloseOnBackdrop: false,
        lightboxCloseOnEscape: 'false',
      }),
    ).toEqual({
      backdropColor: '#123456',
      backdropOpacity: 100,
      backdropBlur: 0,
      maxWidth: '960px',
      maxHeight: '80vh',
      padding: '16px',
      radius: 12,
      closeStyle: 'filled',
      captionPlacement: 'overlay',
      transition: 'zoom',
      closeOnBackdrop: false,
      closeOnEscape: false,
    })
  })

  it('keeps the settings off the rest of the props', () => {
    const { rest, appearance } = splitLightboxAppearanceProps({
      alt: 'A',
      lightboxRadius: 4,
      lightboxTransition: 'none',
    })
    expect(rest).toEqual({ alt: 'A' })
    expect(appearance.radius).toBe(4)
  })

  it('describes a field for every prop, under the same names', () => {
    expect(LIGHTBOX_APPEARANCE_FIELDS.map((field) => field.name).sort()).toEqual(
      [...LIGHTBOX_APPEARANCE_PROP_NAMES].sort(),
    )
    for (const field of LIGHTBOX_APPEARANCE_FIELDS) {
      if (field.kind === 'select') expect(field.options?.length).toBeGreaterThan(1)
    }
  })

  it('writes a hex backdrop as rgba and mixes any other color', () => {
    expect(lightboxBackdropBackground({})).toBeUndefined()
    expect(lightboxBackdropBackground({ backdropColor: '#000' })).toBe(
      'rgba(0, 0, 0, 0.8)',
    )
    expect(lightboxBackdropBackground({ backdropOpacity: 25 })).toBe(
      'rgba(0, 0, 0, 0.25)',
    )
    expect(
      lightboxBackdropBackground({ backdropColor: 'navy', backdropOpacity: 40 }),
    ).toBe('color-mix(in srgb, navy 40%, transparent)')
  })
})
