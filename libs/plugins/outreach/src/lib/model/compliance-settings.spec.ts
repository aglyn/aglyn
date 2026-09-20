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

import {
  effectiveOutreachAllowedCountries,
  isOutreachCountryCode,
  OUTREACH_COUNTRY_CODES,
  OUTREACH_LEGAL_NAME_MAX,
  OUTREACH_POSTAL_ADDRESS_MAX,
  OUTREACH_POSTAL_ADDRESS_MAX_LINES,
  outreachComplianceSettingsEqual,
  outreachCountryLabel,
  outreachCountryOptions,
  readOutreachComplianceSettings,
  validateOutreachComplianceSettings,
} from './compliance-settings'

/**
 * The organization's compliance settings as data (AGL-2980): what a save
 * stores, what refuses it, and how a stored document reads back.
 */

const valid = {
  legalName: '  Example Co   LLC ',
  brandName: 'Example Co',
  postalAddress: '100 Example St\n\n  Suite 4  \nSpringfield, IL 62701\n',
  allowedCountries: ['us', 'CA'],
}

describe('validateOutreachComplianceSettings (AGL-2980)', () => {
  it('stores the settings settled: one-lined names, trimmed address lines, uppercase codes', () => {
    const { settings, issues } = validateOutreachComplianceSettings(valid)
    expect(issues).toEqual([])
    expect(settings).toEqual({
      legalName: 'Example Co LLC',
      brandName: 'Example Co',
      postalAddress: '100 Example St\nSuite 4\nSpringfield, IL 62701',
      allowedCountries: ['US', 'CA'],
    })
  })

  it('allows an empty legal name and address — activation, not the save, refuses them', () => {
    const { settings, issues } = validateOutreachComplianceSettings({
      legalName: '',
      brandName: '',
      postalAddress: '   ',
      allowedCountries: ['US'],
    })
    expect(issues).toEqual([])
    expect(settings.postalAddress).toBe('')
  })

  it('refuses a legal name over the limit', () => {
    const { issues } = validateOutreachComplianceSettings({
      ...valid,
      legalName: 'x'.repeat(OUTREACH_LEGAL_NAME_MAX + 1),
    })
    expect(issues.map((issue) => issue.field)).toEqual(['legalName'])
  })

  it('refuses an address on too many lines, and one too long', () => {
    const lines = Array.from({ length: OUTREACH_POSTAL_ADDRESS_MAX_LINES + 1 }, (_, i) => `Line ${i}`)
    expect(
      validateOutreachComplianceSettings({ ...valid, postalAddress: lines.join('\n') }).issues,
    ).toEqual([{ field: 'postalAddress', message: expect.stringContaining('lines or fewer') }])
    expect(
      validateOutreachComplianceSettings({
        ...valid,
        postalAddress: 'x'.repeat(OUTREACH_POSTAL_ADDRESS_MAX + 1),
      }).issues,
    ).toEqual([{ field: 'postalAddress', message: expect.stringContaining('characters') }])
  })

  it('refuses no countries at all, and a missing list', () => {
    for (const allowedCountries of [[], undefined, 'US']) {
      const { issues } = validateOutreachComplianceSettings({ ...valid, allowedCountries })
      expect(issues).toEqual([
        { field: 'allowedCountries', message: 'Choose at least one country a sequence may send to.' },
      ])
    }
  })

  it('names every value that is not a country code', () => {
    const { issues, settings } = validateOutreachComplianceSettings({
      ...valid,
      allowedCountries: ['US', 'usa', 'XX'],
    })
    expect(issues).toEqual([
      { field: 'allowedCountries', message: '"USA", "XX" aren\'t country codes.' },
    ])
    expect(settings.allowedCountries).toEqual(['US'])
  })
})

describe('readOutreachComplianceSettings (AGL-2980)', () => {
  it('reads a document that was never saved as the defaults: the United States alone', () => {
    expect(readOutreachComplianceSettings(null)).toEqual({
      legalName: '',
      brandName: '',
      postalAddress: '',
      allowedCountries: ['US'],
      updatedAtMs: 0,
      updatedByUid: null,
    })
  })

  it('reads a saved list as saved, dropping codes that are not countries', () => {
    const read = readOutreachComplianceSettings({
      legalName: 'Example Co LLC',
      postalAddress: '100 Example St',
      allowedCountries: ['CA', 'EU', 'us'],
      updatedAtMs: 1_700_000_000_000,
      updatedByUid: 'uid-1',
    })
    expect(read.allowedCountries).toEqual(['CA', 'US'])
    expect(read.updatedByUid).toBe('uid-1')
  })

  it('reads an emptied list as nobody rather than as the default', () => {
    expect(readOutreachComplianceSettings({ allowedCountries: [] }).allowedCountries).toEqual([])
  })
})

describe('the country list (AGL-2980)', () => {
  it('holds the 249 assigned codes, sorted and unique, the United States among them', () => {
    expect(OUTREACH_COUNTRY_CODES).toHaveLength(249)
    expect(new Set(OUTREACH_COUNTRY_CODES).size).toBe(249)
    expect([...OUTREACH_COUNTRY_CODES].sort()).toEqual(OUTREACH_COUNTRY_CODES)
    expect(isOutreachCountryCode('US')).toBe(true)
    expect(isOutreachCountryCode('us')).toBe(false)
    for (const notACountry of ['EU', 'UN', 'ZZ', 'YU', 'UK']) {
      expect(isOutreachCountryCode(notACountry)).toBe(false)
    }
  })

  it('names each country as a list shows it, and offers them by name', () => {
    expect(outreachCountryLabel('US')).toBe('United States')
    const options = outreachCountryOptions()
    expect(options).toHaveLength(249)
    expect(options.find((option) => option.code === 'CA')?.name).toBe('Canada')
    const names = options.map((option) => option.name)
    expect([...names].sort((a, b) => a.localeCompare(b, 'en'))).toEqual(names)
  })
})

describe('the organization is a ceiling over each sequence (AGL-2980)', () => {
  it('keeps the sequence’s countries the organization allows, in the sequence’s order', () => {
    expect(effectiveOutreachAllowedCountries(['CA', 'US', 'GB'], ['US', 'CA'])).toEqual(['CA', 'US'])
    expect(effectiveOutreachAllowedCountries(['GB'], ['US'])).toEqual([])
    expect(effectiveOutreachAllowedCountries(null, ['US'])).toEqual([])
  })

  it('compares two settings field by field, countries in order', () => {
    const settings = validateOutreachComplianceSettings(valid).settings
    expect(outreachComplianceSettingsEqual(settings, { ...settings })).toBe(true)
    expect(
      outreachComplianceSettingsEqual(settings, { ...settings, allowedCountries: ['CA', 'US'] }),
    ).toBe(false)
    expect(outreachComplianceSettingsEqual(settings, { ...settings, brandName: '' })).toBe(false)
  })
})
