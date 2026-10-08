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

import type {
  LoyaltyConnectorCredentials,
  LoyaltyConnectorId,
} from '../model/loyalty-connectors'

/**
 * What loyalty asks of a merchant's own loyalty account (AGL-3677), one
 * adapter per vendor. Server-only: every call carries the merchant's secret.
 *
 * Points only. The adapters never price a reward, never mint a vendor
 * discount code and never read an order: the rewards plugin decides how many
 * points a sale earns or spends, with the store's own rates, and the vendor
 * keeps the balance.
 */

export type LoyaltyVendorFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>

/** A member as the vendor holds them. */
export interface LoyaltyVendorMember {
  /** The vendor's id for the member. */
  id: string
  /** Spendable points at the vendor right now. */
  points: number
}

export interface LoyaltyVendorAdjustment {
  member: LoyaltyVendorMember
  email: string
  /** Signed: what to add to the balance. */
  points: number
  /** Whether the movement counts toward what the member has earned (earn and its reversal) or only their balance (spend and give back). */
  earned: boolean
  /** What the member's history at the vendor says. */
  title: string
  /** Aglyn's short reference for the movement, written beside it so a resend can find it. */
  ref: string
}

export interface LoyaltyVendorAdapter {
  id: LoyaltyConnectorId
  /** Whether the credentials open the account. Throws {@link LoyaltyVendorError} when they do not. */
  verify(
    credentials: LoyaltyConnectorCredentials,
  ): Promise<{ accountLabel: string | null }>
  /** The member for an address, or `null` when the vendor has none. */
  findMember(
    credentials: LoyaltyConnectorCredentials,
    email: string,
  ): Promise<LoyaltyVendorMember | null>
  /** Enrolls an address; `null` when this vendor's merchant keys cannot. */
  enrollMember(
    credentials: LoyaltyConnectorCredentials,
    input: { email: string; name: string | null },
  ): Promise<LoyaltyVendorMember | null>
  /** Moves a member's balance. Throws {@link LoyaltyVendorError}. */
  adjust(
    credentials: LoyaltyConnectorCredentials,
    adjustment: LoyaltyVendorAdjustment,
  ): Promise<{ id: string | null }>
  /** Whether a movement bearing `ref` is already in the member's history: a send that died mid-call. */
  hasAdjustment(
    credentials: LoyaltyConnectorCredentials,
    input: { member: LoyaltyVendorMember; email: string; ref: string },
  ): Promise<boolean>
}

export type LoyaltyVendorErrorKind =
  /** The credentials were refused: the merchant reconnects. */
  | 'auth'
  /** The balance cannot go that low. */
  | 'insufficient'
  /** Throttled, busy or unreachable: try again later. */
  | 'transient'
  /** Anything else the vendor refused. */
  | 'refused'

export class LoyaltyVendorError extends Error {
  constructor(
    readonly kind: LoyaltyVendorErrorKind,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message)
    this.name = 'LoyaltyVendorError'
  }

  get retryable(): boolean {
    return this.kind === 'transient'
  }
}
