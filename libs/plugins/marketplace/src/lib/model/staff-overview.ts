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
 * What `/api/marketplace/admin/overview` answers the staff overview's widget
 * (AGL-3080): recent paid purchases and the refund-reversal recovery queue.
 */

/** One recent purchase, as the staff card shows it. */
export interface StaffPurchaseRow {
  $id: string
  listingId: string | null
  buyerUid: string | null
  sellerOrgId: string | null
  amountCents: number
  feeCents: number
  createdAt: number | null
}

/** One refused reversal: money a publisher kept after a buyer's refund. */
export interface ReversalRecoveryRow {
  $id: string
  listingId: string | null
  sellerOrgId: string | null
  /**
   * The seller's workspace by NAME (`name` → `slug` → id). Null when it could
   * not be named — an org since deleted — and the row then falls back to the
   * id, which is still a lead somebody can search.
   */
  sellerOrgLabel?: string | null
  buyerUid: string | null
  /** What the webhook failed to pull back. 0 when it never learned the amount. */
  owedCents: number
  reason: string | null
  cause: string | null
  failedAt: number | null
}

export interface MarketplaceStaffOverview {
  purchases: StaffPurchaseRow[]
  reversalRecovery: ReversalRecoveryRow[]
  /** The sum of `reversalRecovery`'s own amounts — never either row's. */
  reversalOwedCents: number
}
