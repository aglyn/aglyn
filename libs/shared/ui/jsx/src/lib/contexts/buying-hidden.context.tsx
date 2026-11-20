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

'use client'

import { createContext, useContext } from 'react'

/**
 * Whether this page must leave out every control that leads to buying:
 * Upgrade, See plans, add-ons, Buy, a payment to finish, a card to update.
 *
 * True only where the app that hosts the page says so (the native apps' store
 * builds show the console in a web view and take no payment to Aglyn); the
 * console decides it and provides it once, near its root. Everywhere else,
 * and with no provider at all, it is false and nothing changes.
 *
 * A component with such a control reads it and draws the control's absence:
 * the sentence that explains a limit stays, the button or link to buy goes.
 */
export const BuyingHiddenContext = createContext(false)

BuyingHiddenContext.displayName = 'BuyingHiddenContext'

/** {@link BuyingHiddenContext}'s answer for this render. */
export function useBuyingHidden(): boolean {
  return useContext(BuyingHiddenContext)
}
