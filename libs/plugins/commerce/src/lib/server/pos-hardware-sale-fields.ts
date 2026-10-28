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

import { isPosHardwareSkuId, parsePosHardwareInPersonConfig } from '../model/pos-hardware'

/*==========================================
 * THE MARK A REGISTER SALE OF HARDWARE CARRIES (AGL-4038).
 *
 * Every path that writes a register sale — an open sale, a payment link, a
 * cash or room sale, the kiosk's cart, an offline sale synced later — spreads
 * these fields into the order it writes. On the platform's own store, a sale
 * with a line whose product is a hardware item says `hardwareSalePending`
 * from the moment it exists, and the hardware order is recorded when it is
 * paid. The completion listener clears the mark; one it missed is found by
 * the mark and recorded on the next sweep, so a sale is never lost because a
 * listener failed after the money was taken.
 *
 * Read on every sale of every store, so it costs nothing anywhere but the
 * seller: the environment is read first, and the products are the ones the
 * sale already loaded.
 *=========================================*/

export function posHardwareSaleFields(
  input: {
    hostId: string
    orgId: string | null | undefined
    lineItems: ReadonlyArray<{ productId: string }>
    products: ReadonlyMap<string, { hardwareSku?: unknown } | null | undefined>
  },
  env: Record<string, string | undefined> = process.env,
): { hardwareSalePending?: true } {
  const config = parsePosHardwareInPersonConfig(env)
  if (!config || config.sellerHostId !== input.hostId || config.sellerOrgId !== input.orgId) return {}
  const sellsHardware = input.lineItems.some((line) =>
    isPosHardwareSkuId(input.products.get(line.productId)?.hardwareSku),
  )
  return sellsHardware ? { hardwareSalePending: true } : {}
}
