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
 * The ids of the register refund records the day report reads
 * (`registers/{registerId}/orderRefunds/{id}`, AGL-4037). Each is derived on
 * purpose, so a replayed write lands on the same record instead of counting
 * a refund twice; the schemes are written here, once, for every writer.
 */

/** A refund Stripe reported for a register sale: the charge (else the order) and the refunded total. */
export function posOrderRefundStripeId(chargeOrOrderId: string, refundedCents: number): string {
  return `stripe-${chargeOrOrderId}-${refundedCents}`
}

/** A refund given from the console's order dialog, keyed by its Stripe claim (else its time). */
export function posOrderRefundDialogId(orderId: string, claimKey: string | number): string {
  return `${orderId}-${claimKey}`
}

/** The hardware part of a register sale refunded through the staff page (AGL-4038), per attempt. */
export function posOrderRefundHardwareId(registerOrderId: string, attempt: number | string): string {
  return `${registerOrderId}-hw-${attempt}`
}
