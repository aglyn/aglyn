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

import { emailSearchTokens } from '@aglyn/aglyn/app-utils/email-search'
import { nameSearchTokens } from '@aglyn/aglyn/app-utils/name-search'

/*
 * WHAT THE GIFT CARDS LIST SEARCHES, WRITTEN ON THE CARD (AGL-3321).
 *
 * The console's Gift cards card finds a card by its code or by the address
 * it was sent to, and the search is an `array-contains` on the query, so the
 * card must carry the tokens. Every writer that creates a card stamps
 * `searchTokens` through this — the purchase path in `billing-webhook.ts` and
 * the hand-issue route in `gift-cards.ts` — and
 * `tools/scripts/backfill-gift-card-search-tokens.mjs` stamps the cards
 * written before. Neither the code nor the address changes after issue, so
 * no other write needs to touch it.
 */

/** The token field every gift card carries. */
export const GIFT_CARD_SEARCH_TOKENS_PATH = 'searchTokens'

/**
 * A card's search tokens: word prefixes of the whole code and of each of its
 * `-`-separated parts — so `GC-A1B2C3D4E5F6` is found by `gc-a1b2` and by
 * `a1b2c3` — and the recipient address's tokens (`emailSearchTokens`).
 */
export function giftCardSearchTokens(
  code: string | null | undefined,
  recipientEmail?: string | null,
): string[] {
  const whole = String(code ?? '').trim()
  const words = [whole, ...whole.split(/[-_]+/)].filter(Boolean)
  return [...new Set([...nameSearchTokens(words.join(' ')), ...emailSearchTokens(recipientEmail)])]
}
