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
 *
 * @jest-environment jsdom
 */

/**
 * AGL-2486 — two independent defects in the consent preview.
 *
 * **1. The picker's menu paints behind the panel that owns it.** The region
 * picker
 * lives in a fixed panel the preview pins at `z-index: 2147483500` — a number
 * that high because the panel floats over a previewed PUBLISHED page, where
 * the consent banner (2147483400) and the privacy pill (2147483390) already
 * sit near the ceiling so they can beat arbitrary customer content. MUI
 * portals the select's menu to `<body>` with `theme.zIndex.modal`, i.e. 1300,
 * so the menu loses to its own panel. Measured in the browser: menu 1300,
 * panel 2147483500, both direct children of `<body>` — the same stacking
 * context, so the comparison is real and raising the menu actually works (in
 * a different context it would not have).
 *
 * The assertion reads `document.styleSheets` rather than `style` attributes or
 * `innerHTML`, because emotion injects through `insertRule` under jest and a
 * spec that greps markup goes green against a build with no rule at all.
 *
 * **2. The preview shows the analytics-only banner, never the advertising
 * question.** Nothing is missing from the platform: `ConsentBannerUi` has
 * taken an `advertising` prop since AGL-1649, resolved by the caller from the
 * host document precisely because the console preview mounts the same
 * component against a simulated host. The tenant passes it
 * (`site-analytics.tsx`); a preview that does not renders the analytics-only
 * banner on every site, including sites with the advertising question
 * switched ON.
 *
 * That is why this drives the REAL `ConsentBannerUi` through the REAL preview
 * component instead of asserting the prop is present in the source: a test
 * that checked `advertising={...}` appears in the JSX would pass on
 * `advertising={undefined}` and change nothing.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as Aglyn from '@aglyn/aglyn'

/** The host document the simulator reads. Swapped per test. */
const mockHostState: { doc: Record<string, unknown> } = { doc: {} }

/** A site with analytics AND the advertising question turned on. */
const HOST_ASKS_ADS = {
  analytics: { gaMeasurementId: 'G-ABC12345' },
  consent: { advertising: true },
}

/** The same site with the advertising question off — every site, by default. */
const HOST_ANALYTICS_ONLY = {
  analytics: { gaMeasurementId: 'G-ABC12345' },
}

jest.mock('@aglyn/aglyn-node-renderer', () => {
  const theme = jest.requireActual('@aglyn/shared-ui-theme')
  return {
    __esModule: true,
    // The REAL console theme, because the fix stores `zIndex: 'max'` as a
    // theme token: a stub theme would leave nothing for MUI to resolve it
    // against and the rule under test would never be emitted. In production
    // the site theme merges `consoleOptions` as its base, so the token is
    // present there for the same reason it is present here.
    useAglynSiteTheme: () => theme.consoleThemeLight,
    AglynNodeRenderer: () => null,
  }
})

jest.mock('@aglyn/shared-ui-theme', () => {
  const actual = jest.requireActual('@aglyn/shared-ui-theme')
  const mui = jest.requireActual('@mui/material')
  const react = jest.requireActual('react')
  return {
    __esModule: true,
    ...actual,
    // MUI's own provider, which is what the real one wraps — the property
    // under test is that the theme reaches the `sx` resolver.
    ThemeProvider: ({ children, theme }: any) =>
      react.createElement(mui.ThemeProvider, { theme }, children),
    getGoogleFontsUrl: () => undefined,
    useThemeModeState: () => [['light', 'light']],
  }
})

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  // Truthy: the consent-host effect bails on a falsy firestore, so a `null`
  // here would silently skip the load and every advertising assertion would
  // fail for the wrong reason.
  useFirestore: () => ({}),
}))

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: jest.fn(),
  doc: jest.fn(),
  getDoc: jest.fn(() =>
    Promise.resolve({ data: () => mockHostState.doc }),
  ),
  getDocs: jest.fn(() => Promise.resolve({ docs: [] })),
  limit: jest.fn(),
  query: jest.fn(),
}))

jest.mock('../utils/firestore-one-shot-retry', () => ({
  __esModule: true,
  default: (fn: () => unknown) => Promise.resolve(fn()),
}))

jest.mock('../constants/preview-state', () => ({
  __esModule: true,
  previewStateKey: () => 'k',
  readPreviewState: () => ({ nodes: {}, theme: undefined }),
}))

import DocumentPreview from '../components/document-preview.component'

/**
 * The resolved `z-index` for an element, read from the CSSOM.
 *
 * Emotion inserts through `insertRule` under jest, so the rule exists in
 * `document.styleSheets` and nowhere in the serialized markup. Returns `null`
 * when no rule declares one, which the control below relies on to prove this
 * helper can come back empty rather than inventing a number.
 */
function zIndexFromStylesheets(el: Element | null): number | null {
  if (!el) return null
  const classes = [...el.classList]
  let found: number | null = null
  for (const sheet of [...document.styleSheets]) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    for (const rule of [...(rules as any)] as CSSStyleRule[]) {
      if (!rule.selectorText) continue
      if (!classes.some((c) => rule.selectorText.includes(`.${c}`))) continue
      const match = /z-index:\s*(-?\d+)/.exec(rule.cssText)
      if (match) found = Number(match[1])
    }
  }
  return found
}

const consentPanel = () =>
  [...document.querySelectorAll('.MuiPaper-root')].find((p) =>
    (p as HTMLElement).textContent?.includes('Consent preview'),
  ) ?? null

const renderPreview = () =>
  render(
    <DocumentPreview ids={{ hostId: 'host-1', kind: 'screen', docId: 's1' }} />,
  )

/** Open the region picker. MUI opens a select on mousedown, not click. */
function openRegionPicker() {
  fireEvent.mouseDown(screen.getByRole('combobox'))
}

/** Open the region picker and choose a simulated region. */
async function simulateRegion(label: string) {
  openRegionPicker()
  fireEvent.click(await screen.findByRole('option', { name: label }))
}

beforeEach(() => {
  mockHostState.doc = HOST_ASKS_ADS
  jest
    .spyOn(Aglyn.canvas, 'getNode')
    .mockReturnValue({ $id: '_@_', componentId: 'root' } as never)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('Consent preview — the region menu stacks above its own panel (AGL-2486)', () => {
  it('paints the open menu above the panel that contains the picker', async () => {
    renderPreview()
    openRegionPicker()

    const menu = document.querySelector('.MuiPopover-root')
    const panelZ = zIndexFromStylesheets(consentPanel())
    const menuZ = zIndexFromStylesheets(menu)

    // Both must actually be declared, or the comparison below would be
    // comparing nulls and passing for it.
    expect(panelZ).not.toBeNull()
    expect(menuZ).not.toBeNull()
    // The reported symptom, stated as the rule that prevents it.
    expect(menuZ as number).toBeGreaterThan(panelZ as number)
  })

  it('leaves the panel above the consent overlays it floats over', async () => {
    renderPreview()
    openRegionPicker()

    // The banner (2147483400) and pill (2147483390) in `consent-banner-ui.tsx`
    // render inside the previewed page. Raising the menu must not be done by
    // lowering the panel underneath them.
    expect(zIndexFromStylesheets(consentPanel()) as number).toBeGreaterThan(
      2147483400,
    )
  })

  it('CONTROL — the CSSOM probe returns null for an element with no z-index rule', () => {
    renderPreview()
    // Proves a green above is a rule that was really read, not the helper
    // defaulting to something comparable. An element styled by no emotion
    // z-index rule must come back empty.
    expect(zIndexFromStylesheets(document.body)).toBeNull()
  })
})

describe('Consent preview — the advertising question (AGL-2486)', () => {
  it('asks about advertising when the site has the question turned on', async () => {
    renderPreview()
    await simulateRegion('EU visitor')

    const banner = await screen.findByText(/This site would like to use/)
    // The two-category copy, and the two-category primary action.
    expect(banner.textContent).toMatch(/advertising cookies/)
    // "Allow all" rather than "Allow" is itself the two-category tell.
    expect(screen.queryByRole('button', { name: 'Allow all' })).not.toBeNull()
  })

  it('offers advertising as its own checkbox, separate from analytics', async () => {
    renderPreview()
    await simulateRegion('EU visitor')
    fireEvent.click(await screen.findByRole('button', { name: 'Preferences' }))

    // This is the surface in the screenshot: he saw the analytics row and
    // nothing else.
    expect(screen.queryByText(/Analytics \(Google Analytics\)/)).not.toBeNull()
    expect(screen.queryByText(/Advertising — personalized ads/)).not.toBeNull()
  })

  it('reports the advertising verdict in the panel, not analytics alone', async () => {
    renderPreview()
    await simulateRegion('EU visitor')

    // "I only see GA" was read off this caption, which named one category
    // because it only ever knew about one.
    await waitFor(() =>
      expect(consentPanel()?.textContent).toMatch(/Advertising storage:/),
    )
  })

  it('carries a ticked advertising box through to the verdict', async () => {
    renderPreview()
    await simulateRegion('EU visitor')
    fireEvent.click(await screen.findByRole('button', { name: 'Preferences' }))

    const ads = screen.getByRole('checkbox', { name: /Advertising/ })
    const analytics = screen.getByRole('checkbox', { name: /Analytics/ })
    fireEvent.click(analytics)
    fireEvent.click(ads)
    fireEvent.click(screen.getByRole('button', { name: /Save|Confirm|Allow/ }))

    // The decision must survive the round trip into the simulated record.
    // Dropping the second `onDecision` argument made ticking this box a
    // no-op — a control that told the operator their choice registered when
    // the preview had already discarded it.
    await waitFor(() =>
      expect(consentPanel()?.textContent).toMatch(
        /Advertising storage: GRANTED/,
      ),
    )
  })

  it('CONTROL — a site with the question OFF still shows analytics only', async () => {
    mockHostState.doc = HOST_ANALYTICS_ONLY
    renderPreview()
    await simulateRegion('EU visitor')
    fireEvent.click(await screen.findByRole('button', { name: 'Preferences' }))

    // The category is per-host and off by default, so the fix must NOT be
    // "always show advertising". A banner offering a choice the site never
    // asked for would be its own legal defect — and this is the assertion
    // that would catch it.
    expect(screen.queryByText(/Analytics \(Google Analytics\)/)).not.toBeNull()
    expect(screen.queryByText(/Advertising — personalized ads/)).toBeNull()
    expect(consentPanel()?.textContent).toMatch(/Advertising: not asked/)
  })
})
