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

import { checkEntitlement, planLabelGrantingFeature } from '@aglyn/aglyn/app-utils/plan-entitlements'
import type { TransferPlanRefusal } from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'

/**
 * The refusal for importing gift cards on a plan without them (AGL-3548),
 * or `null` when the plan has them: the sentence the Gift cards card's issue
 * route answers (`server/gift-cards.ts`), naming the plan that includes
 * them, in the 403 `plan_required` body every transfer route answers a plan
 * with. The `commerce.gift-cards` declaration gates imports only — the cards
 * a workspace holds are listed, and exported, on every plan. Asked by the
 * transfer gate (the resource's `planGate`) and again by each hook that
 * issues or voids a card, so the sweep that resumes an import is refused
 * alike.
 */
export function giftCardsPlanRefusal(org: unknown): TransferPlanRefusal | null {
  if (checkEntitlement(org as never, 'giftCards')) return null
  const plan = planLabelGrantingFeature('giftCards')
  return {
    status: 403,
    body: {
      error: 'Gift cards are not included on this plan.' + (plan ? ` Included from ${plan}.` : ''),
      reason: 'plan_required',
      code: 'giftCards',
    },
  }
}
