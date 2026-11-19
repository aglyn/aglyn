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

import { useNativeAppHidesBuying } from '@aglyn/aglyn/app-utils/native-app-web-view'
import { BuyingHiddenContext } from '@aglyn/shared-ui-jsx/contexts/buying-hidden.context'
import type { ReactNode } from 'react'

/**
 * Tells every component below whether buying is hidden: true only inside a
 * native app's web view from a build that cannot buy (the store builds, whose
 * user agent says `no-buying`). The components with an Upgrade, See plans,
 * add-on, Buy or payment control read `useBuyingHidden()` and leave the
 * control out. In a browser, and in an app build that can buy, it is false
 * and the console is unchanged.
 */
export default function NativeAppBuyingGate({ children }: { children?: ReactNode }) {
  const hidden = useNativeAppHidesBuying()
  return <BuyingHiddenContext.Provider value={hidden}>{children}</BuyingHiddenContext.Provider>
}
