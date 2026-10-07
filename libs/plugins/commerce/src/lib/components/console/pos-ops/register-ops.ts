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
 * What the register page takes from the operations work (AGL-3609), in one
 * module: the page's own specs stand it in with one `jest.mock`, and the
 * operations have specs of their own.
 */
export { PosCustomerLookup, type PosSelectedCustomer } from './pos-customer-lookup.component'
export { PosLastReceipt } from './pos-last-receipt.component'
export { PosOperationsBar } from './pos-operations-bar.component'
export { usePosOpsSettings } from './pos-receipt-actions.component'
export { usePosCashier } from './use-pos-cashier'
