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

/*
 * Why a site may not buy a domain now, and the sentence the card shows for
 * each (AGL-3962). Pure, so the purchase sequence can refuse with the same
 * words as the gate (a preclearance that fails to spend, AGL-3955) without
 * loading the gate's Admin SDK imports. `./gates` re-exports both.
 */

/*
 * A site that already has a domain is no refusal (AGL-4040): a name bought
 * then goes into the workspace, unassigned, and can be connected to any of
 * its sites from the Domains page.
 */
export type PurchaseRefusal =
  | 'no-payment-history'
  | 'fraud-hold'
  | 'lookalike'
  | 'too-many-recently'
  | 'too-many-held'

export const PURCHASE_REFUSAL_COPY: Record<PurchaseRefusal, string> = {
  'no-payment-history':
    'Domains can be bought about three days after your workspace’s first plan payment, once it has cleared. You can connect a domain you already own in the meantime.',
  'fraud-hold':
    'Buying is paused for this workspace while a payment review is open. Contact support to finish it.',
  lookalike:
    'That name imitates a well-known brand, so it can’t be bought here.',
  'too-many-recently':
    'Your workspace has bought several domains this month. Contact support if you need more right away.',
  'too-many-held': 'Your workspace holds the most domains it can. Contact support to raise the limit.',
}
