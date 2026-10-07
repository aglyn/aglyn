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

import type { BridgeHandler } from '@aglyn/mobile-webview'
import type { CollectOutcome } from '../terminal/collect'
import type { ReaderStatus } from '../terminal/use-pos-terminal'

/*==========================================
 * `window.AglynPosBridge` (AGL-3618).
 *
 * What the web register may ask the app, and nothing more:
 *
 * - `collectCardPayment({ paymentIntentId, clientSecret, amountCents,
 *   tipEligible? })` resolves to `{ status, paymentIntentId, amountCents?,
 *   tipCents?, message? }`, where status is `collected`, `canceled` or
 *   `failed`. It never rejects for a payment problem: a missing reader, an
 *   update in progress or a malformed request is `failed` with words the
 *   register shows. The register then asks ITS server to settle the payment,
 *   which re-reads the intent from Stripe.
 * - `cancel()` → `{ canceled: true }`: stops a collection in progress.
 * - `readerStatus()` → `{ connected, kind, name, updateRequired }`.
 *
 * The page feature-detects the global; the web bundle imports nothing from
 * the app (the zero-bundle rule), so this name and these shapes ARE the
 * contract, restated in `pos-page`'s few lines.
 *=========================================*/

export const POS_BRIDGE_NAME = 'AglynPosBridge'

export interface PosBridgeDeps {
  collect: (params: Record<string, unknown>) => Promise<CollectOutcome>
  cancel: () => Promise<{ canceled: boolean }>
  status: () => ReaderStatus
  /** No reader is connected: show the readers panel. */
  onNeedsReader: () => void
}

export function createPosBridgeHandlers(deps: PosBridgeDeps): Record<string, BridgeHandler> {
  return {
    collectCardPayment: async (params) => {
      const paymentIntentId = typeof params['paymentIntentId'] === 'string' ? params['paymentIntentId'] : ''
      const failed = (message: string): CollectOutcome => ({ status: 'failed', paymentIntentId, message })
      const status = deps.status()
      if (!status.connected) {
        deps.onNeedsReader()
        return failed('Connect Tap to Pay or a card reader first.')
      }
      if (status.updateRequired || status.updating) {
        deps.onNeedsReader()
        return failed('The card reader is updating. Try again when it finishes.')
      }
      try {
        return await deps.collect(params)
      } catch (error) {
        return failed(error instanceof Error ? error.message : 'The card could not be read. Try again.')
      }
    },
    cancel: async () => await deps.cancel(),
    readerStatus: async () => {
      const status = deps.status()
      return {
        connected: status.connected,
        kind: status.kind,
        name: status.name,
        updateRequired: status.updateRequired || status.updating,
      }
    },
  }
}
