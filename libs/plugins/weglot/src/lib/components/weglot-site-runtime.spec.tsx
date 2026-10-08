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

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import {
  WEGLOT_BOOT_ELEMENT_ID,
  WEGLOT_PAGE_PROP,
  WEGLOT_SCRIPT_ELEMENT_ID,
  WEGLOT_SWITCHER_TARGET_ID,
} from '../constants'
import type { WeglotSiteSettings } from '../model/weglot-settings'
import { WEGLOT_LOADER_GLOBAL } from '../weglot-loader'
import {
  WeglotSiteRuntime,
  languageAutonym,
  offeredLanguages,
} from './weglot-site-runtime'

// The page never goes idle in these specs unless a test says so.
let idle = false
jest.mock('@aglyn/aglyn/app-utils/page-idle', () => ({
  usePageIdle: () => idle,
}))

const settings: WeglotSiteSettings = {
  apiKey: 'wg_0123456789abcdef0123456789abcdef',
  sourceLanguage: 'en',
  targetLanguages: ['fr', 'es'],
  switcher: 'aglyn',
  switcherPosition: 'bottom-right',
}

type TestWindow = Window & Record<string, any>

beforeEach(() => {
  idle = false
  document.head.innerHTML = ''
  window.localStorage.clear()
  delete (window as TestWindow)[WEGLOT_LOADER_GLOBAL]
  delete (window as TestWindow)['Weglot']
})

describe('the Weglot site runtime (AGL-3700)', () => {
  it('renders and loads nothing without the enricher’s slice — the editor preview’s case', () => {
    const { container } = render(<WeglotSiteRuntime page={{}} />)
    expect(container.innerHTML).toBe('')
    expect(document.getElementById(WEGLOT_SCRIPT_ELEMENT_ID)).toBeNull()
    expect(renderToString(<WeglotSiteRuntime page={{}} />)).toBe('')
  })

  it('renders nothing for a slice it cannot vouch for', () => {
    const { container } = render(
      <WeglotSiteRuntime
        page={{ [WEGLOT_PAGE_PROP]: { ...settings, apiKey: 'wg_"><script>' } }}
      />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('puts the boot in the server HTML and nothing that blocks the parser', () => {
    const html = renderToString(
      <WeglotSiteRuntime page={{ [WEGLOT_PAGE_PROP]: settings }} />,
    )
    expect(html).toContain(`id="${WEGLOT_BOOT_ELEMENT_ID}"`)
    expect(html).toContain(settings.apiKey)
    // The library itself is never a parser-inserted <script src>.
    expect(html).not.toContain('src="https://cdn.weglot.com')
    // The themed switcher is client-only: the cached HTML cannot know the
    // visitor's language.
    expect(html).not.toContain('Language')
  })

  it('does not load Weglot before the page is idle, and does once it is', () => {
    const page = { [WEGLOT_PAGE_PROP]: settings }
    const { rerender } = render(<WeglotSiteRuntime page={page} />)
    expect(document.getElementById(WEGLOT_SCRIPT_ELEMENT_ID)).toBeNull()
    idle = true
    rerender(<WeglotSiteRuntime page={{ ...page }} />)
    expect(document.getElementById(WEGLOT_SCRIPT_ELEMENT_ID)).not.toBeNull()
  })

  it('draws the themed switcher, by each language’s own name, and switches through Weglot', async () => {
    const switchTo = jest.fn()
    const fake = { initialized: true, switchTo, on: jest.fn(), off: jest.fn() }
    ;(window as TestWindow)[WEGLOT_LOADER_GLOBAL] = jest.fn(async () => {
      ;(window as TestWindow)['Weglot'] = fake
      return fake
    })
    render(<WeglotSiteRuntime page={{ [WEGLOT_PAGE_PROP]: settings }} />)
    const select = await screen.findByRole('combobox', { name: 'Language' })
    fireEvent.mouseDown(select)
    const options = screen.getAllByRole('option').map((option) => option.textContent)
    expect(options).toEqual([
      languageAutonym('en'),
      languageAutonym('fr'),
      languageAutonym('es'),
    ])
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: languageAutonym('fr') }))
    })
    await waitFor(() => expect(switchTo).toHaveBeenCalledWith('fr'))
  })

  it('leaves Weglot’s own switcher a positioned place to draw in', () => {
    render(
      <WeglotSiteRuntime
        page={{ [WEGLOT_PAGE_PROP]: { ...settings, switcher: 'weglot' } }}
      />,
    )
    expect(document.getElementById(WEGLOT_SWITCHER_TARGET_ID)).not.toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
  })
})

describe('which languages the switcher offers', () => {
  it('offers the site’s language and its targets before Weglot loads', () => {
    expect(offeredLanguages(settings, null)).toEqual(['en', 'fr', 'es'])
  })

  it('narrows to what the Weglot project serves once it has loaded', () => {
    expect(
      offeredLanguages(settings, {
        options: { languages: [{ language_to: 'es' }, { language_to: 'de' }] },
      }),
    ).toEqual(['en', 'es'])
  })

  it('names a language in that language', () => {
    expect(languageAutonym('fr')).toBe('Français')
    expect(languageAutonym('es')).toBe('Español')
  })
})
