/**
 * @jest-environment jsdom
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

/**
 * The consent preferences panel arrives when it is asked for, not with the
 * banner every first-time visitor is shown.
 *
 * The panel's MUI dialog, modal, focus trap, transitions and switches are the
 * larger half of what the consent surfaces weigh, and the panel is the one
 * surface a visit has to ask for. So `consent-banner-ui.tsx` fetches its
 * module when Preferences, the pill or a `#aglyn-consent` link opens it — or
 * when the pointer or focus reaches one of those controls — and draws the
 * banner or pill until it is there.
 *
 * The cases share ONE module registry and run in the order written, on
 * purpose: the first proves nothing fetched the panel before it was asked
 * for, the second that a fetch which fails leaves the visitor where they were
 * and the next click retries it, the third that a fetched panel draws in the
 * same tick. The module is mocked only to count its evaluations and to fail
 * one read of its export; what is drawn is the real panel.
 *
 * The source case pins the shape the bundler needs: a static import of the
 * panel module, or of `Dialog`/`Switch` in the banner module, puts the panel
 * back in the chunk every first-time visitor downloads.
 *
 * PLANTED REDS (each run, counts observed):
 *  1. Import the panel module statically in `consent-banner-ui.tsx` → 2 fail:
 *     the evaluation count and the static-import case.
 *  2. Put `Dialog` back in the banner's `@mui/material` import → 1 fails.
 *  3. Keep a failed fetch's rejected promise instead of forgetting it → 2
 *     fail: the retry never draws the panel.
 *  4. Hide the banner as soon as the panel is asked for → 2 fail: the banner
 *     goes blank while the fetch is in flight.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, fireEvent, render, screen } from '@testing-library/react'
import ConsentBannerUi from './consent-banner-ui'

// `var` with no initializer, deliberately: the factory below may run BEFORE
// this module body does — which is exactly what a static import of the panel
// in the banner module causes — and a hoisted `var` lets it count that
// evaluation instead of throwing on a `let` still in its dead zone, so the
// regression reads as the assertion below rather than a crashed suite.
// eslint-disable-next-line no-var
var mockPanelEvaluations: number | undefined
// eslint-disable-next-line no-var
var mockFailNextPanelRead: boolean | undefined

jest.mock('./consent-preferences-dialog', () => {
  mockPanelEvaluations = (mockPanelEvaluations ?? 0) + 1
  const actual = jest.requireActual('./consent-preferences-dialog')
  return {
    __esModule: true,
    default: actual.default,
    get ConsentPreferencesDialog() {
      if (mockFailNextPanelRead) {
        mockFailNextPanelRead = false
        throw new Error('the panel chunk did not arrive')
      }
      return actual.ConsentPreferencesDialog
    },
  }
})

const HOST = 'consent-panel-host'
const panel = () => document.querySelector('[data-aglyn-consent-preferences]')
const banner = () => document.querySelector('[data-aglyn-consent-banner]')

/** Every pending promise and the effects they schedule, settled. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)))

beforeEach(() => window.localStorage.clear())

describe('the preferences panel is fetched when it is asked for', () => {
  it('is not fetched to draw the banner or the pill', () => {
    const ask = render(
      <ConsentBannerUi hostId={HOST} stored={null} posture="opt-in" />,
    )
    expect(banner()).not.toBeNull()
    ask.unmount()
    render(
      <ConsentBannerUi
        hostId={HOST}
        stored={{ v: 1, at: 0, status: 'implied', analytics: true }}
        posture={null}
      />,
    )
    expect(document.querySelector('[data-aglyn-consent-pill]')).not.toBeNull()
    expect(mockPanelEvaluations ?? 0).toBe(0)
  })

  it('keeps the banner up through a failed fetch, and the next click retries', async () => {
    render(<ConsentBannerUi hostId={HOST} stored={null} posture="opt-in" />)
    mockFailNextPanelRead = true

    fireEvent.click(screen.getByRole('button', { name: 'Preferences' }))
    // Asked for and not here yet: the banner stays, so a slow fetch never
    // blanks the one surface the visitor is looking at.
    expect(banner()).not.toBeNull()
    expect(panel()).toBeNull()

    await settle()
    expect(mockPanelEvaluations).toBe(1)
    // The fetch failed: the request is put down and the banner is still the
    // visitor's to answer.
    expect(banner()).not.toBeNull()
    expect(panel()).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Preferences' }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(panel()).not.toBeNull()
    expect(banner()).toBeNull()
  })

  it('draws a fetched panel in the same tick it is asked for', () => {
    render(
      <ConsentBannerUi
        hostId={HOST}
        stored={{ v: 1, at: 0, status: 'implied', analytics: true }}
        posture={null}
      />,
    )
    fireEvent.click(
      document.querySelector('[data-aglyn-consent-pill]') as HTMLElement,
    )
    expect(panel()).not.toBeNull()
    expect(mockPanelEvaluations).toBe(1)
  })
})

describe('the banner module does not carry the panel', () => {
  const read = (file: string) => readFileSync(join(__dirname, file), 'utf8')
  const withoutComments = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const bannerSource = withoutComments(read('consent-banner-ui.tsx'))
  const dialogSource = withoutComments(read('consent-preferences-dialog.tsx'))

  it('reaches the panel module only through a dynamic import', () => {
    expect(bannerSource).toMatch(/\bimport\(\s*['"]\.\/consent-preferences-dialog['"]\s*\)/)
    const staticValueImports = [
      ...bannerSource.matchAll(/^\s*import\s+(?!type\s)[^;]*?from\s*['"]([^'"]+)['"]/gm),
    ].map((match) => match[1])
    expect(staticValueImports).not.toContain('./consent-preferences-dialog')
  })

  it('imports none of the panel-only MUI components', () => {
    const mui = bannerSource.match(/import\s*\{([^}]*)\}\s*from\s*['"]@mui\/material['"]/)
    expect(mui).not.toBeNull()
    const names = (mui?.[1] ?? '').split(',').map((name) => name.trim())
    for (const panelOnly of [
      'Dialog',
      'DialogActions',
      'DialogContent',
      'DialogTitle',
      'FormControlLabel',
      'Switch',
    ]) {
      expect(names).not.toContain(panelOnly)
    }
  })

  it('declares no `use client` in the panel module', () => {
    // Inside @aglyn/aglyn the directive splits the bundler into a duplicate
    // module graph, the failure `consent-banner-ui.tsx` documents.
    expect(dialogSource).not.toMatch(/^\s*(['"])use client\1/m)
  })
})
