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

import type { AdProviderId } from '../model/connections'
import type { ConversionEvent } from './event'
import type { ProviderHttp } from './http'
import { sendMetaEvent } from './meta'
import { sendPinterestEvent } from './pinterest'
import { sendTikTokEvent } from './tiktok'

/**
 * Where one event goes and how (AGL-3694): the merchant's token, the id the
 * vendor addresses (the pixel for Meta and TikTok, the ad account for
 * Pinterest), and the test marker when the event is a test.
 */
export interface ConversionTarget {
  token: string
  /** Meta pixel id or TikTok pixel code. */
  pixelId: string | null
  /** Pinterest ad account id. */
  adAccountId: string | null
  /**
   * `null` for a live event. For a test: the vendor's test event code (Meta,
   * TikTok) or `true` for Pinterest's test flag. An adapter that cannot mark a
   * test refuses to send it — a test is never sent as live.
   */
  test: string | true | null
}

export type ConversionSender = (http: ProviderHttp, target: ConversionTarget, event: ConversionEvent) => Promise<void>

export const CONVERSION_SENDERS: Readonly<Record<AdProviderId, ConversionSender>> = {
  meta: sendMetaEvent,
  tiktok: sendTikTokEvent,
  pinterest: sendPinterestEvent,
}
