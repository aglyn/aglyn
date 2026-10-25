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

import { registerPluginApiRoute } from '@aglyn/aglyn/server'
import { posCheckInHandler, registerPosSaleCheckIns } from './pos-check-in'
import { posCustomerHandler } from './pos-customer'
import { posDayReportHandler } from './pos-day-report'
import { registerPosSalePrinting } from './pos-print'
import { posReturnHandler } from './pos-return'
import { posShiftHandler } from './pos-shift'
import { posStaffPinHandler } from './pos-staff-pin'

/**
 * The register's operations routes (AGL-3609): shifts and the drawer, staff
 * PINs, the customer lookup and returns, the day totals (AGL-4037), the
 * check-in (AGL-4043), plus the
 * sale printing. Console-auth, so they register on the console surface with
 * the sale route itself.
 */
export function registerPosOpsRoutes(): void {
  registerPluginApiRoute('commerce/pos-shift', posShiftHandler)
  registerPluginApiRoute('commerce/pos-staff-pin', posStaffPinHandler)
  registerPluginApiRoute('commerce/pos-customer', posCustomerHandler)
  registerPluginApiRoute('commerce/pos-return', posReturnHandler)
  // One day's or one event's totals across every register, shift and cashier
  // (AGL-4037): a GET, read with the same gate as the shift reports.
  registerPluginApiRoute('commerce/pos-day-report', posDayReportHandler)
  // Check-in at the window (AGL-4043): who is due today, checking them in
  // with a wristband, and the day's list; a register sale's check-ins are
  // written the moment it completes, through the same seam as its printing.
  registerPluginApiRoute('commerce/pos-check-in', posCheckInHandler)
  registerPosSaleCheckIns()
  // A completed sale's receipt and drawer kick on the register's cloud
  // printers (AGL-3619), through the sale-completed seam every path fires.
  registerPosSalePrinting()
}
