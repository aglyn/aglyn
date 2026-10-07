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

import { formatMediaRef, resolveMediaSrc } from '@aglyn/aglyn/app-utils/media-ref'
import { posReceiptHtml, posReceiptLogoUrl } from './pos-receipt'
import type { PosReceipt } from '../../../model/commerce-pos-ops'

/**
 * The logo a thermal receipt prints (AGL-3609). A logo chosen from the media
 * library is stored as a `media:` reference, not a URL; the receipt must
 * resolve it as the customer display does, or it never prints.
 */
const HOST = 'host-candles'
const ORIGIN = 'https://app.example.test'

describe('posReceiptLogoUrl', () => {
  it('resolves a media-library reference to an absolute URL on the console', () => {
    const ref = formatMediaRef(HOST, 'logo-1')
    expect(ref).toBeDefined()
    const url = posReceiptLogoUrl(ref, HOST, ORIGIN)
    expect(url).toBe(`${ORIGIN}${resolveMediaSrc(ref, { hostId: HOST })}`)
  })

  it('keeps an https URL as it is', () => {
    expect(posReceiptLogoUrl('https://cdn.example.test/logo.png', HOST, ORIGIN)).toBe(
      'https://cdn.example.test/logo.png',
    )
  })

  it('prints nothing for an insecure, unresolvable or missing logo', () => {
    expect(posReceiptLogoUrl('http://cdn.example.test/logo.png', HOST, ORIGIN)).toBeUndefined()
    expect(posReceiptLogoUrl(formatMediaRef(HOST, 'logo-1'), HOST, 'http://localhost:4200')).toBeUndefined()
    expect(posReceiptLogoUrl(formatMediaRef(HOST, 'logo-1'), HOST, null)).toBeUndefined()
    expect(posReceiptLogoUrl(undefined, HOST, ORIGIN)).toBeUndefined()
    expect(posReceiptLogoUrl(42, HOST, ORIGIN)).toBeUndefined()
  })

  it('reaches the printed receipt', () => {
    const logoUrl = posReceiptLogoUrl(formatMediaRef(HOST, 'logo-1'), HOST, ORIGIN)
    const receipt: PosReceipt = {
      storeName: 'Candles',
      logoUrl,
      addressLines: [],
      orderNumber: '1001',
      barcodeValue: '1001',
      dateLabel: 'Oct 7, 2026',
      lines: [],
      subtotalCents: 0,
      discountCents: 0,
      taxCents: 0,
      totalCents: 0,
      tipCents: 0,
      tenders: [],
      changeCents: 0,
      refundedCents: 0,
      gift: false,
    }
    expect(posReceiptHtml(receipt)).toContain(`<img class="logo" src="${logoUrl}"`)
  })
})
