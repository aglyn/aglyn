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

import { appLinkClassKey } from '@aglyn/shared-ui-jsx'
import { consoleThemeLight } from '@aglyn/shared-ui-theme'
import { tabClasses } from '@mui/material'
import { ThemeProvider } from '@mui/material/styles'
import { render, screen } from '@testing-library/react'
import { HubSections, type HubSection } from './hub-tabs'

jest.mock('next/navigation', () => ({
  usePathname: () => '/acme/crm/contacts',
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

/**
 * A rail with both kinds of section on either side of the one being read: the
 * selected section is included, two are locked, and one more is included but
 * not selected — so a locked tab can be held against an unlocked tab in the
 * same state as well as against the selected one.
 */
const SECTIONS: readonly HubSection[] = [
  { href: '/acme/crm/contacts', label: 'Contacts' },
  { href: '/acme/crm/leads', label: 'Leads', locked: true },
  { href: '/acme/crm/deals', label: 'Deals', locked: true },
  { href: '/acme/crm/segments', label: 'Segments' },
]

/**
 * The console theme, with the viewport answered: `HubSections` stacks into a
 * horizontal strip below `sm`, and jsdom has no `matchMedia` of its own.
 */
function themeAt(viewport: 'desktop' | 'phone') {
  const matchMedia = (query: string) =>
    ({
      matches: viewport === 'phone' && query.includes('max-width'),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList
  return {
    ...consoleThemeLight,
    components: {
      ...consoleThemeLight.components,
      MuiUseMediaQuery: { defaultProps: { matchMedia } },
    },
  }
}

function renderRail(
  sections: readonly HubSection[],
  viewport: 'desktop' | 'phone',
) {
  const { container } = render(
    <ThemeProvider theme={themeAt(viewport)}>
      <HubSections sections={sections}>{'Section body'}</HubSections>
    </ThemeProvider>,
  )
  const tabs = Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]'))
  const tab = (label: string) => {
    const found = tabs.find((each) => each.textContent?.startsWith(label))
    if (!found) throw new Error(`no tab labelled ${label}`)
    return found
  }
  return { container, tab }
}

/**
 * Selection is state, not layout: the selected tab carries these and no other
 * tab does. Everything else on a tab's class list — MUI's own layout classes
 * and the emotion class its resolved styles serialize to — is what decides
 * the row's height, padding and alignment, so two tabs laid out alike carry
 * the same set.
 */
const SELECTION_CLASSES = new Set<string>([
  tabClasses.selected,
  appLinkClassKey.active,
  appLinkClassKey.activeAsAncestor,
])
const layoutClasses = (tab: HTMLElement) =>
  Array.from(tab.classList)
    .filter((name) => !SELECTION_CLASSES.has(name))
    .sort()

/**
 * The declarations that size a tab's row and set its type, as jsdom computes
 * them.
 *
 * Alignment is deliberately absent. jsdom settles competing rules by source
 * order alone — its cascade does not implement specificity — so the rail's own
 * `.MuiTab-root` rule, which sets `align-items` and `text-transform`, loses to
 * the tab's single-class rule there while it wins in every browser. A computed
 * read of either would report MUI's defaults rather than what a reader sees.
 * Both are held by the class comparison instead: two tabs with the same
 * classes inside the same rail resolve to the same alignment wherever the
 * cascade is real.
 */
const LAYOUT_PROPERTIES = [
  'display',
  'flex-direction',
  'justify-content',
  'min-height',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'font-size',
  'font-weight',
  'line-height',
  'text-align',
] as const
const layoutStyle = (tab: HTMLElement) => {
  const style = window.getComputedStyle(tab)
  return Object.fromEntries(
    LAYOUT_PROPERTIES.map((property) => [property, style.getPropertyValue(property)]),
  )
}

describe.each(['desktop', 'phone'] as const)(
  'HubSections on a %s viewport',
  (viewport) => {
    it('draws the rail the viewport calls for', () => {
      // The positive control for the viewport stub: without it, both runs
      // below would test the vertical rail twice and call that coverage.
      const { container } = renderRail(SECTIONS, viewport)
      const strip = container.querySelector('.MuiTabs-root') as HTMLElement
      expect(strip.classList.contains('MuiTabs-vertical')).toBe(
        viewport === 'desktop',
      )
    })

    it('lays a locked tab out with the same classes as an unlocked one', () => {
      const { tab } = renderRail(SECTIONS, viewport)
      for (const locked of ['Leads', 'Deals']) {
        expect(layoutClasses(tab(locked))).toEqual(layoutClasses(tab('Segments')))
        expect(layoutClasses(tab(locked))).toEqual(layoutClasses(tab('Contacts')))
      }
    })

    it('resolves a locked tab to the same row height, padding and type', () => {
      const { tab } = renderRail(SECTIONS, viewport)
      const unlocked = layoutStyle(tab('Segments'))
      // The positive control for the stylesheet read: jsdom only reports what
      // its cascade delivered, so an empty read here would let the comparison
      // below pass without comparing anything.
      expect(unlocked['min-height']).toBe('48px')
      expect(unlocked['flex-direction']).toBe('column')
      expect(layoutStyle(tab('Leads'))).toEqual(unlocked)
      expect(layoutStyle(tab('Deals'))).toEqual(unlocked)
    })

    it('draws the lock inline, after the label', () => {
      const { tab } = renderRail(SECTIONS, viewport)
      const locked = tab('Leads')
      const lock = locked.querySelector('svg')
      expect(lock).not.toBeNull()
      const label = Array.from(lock?.parentElement?.childNodes ?? []).find(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent === 'Leads',
      )
      expect(label).toBeDefined()
      expect(
        (label as Node).compareDocumentPosition(lock as Node) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    })

    it('tells assistive technology which sections are locked', () => {
      const { tab } = renderRail(SECTIONS, viewport)
      // A locked tab's accessible name carries the lock after its label; an
      // included tab's name is its label and nothing more.
      expect(
        screen.getByRole('tab', { name: /^Leads\s*Not included in your plan$/ }),
      ).toBe(tab('Leads'))
      expect(
        screen.getByRole('tab', { name: /^Deals\s*Not included in your plan$/ }),
      ).toBe(tab('Deals'))
      expect(screen.getByRole('tab', { name: 'Contacts' })).toBe(tab('Contacts'))
      expect(screen.getByRole('tab', { name: 'Segments' })).toBe(tab('Segments'))
    })

    it('leaves a rail with nothing locked as plain labels', () => {
      const { tab } = renderRail(
        SECTIONS.map(({ href, label }) => ({ href, label })),
        viewport,
      )
      for (const label of ['Contacts', 'Leads', 'Deals', 'Segments']) {
        const each = tab(label)
        expect(each.querySelector('svg')).toBeNull()
        expect(
          Array.from(each.childNodes).some(
            (node) => node.nodeType === Node.TEXT_NODE && node.textContent === label,
          ),
        ).toBe(true)
      }
    })
  },
)
