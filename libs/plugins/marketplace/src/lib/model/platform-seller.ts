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
 * Whether a seller is the platform itself, selling at a waived fee (AGL-4049).
 *
 * The platform's own org sells through the marketplace the same way any
 * publisher does, with one difference that is not a privilege: there is nobody
 * to pay. Its money already lands on the platform's account, so a Connect
 * transfer would be the platform paying itself, and it never onboards Connect.
 *
 * BOTH HALVES, ALWAYS. The waiver is the existing staff override
 * (`marketplaceFeePct: 0`) and the org is a server-side marker
 * (`AGLYN_PLATFORM_ORG_ID`, read in `server/platform-org.ts`). A waiver on any
 * other seller still pays that seller, and the platform's org at a real rate
 * still needs a payout account. No client-writable field decides this.
 *
 * Pure, so the sale, the publish gate and their specs all ask one question.
 */
export function sellsAsPlatform(input: {
  sellerOrgId: string
  feePercent: number
  platformOrgId: string | null | undefined
}): boolean {
  const { sellerOrgId, feePercent, platformOrgId } = input
  return feePercent === 0 && !!platformOrgId && sellerOrgId === platformOrgId
}
