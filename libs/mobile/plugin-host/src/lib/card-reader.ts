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
 * The server side of an app's card reader (AGL-3618), as a service contract.
 *
 * A card-reader SDK needs a short-lived connection credential, minted by a
 * server route for ONE site and scoped to that site's registered location,
 * and that location must exist before a reader may connect. The routes
 * belong to the plugin that takes the payments; the reader belongs to the
 * app. So the plugin provides this contract and the app's reader code
 * resolves it, and neither names the other.
 */

import type { MobileApiClient } from './types'
import { defineMobileServiceContract } from './services'

/** What one site's reader session runs under. */
export interface MobileCardReaderSession {
  /** The connection credential. Handed to the SDK, never stored. */
  readonly secret: string
  /** The site's registered location, which every reader connects under. */
  readonly locationId: string
  /** The merchant account a phone's own reader (Tap to Pay) charges for. */
  readonly onBehalfOf: string | null
  /** The name the customer sees on the phone's payment sheet. */
  readonly merchantDisplayName: string
  /** Test-mode keys: simulated readers and test cards only. */
  readonly testMode: boolean
}

/**
 * Why a site cannot connect a reader yet, each fixable: card readers are not
 * offered on this deployment, the store's payments are not set up, or the
 * store has no address registered as its location.
 */
export type MobileCardReaderSetupCode = 'unavailable' | 'merchant-not-ready' | 'location-required'

export class MobileCardReaderSetupError extends Error {
  readonly code: MobileCardReaderSetupCode
  constructor(code: MobileCardReaderSetupCode, message: string) {
    super(message)
    this.name = 'MobileCardReaderSetupError'
    this.code = code
  }
}

/** A store address, as the location is registered from. */
export interface MobileCardReaderAddress {
  line1: string
  line2?: string
  city: string
  state?: string
  postalCode: string
  /** ISO 3166-1 alpha-2. */
  country: string
}

export interface MobileCardReaderBackend {
  /** A fresh session for the site; rejects with a `MobileCardReaderSetupError` when one cannot exist yet. */
  session(api: MobileApiClient, hostId: string): Promise<MobileCardReaderSession>
  /** Registers the site's location once; the server keeps the first. */
  registerLocation(api: MobileApiClient, hostId: string, address: MobileCardReaderAddress): Promise<void>
}

export const MOBILE_CARD_READER_BACKEND =
  defineMobileServiceContract<MobileCardReaderBackend>('card-reader-backend')

/** Null when the address can register a location; otherwise what to fix. */
export function cardReaderAddressProblem(address: Partial<MobileCardReaderAddress>): string | null {
  if (!address.line1?.trim() || !address.city?.trim() || !address.postalCode?.trim() || !address.country?.trim()) {
    return 'Enter the street, city, postal code and country where you take payments.'
  }
  if (!/^[A-Za-z]{2}$/.test(address.country.trim())) return 'Use a two-letter country code, like US.'
  return null
}
