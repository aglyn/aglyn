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
 * WHICH LAYER WINS, AND WHAT THE BROWSER IS TOLD (AGL-2021).
 *
 * The filing jurisdiction and its registration identifiers moved out of three
 * environment variables and into a staff-console control, which means two
 * layers now answer the same question. This suite pins the answer in BOTH
 * directions — a stored value outranking the environment, and the environment
 * standing in where nothing is stored — because a precedence rule is only
 * half-specified by the direction its author happened to test.
 *
 * Every identifier below is SYNTHETIC. This repository is public and
 * `tools/scripts/check-no-tax-identifiers.mjs` refuses real registration
 * numbers in tracked source; what these assert is the mechanism, never a
 * value. They are deliberately not digit-runs either, so no shape the guard
 * scans for is even a candidate.
 */

import {
  DEFAULT_FIRST_TAXABLE_PERIOD,
  maskTaxIdentifier,
  resolveTaxFilingConfig,
  taxFilingConfigView,
  validateTaxFilingProposal,
  type TaxFilingConfigLayer,
} from '../utils/tax-filing-config'
import {
  defaultTaxReturnPeriod,
  taxReturnPeriodOptions,
} from '../utils/tx-return-webfile'

/** A registration number nobody was ever issued, ending in a readable four. */
const SYNTHETIC_REGISTRATION = 'REG-SYNTHETIC-4242'
/** A filing credential nobody was ever issued. */
const SYNTHETIC_FILING = 'FILE-SYNTHETIC-9090'
/** A second pair, so "the console's value" is never the environment's. */
const CONSOLE_REGISTRATION = 'REG-CONSOLE-1357'
const CONSOLE_FILING = 'FILE-CONSOLE-2468'

const TEXAS_ENV: TaxFilingConfigLayer = {
  jurisdiction: 'US-TX',
  registrationId: SYNTHETIC_REGISTRATION,
  filingId: SYNTHETIC_FILING,
}

const NO_ENV: TaxFilingConfigLayer = {
  jurisdiction: null,
  registrationId: null,
  filingId: null,
}

describe('the environment is the bootstrap', () => {
  it('is entirely in force when nothing is stored', () => {
    const resolved = resolveTaxFilingConfig({ stored: null, env: TEXAS_ENV })
    expect(resolved.jurisdiction.code).toBe('US-TX')
    expect(resolved.jurisdictionSource).toBe('environment')
    expect(resolved.registrationId).toBe(SYNTHETIC_REGISTRATION)
    expect(resolved.registrationIdSource).toBe('environment')
    expect(resolved.filingId).toBe(SYNTHETIC_FILING)
    expect(resolved.storedPresent).toBe(false)
    // Nothing is outranked, so nothing is reported as outranked. This is the
    // CONTROL for the shadow assertions below: if `shadowed` were populated
    // unconditionally, every one of them would pass for the wrong reason.
    expect(resolved.shadowed).toEqual([])
  })

  it('falls back to the built-in jurisdiction when neither layer names one', () => {
    const resolved = resolveTaxFilingConfig({ stored: null, env: NO_ENV })
    expect(resolved.jurisdiction.code).toBe('US-TX')
    expect(resolved.jurisdictionSource).toBe('none')
    expect(resolved.registrationId).toBeNull()
    expect(resolved.registrationIdSource).toBe('none')
  })
})

describe('the console wins', () => {
  it('outranks every environment field it holds a value for', () => {
    const resolved = resolveTaxFilingConfig({
      stored: {
        jurisdiction: 'GB',
        registrationId: CONSOLE_REGISTRATION,
        filingId: CONSOLE_FILING,
        firstTaxablePeriod: '2024-Q1',
      },
      env: TEXAS_ENV,
    })
    expect(resolved.jurisdiction.code).toBe('GB')
    expect(resolved.jurisdictionSource).toBe('console')
    expect(resolved.registrationId).toBe(CONSOLE_REGISTRATION)
    expect(resolved.registrationIdSource).toBe('console')
    expect(resolved.filingId).toBe(CONSOLE_FILING)
    expect(resolved.firstTaxablePeriod).toBe('2024-Q1')
    expect(resolved.firstTaxablePeriodSource).toBe('console')
  })

  it('names every outranked variable, so an unchanged .env edit is explicable', () => {
    const resolved = resolveTaxFilingConfig({
      stored: {
        jurisdiction: 'GB',
        registrationId: CONSOLE_REGISTRATION,
        filingId: CONSOLE_FILING,
      },
      env: TEXAS_ENV,
    })
    const names = resolved.shadowed.map((entry) => entry.env).sort()
    expect(names).toEqual([
      'AGLYN_TAX_FILING_ID',
      'AGLYN_TAX_JURISDICTION',
      'AGLYN_TAX_REGISTRATION_ID',
    ])
    // A name is not a secret and a value is. The reasons explain the rule and
    // never quote what they outranked.
    const prose = JSON.stringify(resolved.shadowed)
    expect(prose).not.toContain(SYNTHETIC_REGISTRATION)
    expect(prose).not.toContain(SYNTHETIC_FILING)
  })

  it('lets the environment back in when the stored record is cleared', () => {
    // The DELETE direction, which is the half a one-way test never reaches:
    // storing a value must not be irreversible, or the environment layer is
    // dead the moment anybody touches the console.
    const resolved = resolveTaxFilingConfig({ stored: null, env: TEXAS_ENV })
    expect(resolved.jurisdictionSource).toBe('environment')
    expect(resolved.registrationId).toBe(SYNTHETIC_REGISTRATION)
  })
})

describe('an environment identifier does not outlive its authority', () => {
  it('is dropped when the console moves the jurisdiction', () => {
    const resolved = resolveTaxFilingConfig({
      stored: { jurisdiction: 'GB' },
      env: TEXAS_ENV,
    })
    // The whole point: a Texas taxpayer number must never be printed on a
    // British return under a British authority's label.
    expect(resolved.jurisdiction.code).toBe('GB')
    expect(resolved.registrationId).toBeNull()
    expect(resolved.filingId).toBeNull()
    expect(resolved.registrationIdSource).toBe('none')
    const reason = resolved.shadowed.find(
      (entry) => entry.env === 'AGLYN_TAX_REGISTRATION_ID',
    )?.reason
    expect(reason).toContain('US-TX')
    expect(reason).toContain('GB')
  })

  it('still applies when the console re-states the same jurisdiction', () => {
    // The CONTROL for the drop above. If the guard were "a stored jurisdiction
    // always drops the environment's numbers", storing `US-TX` would unset a
    // live registration — so the two cases have to be told apart.
    const resolved = resolveTaxFilingConfig({
      stored: { jurisdiction: 'US-TX' },
      env: TEXAS_ENV,
    })
    expect(resolved.registrationId).toBe(SYNTHETIC_REGISTRATION)
    expect(resolved.registrationIdSource).toBe('environment')
  })

  it('applies the deprecated Texas names under the default jurisdiction', () => {
    // A deployment that set only the two numbers has no
    // `AGLYN_TAX_JURISDICTION` at all, and its identifiers must still apply.
    const resolved = resolveTaxFilingConfig({
      stored: null,
      env: { ...NO_ENV, registrationId: SYNTHETIC_REGISTRATION },
    })
    expect(resolved.registrationId).toBe(SYNTHETIC_REGISTRATION)
    expect(resolved.registrationIdSource).toBe('environment')
  })
})

describe('no identifier reaches a client-visible payload', () => {
  const resolved = resolveTaxFilingConfig({
    stored: {
      jurisdiction: 'US-TX',
      registrationId: CONSOLE_REGISTRATION,
      filingId: CONSOLE_FILING,
    },
    env: TEXAS_ENV,
  })

  it('really has both identifiers to leak', () => {
    // Anti-vacuity. A view built from an EMPTY config would satisfy every
    // "does not contain" below while proving nothing at all.
    expect(resolved.registrationId).toBe(CONSOLE_REGISTRATION)
    expect(resolved.filingId).toBe(CONSOLE_FILING)
  })

  it('serializes without either value, in whole or in part', () => {
    const wire = JSON.stringify(taxFilingConfigView(resolved))
    expect(wire).not.toContain(CONSOLE_REGISTRATION)
    expect(wire).not.toContain(CONSOLE_FILING)
    expect(wire).not.toContain(SYNTHETIC_REGISTRATION)
    expect(wire).not.toContain(SYNTHETIC_FILING)
    // Not a prefix either. The registration's last four is the ONE fragment
    // that may appear, and nothing longer.
    expect(wire).not.toContain(CONSOLE_REGISTRATION.slice(0, -4))
    expect(wire).not.toContain(CONSOLE_FILING.slice(0, 8))
  })

  it('still says enough to recognize the registration', () => {
    const view = taxFilingConfigView(resolved)
    expect(view.registration.configured).toBe(true)
    expect(view.registration.hint).toBe('1357')
    expect(view.configured).toBe(true)
  })

  it('says nothing but presence about the filing credential', () => {
    // A Webfile number is six digits behind a fixed prefix: a last four would
    // narrow it to a hundred candidates, which is not masking.
    const view = taxFilingConfigView(resolved)
    expect(view.filing.configured).toBe(true)
    expect(view.filing.hint).toBeNull()
  })

  it('refuses a last four of a value short enough to be given away by one', () => {
    expect(maskTaxIdentifier('AB1234', 'console', 'last4').hint).toBeNull()
    expect(maskTaxIdentifier('AB123456', 'console', 'last4').hint).toBe('3456')
    expect(maskTaxIdentifier(null, 'console', 'last4')).toEqual({
      configured: false,
      source: 'none',
      hint: null,
    })
  })
})

describe('a malformed jurisdiction is refused at the input', () => {
  it('accepts the four shapes the report actually buckets', () => {
    // The CONTROL. A validator that refused everything would pass every
    // rejection test below.
    for (const code of ['US-TX', 'US-CA', 'GB', 'DE', 'us-tx']) {
      const result = validateTaxFilingProposal({
        jurisdiction: code,
        registrationId: null,
        filingId: null,
      })
      expect(result.error).toBeNull()
      expect(result.value?.jurisdiction).toBe(code.toUpperCase())
    }
  })

  it('refuses a country NAME, which reads every figure as zero', () => {
    const result = validateTaxFilingProposal({
      jurisdiction: 'Texas',
      registrationId: null,
      filingId: null,
    })
    expect(result.value).toBeNull()
    expect(result.error).toContain('US-TX')
  })

  it('refuses the other shapes that cannot be a bucket key', () => {
    for (const code of ['', 'U', 'USA-TX', 'US-TEXAS', 'US_TX', '  ']) {
      expect(
        validateTaxFilingProposal({
          jurisdiction: code,
          registrationId: null,
          filingId: null,
        }).value,
      ).toBeNull()
    }
  })

  it('refuses half a Texas registration and accepts a whole one', () => {
    const half = validateTaxFilingProposal({
      jurisdiction: 'US-TX',
      registrationId: CONSOLE_REGISTRATION,
      filingId: null,
    })
    expect(half.value).toBeNull()
    expect(half.error).toContain('Webfile number')

    const whole = validateTaxFilingProposal({
      jurisdiction: 'US-TX',
      registrationId: CONSOLE_REGISTRATION,
      filingId: CONSOLE_FILING,
    })
    expect(whole.error).toBeNull()
  })

  it('does not demand a filing id where the authority issues none', () => {
    const result = validateTaxFilingProposal({
      jurisdiction: 'GB',
      registrationId: CONSOLE_REGISTRATION,
      filingId: null,
    })
    expect(result.error).toBeNull()
  })

  it('refuses a first taxable period the return route could not range on', () => {
    expect(
      validateTaxFilingProposal({
        jurisdiction: 'GB',
        registrationId: null,
        filingId: null,
        firstTaxablePeriod: '2024-Q5',
      }).value,
    ).toBeNull()
    expect(
      validateTaxFilingProposal({
        jurisdiction: 'GB',
        registrationId: null,
        filingId: null,
        firstTaxablePeriod: '2024-Q1',
      }).error,
    ).toBeNull()
  })
})

describe('the period menu takes its floor from the configuration', () => {
  const now = new Date('2026-11-05T00:00:00Z')

  it('is unchanged for a deployment that configured nothing', () => {
    // The floor was a compiled-in constant, and an unset setting must leave
    // this deployment's menu exactly as it was: quarters from 2026 Q3, months
    // from September — never July or August, in which nothing was collectible.
    const withoutFloor = taxReturnPeriodOptions(now).map((o) => o.value)
    const withDefault = taxReturnPeriodOptions(
      now,
      DEFAULT_FIRST_TAXABLE_PERIOD,
    ).map((o) => o.value)
    expect(withDefault).toEqual(withoutFloor)
    expect(withoutFloor).toContain('2026-Q3')
    expect(withoutFloor).toContain('2026-09')
    expect(withoutFloor).not.toContain('2026-08')
    expect(withoutFloor).not.toContain('2026-Q2')
  })

  it('offers an operator’s own earlier periods once they configure one', () => {
    const values = taxReturnPeriodOptions(now, '2025-04').map((o) => o.value)
    expect(values).toContain('2025-Q2')
    expect(values).toContain('2025-04')
    // Still floored: March 2025 predates the configured obligation.
    expect(values).not.toContain('2025-03')
    expect(values).not.toContain('2024-Q4')
  })

  it('floors a quarter at its first month, and a month at itself', () => {
    expect(taxReturnPeriodOptions(now, '2026-Q3').map((o) => o.value)).toContain(
      '2026-07',
    )
    expect(
      taxReturnPeriodOptions(now, '2026-09').map((o) => o.value),
    ).not.toContain('2026-07')
  })

  it('defaults to the newest ended quarter on the configured menu', () => {
    expect(defaultTaxReturnPeriod(now, '2025-04')).toBe('2026-Q3')
    expect(defaultTaxReturnPeriod(new Date('2025-08-01T00:00:00Z'), '2025-04')).toBe(
      '2025-Q2',
    )
  })

  it('never lands on a quarter that predates the configured obligation', () => {
    // Inside the very first quarter there is no ENDED one to prefer, and the
    // fallback must be the floor's own quarter rather than the one before it —
    // a period nothing could have been collected in.
    expect(defaultTaxReturnPeriod(new Date('2025-05-01T00:00:00Z'), '2025-04')).toBe(
      '2025-Q2',
    )
  })
})
