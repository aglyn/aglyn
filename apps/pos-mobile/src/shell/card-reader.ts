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

import type { MobileCardCollectOutcome, MobileCardReader } from '@aglyn/mobile-plugin-host'
import type { PosTerminal } from '../terminal/use-pos-terminal'

/**
 * The device's card reader as the plugin context carries it (AGL-3618): what
 * a plugin's screen may do with the Terminal SDK, and nothing more. A
 * collection never rejects; a reader that is missing or mid-update is a
 * `failed` outcome with words to read out, and opens the readers panel.
 */
export function cardReaderFor(
  terminal: Pick<PosTerminal, 'status' | 'context' | 'message' | 'collect' | 'cancel'>,
  manage: () => void,
): MobileCardReader {
  const status = terminal.status
  return {
    state: {
      connected: status.connected,
      kind: status.kind,
      label: status.name,
      busy: status.busy,
      testMode: terminal.context?.testMode ?? false,
      prompt: terminal.message,
    },
    async collect(request): Promise<MobileCardCollectOutcome> {
      const failed = (message: string): MobileCardCollectOutcome => ({
        status: 'failed',
        paymentIntentId: request.paymentIntentId,
        message,
      })
      if (!status.connected) {
        manage()
        return failed('Connect Tap to Pay or a card reader first.')
      }
      if (status.updateRequired || status.updating) {
        manage()
        return failed('The card reader is updating. Try again when it finishes.')
      }
      try {
        const outcome = await terminal.collect({ ...request })
        return outcome.status === 'failed'
          ? { status: 'failed', paymentIntentId: outcome.paymentIntentId, message: outcome.message }
          : outcome
      } catch (error) {
        return failed(error instanceof Error ? error.message : 'The card could not be read. Try again.')
      }
    },
    async cancel() {
      await terminal.cancel()
    },
    manage,
  }
}
