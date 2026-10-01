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

import { within } from '@testing-library/dom'
import type { ReactNode } from 'react'
import {
  type FiberRenderCounter,
  FRESH_REGISTRY_TIMEOUT_MS,
  installFiberRenderCounter,
} from '@aglyn/shared-ui-jsx/testing/fiber-render-counter'

jest.setTimeout(FRESH_REGISTRY_TIMEOUT_MS)

/**
 * What one keystroke costs on Sequences → Compliance (AGL-3423).
 *
 * The legal name, the brand name, the address and the allowed countries are
 * one form, and one letter typed into any of them used to redraw all three
 * text fields, both cards and the do-not-contact list below them. The
 * countries chips beside them are the field a redraw per keystroke drove into
 * React's #185 in the sequence editor. A keystroke now redraws the field it
 * lands in and the footer it changes. Counted off React's own commits, so the
 * budget is what actually rendered.
 *
 * The input budget is two: the field typed into draws once for its new value,
 * and once more when the letter is its first, because MUI keeps "filled" in
 * the field's `FormControl` and the change redraws the input under it.
 */

const mockLoad = {
  status: 'ready',
  settings: {
    legalName: 'Example Co LLC',
    brandName: 'Example Co',
    postalAddress: '100 Example St\nSpringfield, IL 62701',
    allowedCountries: ['US', 'CA'],
    updatedAtMs: 1,
    updatedByUid: 'uid-owner',
  },
  message: null,
  reload: () => undefined,
}

jest.mock('./use-outreach-api', () => ({
  ...jest.requireActual('./use-outreach-api'),
  useOutreachApi: () => ({ saveSettings: jest.fn() }),
}))
jest.mock('./use-outreach-settings', () => ({
  useOutreachComplianceSettings: () => mockLoad,
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({
    children,
    header,
    HeaderProps,
  }: {
    children: ReactNode
    header: ReactNode
    HeaderProps?: { action?: ReactNode }
  }) => (
    <section aria-label={String(header)}>
      {HeaderProps?.action}
      {children}
    </section>
  ),
}))
jest.mock('@aglyn/aglyn', () => ({ pluginDocsHelp: () => undefined }))
// The domain list is its own card with its own spec (AGL-3244); here it is
// only counted.
jest.mock('./do-not-contact-domains', () => ({
  OutreachDoNotContactDomainsCard: function OutreachDoNotContactDomainsCard() {
    return null
  },
}))

describe('one keystroke on Sequences → Compliance (AGL-3423)', () => {
  let counter: FiberRenderCounter
  let react: typeof import('react')
  let unmount: () => Promise<void>
  let page: HTMLElement

  beforeEach(async () => {
    counter = installFiberRenderCounter()
    jest.resetModules()
    react = jest.requireActual<typeof import('react')>('react')
    const client = jest.requireActual<typeof import('react-dom/client')>('react-dom/client')
    const { OutreachComplianceSection } = jest.requireActual<
      typeof import('./compliance-section')
    >('./compliance-section')
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    page = document.createElement('div')
    document.body.appendChild(page)
    const root = client.createRoot(page)
    await react.act(async () => {
      root.render(react.createElement(OutreachComplianceSection, { orgId: 'org-1' }))
    })
    expect(within(page).getByText('Canada')).toBeTruthy()
    unmount = async () => {
      await react.act(async () => root.unmount())
      page.remove()
    }
  })

  afterEach(async () => {
    await unmount()
    counter.uninstall()
    jest.restoreAllMocks()
  })

  const type = async (field: HTMLInputElement | HTMLTextAreaElement) => {
    const prototype =
      field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype
    const setValue = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    const before = field.value
    counter.reset()
    await react.act(async () => {
      setValue?.call(field, `${before}a`)
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(field.value).toBe(`${before}a`)
  }

  it.each([
    ['Legal name', 'Example Co LLCa ·'],
    ['Brand name', 'from Example Coa.'],
    ['Postal address', 'Springfield, IL 62701a'],
  ])(
    'redraws only the %s typed into, and the footer, never the chips or the domain list',
    async (label, footer) => {
      await type(within(page).getByLabelText(label) as HTMLInputElement)
      expect(counter.rendered('Autocomplete')).toBe(0)
      expect(counter.rendered('InputBase')).toBeLessThanOrEqual(2)
      expect(counter.rendered('ComplianceCountriesField')).toBe(0)
      expect(counter.rendered('OutreachDoNotContactDomainsCard')).toBe(0)
      // The footer is drawn from what was typed, so it is redrawn with it.
      expect(
        within(page).getByTestId('outreach-footer-preview').textContent,
      ).toContain(footer)
    },
  )
})
