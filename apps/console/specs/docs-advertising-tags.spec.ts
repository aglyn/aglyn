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
 * The docs site's copy of the advertising vendor descriptors cannot drift.
 *
 * `apps/docs` is a Docusaurus app in its own Vercel project and cannot import
 * from `libs/` (AGL-1595), so the vendor table, the boot snippets and the
 * teardown are duplicated there. The same treatment the consent-mode default
 * and the internal-traffic stamp already get next door, and here the stakes
 * are the shape of a whole vendor: a stale copy runs without error, mounts a
 * tag, and looks exactly like a working one — while sweeping a cookie name the
 * vendor stopped using, or booting a pixel with a snippet the vendor changed.
 *
 * The comparison is against the SHIPPING CONSTANT rather than against a second
 * transcription of it: each boot snippet is extracted from the docs source and
 * evaluated, then compared to `vendor.bootSnippet(...)` for the same probe id.
 * A test that compared two hand-written strings would go green the moment
 * somebody updated both and neither matched the vendor.
 *
 * PLANTED RED (verified): change `_fbc` to `_fbcc` in the docs cookie list.
 */

import {
  ADVERTISING_TAG_ATTRIBUTE,
  type AdvertisingVendor,
  GOOGLE_ADS_VENDOR,
  LINKEDIN_INSIGHT_VENDOR,
  META_PIXEL_VENDOR,
} from '@aglyn/aglyn/app-utils/advertising-tags'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const DOCS_MODULE = resolve(__dirname, '../../docs/src/advertising-tags.ts')
const DOCS_CONFIG = resolve(__dirname, '../../docs/docusaurus.config.ts')

const source = readFileSync(DOCS_MODULE, 'utf8')
const config = readFileSync(DOCS_CONFIG, 'utf8')

/** An id that satisfies no vendor pattern by accident — a marker, not a value. */
const PROBE = '__PROBE__'

/**
 * The docs source for one vendor: everything from its `id:` line to the start
 * of the next vendor, or to the end of the table.
 */
function vendorBlock(vendorId: string): string {
  const start = source.indexOf(`    id: '${vendorId}',`)
  if (start < 0) return ''
  const next = source.indexOf('\n  {\n    id: ', start)
  const end = next < 0 ? source.indexOf('\n]\n', start) : next
  return source.slice(start, end < 0 ? source.length : end)
}

/**
 * The docs `bootSnippet` for one vendor, as a callable.
 *
 * Extracted and EVALUATED rather than string-matched, because the two files
 * are free to break their string concatenation at different points and a
 * source-text comparison would fail on formatting while passing on a genuine
 * character change inside a literal. What has to match is the string the
 * browser receives.
 */
function docsBootSnippet(vendorId: string): (accountId: string) => string {
  const block = vendorBlock(vendorId)
  const marker = 'bootSnippet: (accountId: string) =>'
  const start = block.indexOf(marker)
  const end = block.indexOf('    setConsent:', start)
  let expression = block.slice(start + marker.length, end).trim()
  if (expression.endsWith(',')) expression = expression.slice(0, -1)
  return eval(`(accountId) => (${expression})`) as (id: string) => string
}

/** A quoted-string list from the docs source, e.g. `cookiePrefixes: [...]`. */
function docsStringList(vendorId: string, field: string): string[] {
  const block = vendorBlock(vendorId)
  const start = block.indexOf(`${field}: [`)
  if (start < 0) return []
  const end = block.indexOf(']', start)
  return Array.from(block.slice(start, end).matchAll(/'([^']*)'/g)).map(
    (match) => match[1],
  )
}

/** A single quoted-string field from the docs source. */
function docsStringField(vendorId: string, field: string): string {
  const block = vendorBlock(vendorId)
  const match = block.match(new RegExp(`${field}: '([^']*)'`))
  return match ? match[1] : ''
}

/** A regex-literal field from the docs source. */
function docsPatternField(vendorId: string, field: string): string {
  const block = vendorBlock(vendorId)
  // Anchored to the end of the line rather than to the next comma: a quantifier
  // like `{8,20}` puts a comma INSIDE the literal, and a comma-terminated match
  // would silently return nothing for exactly the patterns worth checking.
  const match = block.match(new RegExp(`${field}: (/.*/),$`, 'm'))
  return match ? match[1] : ''
}

const VENDORS: ReadonlyArray<[string, AdvertisingVendor]> = [
  ['meta', META_PIXEL_VENDOR],
  ['google-ads', GOOGLE_ADS_VENDOR],
  ['linkedin', LINKEDIN_INSIGHT_VENDOR],
]

describe("the docs site's advertising vendor copy", () => {
  /**
   * THE CONTROL for the extractor itself. Every comparison below runs through
   * `vendorBlock`, so an extractor that silently returned nothing would make
   * the whole suite compare empty strings to empty strings and pass.
   */
  it('extracts a non-empty block for every vendor it claims to check', () => {
    for (const [vendorId] of VENDORS) {
      expect(vendorBlock(vendorId).length).toBeGreaterThan(200)
      expect(vendorBlock(vendorId)).toContain('bootSnippet')
    }
    expect(vendorBlock('a-vendor-that-does-not-exist')).toBe('')
  })

  it.each(VENDORS)(
    'boots %s with byte-identical script to the shipping vendor',
    (vendorId, vendor) => {
      const expected = vendor.bootSnippet?.(PROBE) ?? ''
      expect(expected).not.toBe('')
      expect(docsBootSnippet(vendorId)(PROBE)).toBe(expected)
      // And the probe really did reach the snippet — a boot that ignored its
      // argument would compare equal for the wrong reason.
      expect(docsBootSnippet(vendorId)(PROBE)).toContain(PROBE)
    },
  )

  it.each(VENDORS)('names %s\'s library and cookies exactly', (vendorId, vendor) => {
    expect(docsStringField(vendorId, 'scriptSrc')).toBe(vendor.scriptSrc)
    expect(docsStringField(vendorId, 'scriptMatch')).toBe(vendor.scriptMatch)
    expect(docsStringList(vendorId, 'cookiePrefixes')).toEqual([
      ...vendor.cookiePrefixes,
    ])
    expect(docsPatternField(vendorId, 'accountIdPattern')).toBe(
      String(vendor.accountIdPattern),
    )
  })

  it("shares the library marker for the vendor that shares a library", () => {
    // Google Ads rides the `gtag/js` the docs GA preset already loaded. A copy
    // that dropped this would fetch the library twice and define `gtag()`
    // twice on every docs page that runs both.
    expect(docsStringField('google-ads', 'sharesLibrary')).toBe(
      GOOGLE_ADS_VENDOR.sharesLibrary,
    )
    expect(docsStringField('meta', 'sharesLibrary')).toBe('')
  })

  it('marks its elements with the shared teardown attribute', () => {
    // The attribute is what scopes the teardown. A copy using a different one
    // would mount tags nothing could ever remove.
    expect(source).toContain(`const AD_TAG_ATTRIBUTE = '${ADVERTISING_TAG_ATTRIBUTE}'`)
  })

  it('fails closed on the consent status, matching the shared rule', () => {
    // ⚠️ VERBATIM: `advertisingGrantedByStatus` is an exact match against the
    // granting statuses. An exclusion list would grant every unknown, absent
    // or future status.
    expect(source).toContain(
      "return status === 'accepted' || status === 'implied'",
    )
    expect(source).not.toContain("status !== 'declined'")
  })

  it('is registered as a client module and fed its ids by the config', () => {
    // The copy being correct is worth nothing if the build never loads it.
    expect(config).toContain("'./src/advertising-tags.ts'")
    expect(config).toContain('advertisingTagIds: docsAdvertisingTagIds')
    expect(config).toContain('gtmContainerId: docsGtmContainerId ?? null')
  })

  it('hardcodes no vendor id, so an operator build loads none', () => {
    // AGL-2124 in its most damaging form: a bare id here would put a
    // self-hosted install's readers into Aglyn's retargeting audiences.
    for (const value of [
      '1931535658229774',
      'AW-18401436785',
      '9626898',
      'GTM-N65S88G',
    ]) {
      expect(source).not.toContain(value)
      expect(config).not.toContain(value)
    }
    expect(config).toContain("env('DOCS_META_PIXEL_ID')")
    expect(config).toContain("env('DOCS_LINKEDIN_PARTNER_ID')")
    expect(config).toContain("env('DOCS_ADS_CONVERSION_ID')")
    expect(config).toContain("env('DOCS_GTM_CONTAINER_ID')")
  })
})
