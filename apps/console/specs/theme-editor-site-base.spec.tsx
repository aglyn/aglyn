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
 * The theme editor names the default THIS site renders (AGL-3068).
 *
 * `inheritedThemeColor` can resolve the right base and still be shown the
 * wrong site: the editor sits on a console route, so which site it is editing
 * arrives through `HostSiteKeyContext` rather than from the page's own
 * address. This is the link between the two — the site the route names
 * reaching the "Default · #…" beside every unset slot, and the preview built
 * on the same base.
 */

import { HostSiteKeyContext } from '@aglyn/shared-ui-theme'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}))
jest.mock('@aglyn/shared-ui-color-picker', () => ({ ColorPicker: () => null }))
jest.mock('../constants/docs-links', () => ({ docsHelp: () => undefined }))
jest.mock('next/dynamic', () => ({ __esModule: true, default: () => () => null }))
jest.mock('next/head', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

import ThemeEditor from '../components/theme-editor/theme-editor.component'

/** The tenant default's primary, and the platform brand's. */
const TENANT_PRIMARY = '#1976d2'
const BRAND_PRIMARY = '#00b0ff'

function renderFor(siteKey: string | undefined) {
  render(
    <HostSiteKeyContext.Provider value={siteKey}>
      <ThemeEditor theme={{}} onSave={jest.fn()} />
    </HostSiteKeyContext.Provider>,
  )
}

/** Every "Default · #…" caption on the screen, lower-cased for comparison. */
const defaultsShown = () =>
  screen
    .getAllByText(/^Default · #/)
    .map((node) => String(node.textContent).toLowerCase())

describe('the theme editor’s defaults follow the site (AGL-3068)', () => {
  it('names the tenant default on a customer site', () => {
    renderFor('ready-to-roll')
    const shown = defaultsShown()
    expect(shown).toContain(`default · ${TENANT_PRIMARY}`)
    expect(shown).not.toContain(`default · ${BRAND_PRIMARY}`)
  })

  it('names the platform brand on the operator’s own host', () => {
    renderFor('aglyn.com')
    const shown = defaultsShown()
    expect(shown).toContain(`default · ${BRAND_PRIMARY}`)
    expect(shown).not.toContain(`default · ${TENANT_PRIMARY}`)
  })
})
