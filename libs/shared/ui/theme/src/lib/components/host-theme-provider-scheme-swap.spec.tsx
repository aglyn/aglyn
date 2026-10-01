/**
 * @jest-environment jsdom
 */
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
 * A SCHEME SWAP LANDS ON EVERY ELEMENT AT ONCE (AGL-3449).
 *
 * MUI animates an outlined field's label color. Across a light/dark swap that
 * animation starts from the OLD scheme's value, and a document that is not
 * painting never advances it — so a dark page that hydrated from a light
 * render kept every form label at `rgba(0,0,0,0.6)` on a dark card. The
 * provider turns transitions off for the commit that applies the new scheme,
 * which is only observable from inside that commit: a child's layout effect
 * is the earliest point a style can be read, so that is where these probes
 * look.
 */

import { TextField } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { consoleThemeDark, consoleThemeLight } from '../console.theme'
import { useThemeMode } from '../hocs/create-with-theme-provider'
import {
  SCHEME_SWAP_ATTRIBUTE,
  SUPPRESS_TRANSITIONS_CSS,
  suppressTransitions,
} from '../util/instant-scheme-swap'
import { HostThemeProvider } from './host-theme-provider'

const suppressingSheets = () =>
  document.head.querySelectorAll(`style[${SCHEME_SWAP_ATTRIBUTE}]`)

/**
 * Counts the suppressing sheets added to `<head>` from now on, including any
 * already removed again — the provider takes its sheet back out within the
 * same commit, so what is left in the document afterwards proves nothing.
 */
function watchHead() {
  const records: MutationRecord[] = []
  const observer = new MutationObserver((delivered) => {
    records.push(...delivered)
  })
  observer.observe(document.head, { childList: true })
  return () =>
    [...records, ...observer.takeRecords()]
      .flatMap((record) => [...record.addedNodes])
      .filter(
        (node) =>
          node instanceof HTMLStyleElement &&
          node.hasAttribute(SCHEME_SWAP_ATTRIBUTE),
      ).length
}

/**
 * Every commit the probe took part in: the scheme it rendered, and whether
 * transitions were off when a layout effect could first read a style.
 */
let commits: Array<[scheme: string, suppressed: boolean]> = []

function CommitProbe() {
  const theme = useTheme()
  useLayoutEffect(() => {
    commits.push([theme.palette.mode, suppressingSheets().length > 0])
  })
  return null
}

function Controls() {
  const [, toggleThemeMode] = useThemeMode()
  return (
    <>
      <button type="button" onClick={(e) => toggleThemeMode(e, 'dark')}>
        dark
      </button>
      <button type="button" onClick={(e) => toggleThemeMode(e, 'light')}>
        light
      </button>
    </>
  )
}

const site = (darkScheme?: 'off') => (
  <HostThemeProvider
    theme={darkScheme ? { darkScheme } : undefined}
    fallback={[consoleThemeLight, consoleThemeDark]}
  >
    <TextField label="Name" size="small" />
    <Controls />
    <CommitProbe />
  </HostThemeProvider>
)

const click = (name: string) =>
  fireEvent.click(screen.getByRole('button', { name }))

describe('HostThemeProvider swapping schemes', () => {
  beforeEach(() => {
    commits = []
    document.cookie = 'theme-color-mode=light'
  })

  it('leaves the first render alone, so a server render hydrates untouched', () => {
    const added = watchHead()
    render(site())
    expect(commits).toEqual([['light', false]])
    expect(added()).toBe(0)
  })

  it('applies the new scheme with transitions off, then turns them back on', () => {
    render(site())
    commits = []
    const added = watchHead()
    click('dark')
    expect(commits).toContainEqual(['dark', true])
    expect(commits.filter(([scheme]) => scheme === 'light')).toEqual([])
    expect(added()).toBe(1)
    expect(suppressingSheets()).toHaveLength(0)
  })

  it('does it in both directions', () => {
    render(site())
    click('dark')
    commits = []
    const added = watchHead()
    click('light')
    expect(commits).toContainEqual(['light', true])
    expect(added()).toBe(1)
    expect(suppressingSheets()).toHaveLength(0)
  })

  it('touches nothing on a render that does not change the scheme', () => {
    const view = render(site())
    commits = []
    const added = watchHead()
    view.rerender(site())
    expect(commits).toEqual([['light', false]])
    expect(added()).toBe(0)
  })

  it('turns them off when a page rendered light goes dark at hydration', async () => {
    // A browser that sends no color-scheme hint is served the light document
    // and learns the device is dark only once React has hydrated it.
    document.cookie = 'theme-color-mode=; max-age=0'
    const container = document.createElement('div')
    container.innerHTML = renderToString(site())
    document.body.appendChild(container)
    // jsdom has no `matchMedia`; this one answers as a dark device would.
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({
        matches: query === '(prefers-color-scheme: dark)',
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    })
    try {
      const added = watchHead()
      const root = await act(async () => hydrateRoot(container, site()))
      expect(commits[0]).toEqual(['light', false])
      expect(commits).toContainEqual(['dark', true])
      expect(added()).toBe(1)
      expect(suppressingSheets()).toHaveLength(0)
      act(() => root.unmount())
    } finally {
      Reflect.deleteProperty(window, 'matchMedia')
      container.remove()
    }
  })

  it('touches nothing when the site keeps dark off, since the scheme never moves', () => {
    render(site('off'))
    const added = watchHead()
    click('dark')
    expect(added()).toBe(0)
  })
})

describe('suppressTransitions', () => {
  it('restyles the document before it turns transitions back on', () => {
    const order: string[] = []
    const spy = jest
      .spyOn(window, 'getComputedStyle')
      .mockImplementation(() => {
        order.push(suppressingSheets().length ? 'restyle:off' : 'restyle:on')
        return { getPropertyValue: () => '' } as unknown as CSSStyleDeclaration
      })
    try {
      const release = suppressTransitions(document)
      const [sheet] = suppressingSheets()
      expect(sheet.textContent).toBe(SUPPRESS_TRANSITIONS_CSS)
      release()
      expect(order).toEqual(['restyle:off'])
      expect(suppressingSheets()).toHaveLength(0)
    } finally {
      spy.mockRestore()
    }
  })
})
