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
 * THE CARD SAYS WHICH LAYER WON (AGL-2021).
 *
 * A precedence rule nobody can observe is indistinguishable from a bug: an
 * operator who edits `.env`, ships it and sees nothing change has to be able
 * to find out that a stored value outranked it. That answer is a rendering,
 * not a field on a view model, so every claim here is looked up in the DOM —
 * the same reason `tax-return-jurisdiction.spec.tsx` renders rather than
 * asserting its view model.
 *
 * Identifiers are SYNTHETIC. This repository is public.
 */

import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import type { TaxFilingConfigView } from '../utils/tax-filing-config'

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  CardDisplay: ({
    header,
    children,
  }: {
    header?: ReactNode
    children?: ReactNode
  }) => (
    <section>
      <h2>{header}</h2>
      {children}
    </section>
  ),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: { getIdToken: async () => 'token' } }),
}))
jest.mock('../constants/docs-links', () => ({
  __esModule: true,
  docsHelp: () => undefined,
}))

import StaffTaxFilingCard from '../components/staff-tax-filing-card.component'

/** A value nobody was ever issued, ending in a readable four. */
const SYNTHETIC_REGISTRATION = 'REG-SYNTHETIC-1357'
const SYNTHETIC_FILING = 'FILE-SYNTHETIC-2468'

function view(overrides: Partial<TaxFilingConfigView> = {}): TaxFilingConfigView {
  return {
    jurisdiction: 'US-TX',
    jurisdictionLabel: 'Texas',
    jurisdictionRecognized: true,
    jurisdictionSource: 'environment',
    registrationIdLabel: 'Taxpayer number',
    filingIdLabel: 'Webfile number',
    filingIdRequired: true,
    registration: { configured: true, source: 'environment', hint: '1357' },
    filing: { configured: true, source: 'environment', hint: null },
    firstTaxablePeriod: '2026-09',
    firstTaxablePeriodSource: 'none',
    shadowed: [],
    storedPresent: false,
    configured: true,
    ...overrides,
  }
}

function serve(role: string, config: TaxFilingConfigView) {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ role, config, limits: { noteMax: 280 } }),
  })) as never
}

async function rendered(role: string, config: TaxFilingConfigView) {
  serve(role, config)
  render(<StaffTaxFilingCard />)
  // The jurisdiction line renders only once the response has arrived; waiting
  // on the heading would assert against a loading card.
  await waitFor(() => expect(screen.getByText(config.jurisdiction)).toBeTruthy())
  return document.body.textContent ?? ''
}

describe('the card names the layer every value came from', () => {
  it('says the environment is in force when nothing is stored', async () => {
    const text = await rendered('super', view())
    expect(text).toContain('From the environment')
    expect(text).not.toContain('From this console')
  })

  it('says the console is in force, and names what it outranked', async () => {
    const text = await rendered(
      'super',
      view({
        jurisdiction: 'GB',
        jurisdictionLabel: 'GB',
        jurisdictionSource: 'console',
        storedPresent: true,
        registration: { configured: true, source: 'console', hint: '1357' },
        filing: { configured: false, source: 'none', hint: null },
        filingIdRequired: false,
        registrationIdLabel: 'Registration number',
        filingIdLabel: 'Filing ID',
        shadowed: [
          {
            env: 'AGLYN_TAX_JURISDICTION',
            reason: 'set in the environment, but the console setting (GB) is in force.',
          },
        ],
      }),
    )
    expect(text).toContain('From this console')
    expect(text).toContain('Set in the environment, not in force')
    // The variable is named so the edit that appeared to do nothing is
    // explicable from this screen alone.
    expect(text).toContain('AGLYN_TAX_JURISDICTION')
  })
})

describe('the card never shows an identifier back', () => {
  it('shows a last four for the registration and presence for the credential', async () => {
    const text = await rendered('super', view())
    expect(text).toContain('•••• 1357')
    expect(text).not.toContain(SYNTHETIC_REGISTRATION)
    expect(text).not.toContain(SYNTHETIC_FILING)
    // The credential's own line says configured and nothing else. Read off
    // the page text rather than a single node: "Webfile number" is also the
    // form field's label and its helper sentence, and a node query would
    // resolve to whichever of the three came first.
    expect(text).toMatch(/Webfile number:\s*Configured/)
    expect(text).toMatch(/Taxpayer number:\s*•••• 1357/)
  })

  it('offers no reveal at all', async () => {
    await rendered('super', view())
    expect(screen.queryByRole('button', { name: /reveal|show/i })).toBeNull()
  })

  it('keeps the identifier inputs write-only', async () => {
    await rendered('super', view())
    // A blank field means "keep what is stored" — the response carries nothing
    // to populate it with, and populating it would be a reveal.
    const registration = screen.getByLabelText(/Taxpayer number/) as HTMLInputElement
    expect(registration.value).toBe('')
    expect(registration.type).toBe('password')
  })
})

describe('the write control follows the role', () => {
  it('gives super the form', async () => {
    await rendered('super', view())
    expect(
      screen.getByRole('button', { name: /Save filing configuration/i }),
    ).toBeTruthy()
  })

  it('gives support the explanation instead — the control for the above', async () => {
    const text = await rendered('support', view())
    expect(
      screen.queryByRole('button', { name: /Save filing configuration/i }),
    ).toBeNull()
    expect(text).toContain('super staff role')
    // Reading is still open: the configuration itself is on screen.
    expect(text).toContain('•••• 1357')
  })
})

describe('a jurisdiction that cannot be a bucket key is called out', () => {
  it('says so rather than rendering it as a working setting', async () => {
    const text = await rendered(
      'super',
      view({
        jurisdiction: 'TEXAS',
        jurisdictionLabel: 'TEXAS',
        jurisdictionRecognized: false,
      }),
    )
    expect(text).toContain('Not a jurisdiction key')
    expect(text).toContain('0.00')
  })
})
