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
 * The words a native STORE build shows where a control that takes or starts a payment to Aglyn is left out (the
 * owner's decision of 2026-11-19: App Store and Google Play builds hide buying). Both apps read them from the
 * contracts, so the wording changes here, once, for every platform. The console never shows them. No imports.
 */

/**
 * The one link a store build may show in place of a buying control, where the store allows a link to another way to
 * pay (the App Store's United States storefront). It opens the workspace's billing page in the device's browser.
 */
export const NATIVE_WEB_BILLING_LINK_LABEL = 'Manage billing on the web'

/**
 * The plain sentence a store build shows in place of a buying control where no link is allowed. It names no address,
 * no price and no other place to buy.
 */
export const NATIVE_NO_IN_APP_BILLING_NOTE = 'Plan and billing changes are not available in the app.'
