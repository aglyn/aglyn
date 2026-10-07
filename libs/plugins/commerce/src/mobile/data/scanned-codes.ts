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

import { TRACKING_NUMBER_MAX_LENGTH } from './limits'

/*
 * What the camera read, as the field it fills (AGL-3621).
 *
 * A shipping label's barcode is not always the tracking number as a carrier's
 * site wants it typed: a USPS label's GS1-128 code leads with the routing
 * prefix `420` and the destination ZIP before the number itself. The carrier
 * is suggested only from shapes that belong to one carrier alone; anything
 * else keeps the merchant's pick, because a wrong carrier sends the buyer to
 * a tracking page that says "not found".
 */

export interface ScannedTracking {
  trackingNumber: string
  /** A carrier label from `FULFILLMENT_CARRIER_CHOICES`, or null to keep the merchant's. */
  carrier: string | null
}

/** USPS GS1-128: `420` + 5- or 9-digit ZIP, then the 20–26 digit IMpb number. */
const USPS_ROUTED = /^420(?:\d{5}|\d{9})(9[1-5]\d{18,24})$/
const USPS_IMPB = /^9[1-5]\d{18,24}$/
const USPS_S10 = /^[A-Z]{2}\d{9}US$/
const UPS = /^1Z[0-9A-Z]{16}$/

/** GS1's group separator (FNC1), which a scanner may hand over inside a code. */
const GROUP_SEPARATOR = String.fromCharCode(0x1d)

const withoutSeparators = (raw: string): string =>
  String(raw ?? '')
    .split(GROUP_SEPARATOR)
    .join('')
    .replace(/\s+/g, '')

export function scannedTracking(raw: string): ScannedTracking | null {
  // A GS1 code can carry the FNC1 group separator; it is not part of the number.
  const code = withoutSeparators(raw).toUpperCase()
  if (!code || code.length > 40 || !/^[0-9A-Z]+$/.test(code)) return null
  const routed = USPS_ROUTED.exec(code)
  if (routed) return { trackingNumber: routed[1], carrier: 'USPS' }
  if (USPS_IMPB.test(code) || USPS_S10.test(code)) return { trackingNumber: code, carrier: 'USPS' }
  if (UPS.test(code)) return { trackingNumber: code, carrier: 'UPS' }
  return code.length <= TRACKING_NUMBER_MAX_LENGTH ? { trackingNumber: code, carrier: null } : null
}

/**
 * A product barcode as `productSearchFields` stores it: trimmed and
 * lower-cased, so the scanned value finds the member the writer wrote.
 */
export function scannedProductCode(raw: string): string | null {
  const code = withoutSeparators(raw).toLowerCase()
  return code && code.length <= 64 ? code : null
}
