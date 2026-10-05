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
  currencyMinorUnits,
  deriveBoolean,
  deriveCurrency,
  deriveDate,
  deriveDateTime,
  deriveEmail,
  deriveInteger,
  deriveJson,
  deriveNumber,
  derivePercent,
  derivePhone,
  deriveText,
  deriveTransferCell,
  deriveTransferRow,
  deriveUrl,
  mapTransferRow,
  parseAddressLine,
  parseImportFlag,
  parseLocaleNumber,
  splitFullName,
  splitTransferList,
} from './derive'
import type { DerivedValue } from './derive'
import type { TransferField } from './resource'

const kinds = (result: DerivedValue<unknown>): string[] => result.derivations.map((entry) => entry.kind)
const flagged = (result: DerivedValue<unknown>): boolean => result.derivations.some((entry) => entry.flagged)

describe('blank and unreadable cells', () => {
  it('reads an empty cell as blank, never as a problem', () => {
    for (const parse of [deriveText, deriveEmail, deriveDate, deriveNumber, deriveCurrency, deriveBoolean, deriveUrl]) {
      expect(parse('   ')).toEqual({ value: null, blank: true, ok: true, derivations: [] })
    }
  })

  it('drops an unreadable cell with a reason instead of storing it', () => {
    expect(deriveNumber('twelve')).toMatchObject({ ok: false, value: null, problem: { code: 'invalidNumber' } })
  })
})

describe('deriveText', () => {
  it('trims and single-spaces a line, keeps line breaks in long text, and flags a cut', () => {
    expect(deriveText('  a   b ').value).toBe('a b')
    expect(deriveText('one\r\ntwo', { multiline: true }).value).toBe('one\ntwo')
    const cut = deriveText('abcdef', { maxLength: 3 })
    expect(cut.value).toBe('abc')
    expect(kinds(cut)).toEqual(['truncated'])
    expect(flagged(cut)).toBe(true)
  })
})

describe('booleans', () => {
  it('keeps parseImportFlag reading the words consent and checkbox columns carry', () => {
    expect(parseImportFlag('Opted In')).toBe(true)
    expect(parseImportFlag('unsubscribed')).toBe(false)
    expect(parseImportFlag('')).toBe(false)
    expect(parseImportFlag(1)).toBe(true)
    expect(parseImportFlag(2)).toBeNull()
    expect(parseImportFlag('maybe')).toBeNull()
  })

  it('records a word read as yes or no, and refuses anything else', () => {
    expect(deriveBoolean('true')).toMatchObject({ value: true, derivations: [] })
    const yes = deriveBoolean('Y')
    expect(yes.value).toBe(true)
    expect(kinds(yes)).toEqual(['booleanWord'])
    expect(deriveBoolean('perhaps').problem?.code).toBe('invalidBoolean')
  })
})

describe('deriveEmail', () => {
  it('lowercases and records it', () => {
    const result = deriveEmail(' Jane@Example.COM ')
    expect(result.value).toBe('jane@example.com')
    expect(kinds(result)).toEqual(['lowercased'])
  })

  it('takes the address out of a display name or a mailto link', () => {
    expect(deriveEmail('Jane Doe <jane@example.com>').value).toBe('jane@example.com')
    expect(deriveEmail('mailto:jane@example.com?subject=hi').value).toBe('jane@example.com')
  })

  it('refuses what is not an address', () => {
    expect(deriveEmail('jane at example').problem?.code).toBe('invalidEmail')
    expect(deriveEmail('jane@example').ok).toBe(false)
  })
})

describe('derivePhone', () => {
  it('writes a US number in international format through normalizePhone', () => {
    const result = derivePhone('(512) 555-0107')
    expect(result.value).toBe('+15125550107')
    expect(kinds(result)).toEqual(['phoneNormalized'])
    expect(derivePhone('+15125550107').derivations).toEqual([])
  })

  it('keeps a number it cannot normalize as typed, flagged', () => {
    const result = derivePhone('020 7946 0018', { defaultCountry: 'GB' })
    expect(result.value).toBe('020 7946 0018')
    expect(kinds(result)).toEqual(['phoneUnnormalized'])
    expect(flagged(result)).toBe(true)
  })

  it('drops an extension, flagged', () => {
    const result = derivePhone('512-555-0107 x204')
    expect(result.value).toBe('+15125550107')
    expect(kinds(result)).toEqual(['phoneExtensionDropped', 'phoneNormalized'])
  })
})

describe('deriveUrl', () => {
  it('adds https to a bare domain and lowercases the host only', () => {
    const result = deriveUrl('Example.COM/About')
    expect(result.value).toBe('https://example.com/About')
    expect(kinds(result)).toEqual(['urlScheme'])
    expect(deriveUrl('http://example.com').value).toBe('http://example.com')
  })

  it('refuses what is not a web address', () => {
    expect(deriveUrl('not a site').problem?.code).toBe('invalidUrl')
    expect(deriveUrl('ftp://example.com').ok).toBe(false)
  })
})

describe('deriveDate', () => {
  it('reads ISO dates as they are and drops a time', () => {
    expect(deriveDate('2024-03-05')).toMatchObject({ value: '2024-03-05', derivations: [] })
    const timed = deriveDate('2024-03-05T10:00:00Z')
    expect(timed.value).toBe('2024-03-05')
    expect(kinds(timed)).toEqual(['timeDropped'])
  })

  it('reads year-first dates with slashes, dots or no separator', () => {
    expect(deriveDate('2024/3/5').value).toBe('2024-03-05')
    expect(deriveDate('20240305').value).toBe('2024-03-05')
  })

  it('reads the order from a day above twelve', () => {
    expect(deriveDate('25/12/2024').value).toBe('2024-12-25')
    expect(deriveDate('12/25/2024').value).toBe('2024-12-25')
    expect(flagged(deriveDate('25/12/2024'))).toBe(false)
  })

  it('flags a date whose day and month could be swapped, reading it in the preferred order', () => {
    const us = deriveDate('03/05/2024')
    expect(us.value).toBe('2024-03-05')
    expect(kinds(us)).toEqual(['ambiguousDate'])
    expect(flagged(us)).toBe(true)
    expect(deriveDate('03/05/2024', { preferredOrder: 'dmy' }).value).toBe('2024-05-03')
    expect(deriveDate('03/03/2024').derivations[0]?.kind).toBe('dateFormat')
  })

  it('obeys an order the person fixed', () => {
    const fixed = deriveDate('03.05.2024', { order: 'dmy' })
    expect(fixed.value).toBe('2024-05-03')
    expect(flagged(fixed)).toBe(false)
  })

  it('reads two-digit years around the pivot, flagged', () => {
    expect(deriveDate('1/2/49').value).toBe('2049-01-02')
    const old = deriveDate('1/2/50')
    expect(old.value).toBe('1950-01-02')
    expect(kinds(old)).toContain('twoDigitYear')
  })

  it('reads month names in either order', () => {
    expect(deriveDate('March 5, 2024').value).toBe('2024-03-05')
    expect(deriveDate('5 Mar 2024').value).toBe('2024-03-05')
    expect(deriveDate('Tue, Mar 5, 2024').value).toBe('2024-03-05')
    expect(deriveDate('5th September 2024').value).toBe('2024-09-05')
    expect(deriveDate('Smarch 5, 2024').ok).toBe(false)
  })

  it('reads a spreadsheet serial day, flagged, unless told not to', () => {
    const serial = deriveDate('45356')
    expect(serial.value).toBe('2024-03-05')
    expect(kinds(serial)).toEqual(['excelSerial'])
    expect(deriveDate(45356).value).toBe('2024-03-05')
    expect(deriveDate('45356', { excelSerials: false }).ok).toBe(false)
  })

  it('refuses impossible dates', () => {
    expect(deriveDate('2023-02-29').problem?.code).toBe('invalidDate')
    expect(deriveDate('31/31/2024').ok).toBe(false)
    expect(deriveDate('soon').ok).toBe(false)
  })
})

describe('deriveDateTime', () => {
  it('keeps a zoned time exact', () => {
    expect(deriveDateTime('2024-03-05T10:30:00+02:00')).toMatchObject({ value: '2024-03-05T08:30:00.000Z', derivations: [] })
  })

  it('reads a zone-less time in the given offset, flagged', () => {
    const utc = deriveDateTime('2024-03-05 14:30')
    expect(utc.value).toBe('2024-03-05T14:30:00.000Z')
    expect(kinds(utc)).toEqual(['zoneAssumed'])
    expect(flagged(utc)).toBe(true)
    expect(deriveDateTime('2024-03-05 14:30', { offsetMinutes: -300 }).value).toBe('2024-03-05T19:30:00.000Z')
  })

  it('reads twelve-hour clocks and a trailing zone', () => {
    expect(deriveDateTime('12/25/2024 2:05 PM UTC').value).toBe('2024-12-25T14:05:00.000Z')
    expect(deriveDateTime('12/25/2024 12:00 am Z').value).toBe('2024-12-25T00:00:00.000Z')
    expect(deriveDateTime('12/25/2024 13:00 PM').ok).toBe(false)
  })

  it('reads a date alone as midnight without a zone warning', () => {
    const day = deriveDateTime('2024-03-05')
    expect(day.value).toBe('2024-03-05T00:00:00.000Z')
    expect(kinds(day)).toEqual(['timeAssumed'])
    expect(flagged(day)).toBe(false)
  })

  it('reads Unix seconds and milliseconds, flagged', () => {
    expect(deriveDateTime('1709634600').value).toBe('2024-03-05T10:30:00.000Z')
    const ms = deriveDateTime('1709634600000')
    expect(ms.value).toBe('2024-03-05T10:30:00.000Z')
    expect(kinds(ms)).toEqual(['epochTime'])
  })

  it('reads a spreadsheet serial with a fraction as a time', () => {
    expect(deriveDateTime('45356.5').value).toBe('2024-03-05T12:00:00.000Z')
  })

  it('refuses nonsense', () => {
    expect(deriveDateTime('yesterday-ish').problem?.code).toBe('invalidDateTime')
    expect(deriveDateTime('2024-03-05 25:00').ok).toBe(false)
  })
})

describe('numbers', () => {
  it('reads plain numbers without a record', () => {
    expect(deriveNumber('12.5')).toMatchObject({ value: 12.5, derivations: [] })
    expect(deriveNumber(7).value).toBe(7)
    expect(deriveNumber('-3').value).toBe(-3)
    expect(deriveNumber('1e3').value).toBe(1000)
  })

  it('reads thousands separators and a decimal comma, recording each', () => {
    expect(deriveNumber('1,234.56').value).toBe(1234.56)
    const european = deriveNumber('1.234,56')
    expect(european.value).toBe(1234.56)
    expect(kinds(european)).toEqual(['thousandsSeparator', 'decimalComma'])
    expect(deriveNumber('1 234 567,89').value).toBe(1234567.89)
    expect(deriveNumber("1'234.5").value).toBe(1234.5)
    expect(deriveNumber('12,5').value).toBe(12.5)
    expect(deriveNumber('1.234.567').value).toBe(1234567)
  })

  it('flags a lone grouped comma as a guess under auto', () => {
    const guess = deriveNumber('1,234')
    expect(guess.value).toBe(1234)
    expect(kinds(guess)).toEqual(['ambiguousNumber'])
    expect(flagged(guess)).toBe(true)
    expect(deriveNumber('1,234', { decimal: ',' }).value).toBe(1.234)
    expect(deriveNumber('1,234', { decimal: '.' }).derivations[0]?.kind).toBe('thousandsSeparator')
    expect(deriveNumber('1.234', { decimal: ',' }).value).toBe(1234)
  })

  it('reads parentheses and a trailing minus as negative', () => {
    expect(deriveNumber('(12.50)').value).toBe(-12.5)
    expect(deriveNumber('12-').value).toBe(-12)
  })

  it('refuses badly grouped numbers', () => {
    expect(deriveNumber('1,23,4.5').ok).toBe(false)
    expect(deriveNumber('1.2.3').ok).toBe(false)
    expect(parseLocaleNumber('12abc')).toBeNull()
  })

  it('refuses a fraction for a whole number rather than rounding it', () => {
    expect(deriveInteger('12').value).toBe(12)
    expect(deriveInteger('12.0').value).toBe(12)
    expect(deriveInteger('12.5').problem?.code).toBe('notInteger')
  })
})

describe('deriveCurrency', () => {
  it('reads a symbol as its currency and stores minor units', () => {
    const euros = deriveCurrency('€1.234,50')
    expect(euros.value).toEqual({ amountMinor: 123450, currency: 'EUR' })
    expect(kinds(euros)).toContain('currencySymbol')
    expect(deriveCurrency('£12').value).toEqual({ amountMinor: 1200, currency: 'GBP' })
  })

  it('reads a code on either side', () => {
    expect(deriveCurrency('USD 12.00').value).toEqual({ amountMinor: 1200, currency: 'USD' })
    expect(deriveCurrency('12.5 cad').value).toEqual({ amountMinor: 1250, currency: 'CAD' })
  })

  it('reads a dollar sign as the default currency when that is a dollar', () => {
    expect(deriveCurrency('$5', { defaultCurrency: 'CAD' }).value).toEqual({ amountMinor: 500, currency: 'CAD' })
    expect(deriveCurrency('$5', { defaultCurrency: 'EUR' }).value).toEqual({ amountMinor: 500, currency: 'USD' })
    expect(deriveCurrency('US$5', { defaultCurrency: 'CAD' }).value?.currency).toBe('USD')
  })

  it('assumes the default currency for a bare number and records it', () => {
    const bare = deriveCurrency('99.99')
    expect(bare.value).toEqual({ amountMinor: 9999, currency: 'USD' })
    expect(kinds(bare)).toEqual(['currencyAssumed'])
  })

  it('respects currencies without cents and flags rounding', () => {
    expect(currencyMinorUnits('jpy')).toBe(0)
    expect(deriveCurrency('¥1,500').value).toEqual({ amountMinor: 1500, currency: 'JPY' })
    const rounded = deriveCurrency('1.005 USD')
    expect(kinds(rounded)).toContain('rounded')
    expect(flagged(rounded)).toBe(true)
  })

  it('reads negatives in parentheses and refuses words', () => {
    expect(deriveCurrency('($3.25)').value).toEqual({ amountMinor: -325, currency: 'USD' })
    expect(deriveCurrency('free').problem?.code).toBe('invalidCurrency')
  })
})

describe('derivePercent', () => {
  it('reads a percent sign without a record', () => {
    expect(derivePercent('12%')).toMatchObject({ value: 12, derivations: [] })
    expect(derivePercent('12.5 %', { scale: 'fraction' }).value).toBe(0.125)
  })

  it('reads a bare fraction as a percent, flagged', () => {
    const fraction = derivePercent('0.25')
    expect(fraction.value).toBe(25)
    expect(kinds(fraction)).toEqual(['percentScaled'])
    expect(flagged(fraction)).toBe(true)
    expect(derivePercent('40').value).toBe(40)
  })

  it('refuses words', () => {
    expect(derivePercent('lots').problem?.code).toBe('invalidPercent')
  })
})

describe('splitFullName', () => {
  it('splits at the last word and records the rule', () => {
    const result = splitFullName('Jane Q Public')
    expect(result.value).toEqual({ first: 'Jane Q', last: 'Public', rule: 'lastWord' })
    expect(kinds(result)).toEqual(['nameSplit'])
  })

  it('reads "Last, First"', () => {
    expect(splitFullName('Public, Jane').value).toEqual({ first: 'Jane', last: 'Public', rule: 'lastCommaFirst' })
  })

  it('drops an honorific and keeps a suffix with the last name', () => {
    const result = splitFullName('Dr. Martin Luther King Jr.')
    expect(result.value).toEqual({ first: 'Martin Luther', last: 'King Jr.', rule: 'lastWord' })
    expect(kinds(result)).toEqual(['honorificDropped', 'nameSplit'])
    expect(splitFullName('Sammy Davis, Jr.').value?.last).toBe('Davis Jr.')
  })

  it('starts the last name at a surname particle', () => {
    expect(splitFullName('Ludwig van Beethoven').value).toEqual({
      first: 'Ludwig',
      last: 'van Beethoven',
      rule: 'surnameParticle',
    })
    expect(splitFullName('Maria de la Cruz').value?.last).toBe('de la Cruz')
  })

  it('keeps a single word as the first name', () => {
    expect(splitFullName('Cher').value).toEqual({ first: 'Cher', last: null, rule: 'singleWord' })
  })
})

describe('parseAddressLine', () => {
  it('splits a full one-line address, flagged', () => {
    const result = parseAddressLine('123 Main St, Suite 4, Austin, TX 78701, USA')
    expect(result.value).toEqual({
      line1: '123 Main St, Suite 4',
      city: 'Austin',
      state: 'TX',
      postalCode: '78701',
      country: 'US',
    })
    expect(kinds(result)).toEqual(['addressSplit'])
    expect(flagged(result)).toBe(true)
  })

  it('reads a postal code on its own and a country name', () => {
    expect(parseAddressLine('10 Downing St, London, SW1A 2AA, United Kingdom').value).toEqual({
      line1: '10 Downing St',
      city: 'London',
      postalCode: 'SW1A 2AA',
      country: 'GB',
    })
  })

  it('reads lines as parts and keeps a lone line as the street', () => {
    expect(parseAddressLine('1 Infinite Loop\nCupertino\nCA 95014').value).toEqual({
      line1: '1 Infinite Loop',
      city: 'Cupertino',
      state: 'CA',
      postalCode: '95014',
    })
    expect(parseAddressLine('PO Box 7').value).toEqual({ line1: 'PO Box 7' })
  })

  it('passes an address object from a JSON file through', () => {
    expect(parseAddressLine({ city: 'Austin' })).toMatchObject({ value: { city: 'Austin' }, derivations: [] })
  })
})

describe('splitTransferList', () => {
  it('splits on commas, semicolons, pipes and line breaks, dropping repeats', () => {
    const result = splitTransferList('VIP; vip | Partner,\nbeta')
    expect(result.value).toEqual(['VIP', 'Partner', 'beta'])
    expect(kinds(result)).toEqual(['listSplit', 'listDeduplicated'])
  })

  it('lowercases tags and caps the count, flagged', () => {
    const result = splitTransferList('A,B,C', { lowercase: true, max: 2 })
    expect(result.value).toEqual(['a', 'b'])
    expect(flagged(result)).toBe(true)
  })

  it('takes an array item by item without a split record', () => {
    expect(splitTransferList(['x', ' y '])).toMatchObject({ value: ['x', 'y'], derivations: [] })
    expect(splitTransferList(' , ;').blank).toBe(true)
  })
})

describe('deriveJson', () => {
  it('parses text and passes objects through', () => {
    expect(deriveJson('{"a":1}').value).toEqual({ a: 1 })
    expect(deriveJson({ a: 1 }).value).toEqual({ a: 1 })
    expect(deriveJson('{').problem?.code).toBe('invalidJson')
  })
})

describe('deriveTransferCell and rows', () => {
  const fields: TransferField[] = [
    { id: 'email', label: 'Email', type: 'email' },
    { id: 'amount', label: 'Amount', type: 'currency' },
    { id: 'tags', label: 'Tags', type: 'tags' },
    { id: 'since', label: 'Since', type: 'date' },
    { id: 'note', label: 'Note', type: 'longText', maxLength: 5 },
    { id: 'stage', label: 'Stage', type: 'picklist', picklistId: 'stage' },
  ]
  const byId = new Map(fields.map((field) => [field.id, field]))

  it('dispatches by field type', () => {
    expect(deriveTransferCell(byId.get('tags') as TransferField, 'A|B').value).toEqual(['a', 'b'])
    expect(deriveTransferCell(byId.get('stage') as TransferField, '  Won ').value).toBe('Won')
    expect(deriveTransferCell(byId.get('note') as TransferField, 'abcdefg').value).toBe('abcde')
  })

  it('maps cells by column, keeping blank mapped cells and ignoring unmapped ones', () => {
    expect(mapTransferRow(['a@b.co', '', 'x'], { 0: 'email', 1: 'amount', 2: null })).toEqual({ email: 'a@b.co', amount: '' })
  })

  it('reads a row: values, located derivations, and located problems', () => {
    const row = deriveTransferRow(byId, {
      email: 'A@B.CO',
      amount: '',
      since: 'not a date',
      tags: 'x,y',
      unknown: 'ignored',
    })
    expect(row.values).toEqual({ email: 'a@b.co', amount: null, tags: ['x', 'y'] })
    expect(row.derivations.map((entry) => [entry.fieldId, entry.kind])).toEqual([
      ['email', 'lowercased'],
      ['tags', 'listSplit'],
    ])
    expect(row.problems).toEqual([
      { fieldId: 'since', raw: 'not a date', code: 'invalidDate', message: '"not a date" is not a date.' },
    ])
  })
})
