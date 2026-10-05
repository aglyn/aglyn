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

import type { TransferPlanGateHooks } from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { outreachEntitlementRefusal } from '../engine/outreach-access'

/**
 * Sequences' plan question for a transfer (AGL-3548): both resources
 * declare `featureFlag: "outreach"`, and the transfer gate asks this for
 * every intent — the refusal every Sequences route answers
 * (`outreachEntitlementRefusal`), in the 403 `plan_required` body the
 * transfer routes answer a plan with.
 */
export const outreachTransferPlanGate: NonNullable<TransferPlanGateHooks['planGate']> = (subject) => {
  const refusal = outreachEntitlementRefusal(subject.org as Record<string, unknown>)
  return refusal ? { status: 403, body: { error: refusal.message, reason: 'plan_required', code: 'outreach' } } : null
}
