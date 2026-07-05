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

import {
  type AppUUN,
  doesBesignerAppExist,
  getBesignerApp,
  type IBesignerAppController,
} from '@aglyn/besigner'
import { createContext, useContext, useMemo } from 'react'

export type IBesignerAppContext = IBesignerAppController | undefined

export const BesignerAppContext =
  createContext<IBesignerAppContext>(undefined)
BesignerAppContext.displayName = 'BesignerAppContext'
BesignerAppContext.aglyn = true
export default BesignerAppContext

export function useBesignerAppContext(): IBesignerAppController {
  return useContext(BesignerAppContext)
}

export interface BesignerAppProviderProps {
  appName?: AppUUN
  children?: JSX.Children
}

export function BesignerAppProvider(props: BesignerAppProviderProps) {
  const { appName, children } = props
  // App initialization is browser-only; render undefined during SSR instead
  // of throwing (matches the previous framework getApp semantics).
  const state = useMemo<IBesignerAppContext>(
    () => (doesBesignerAppExist(appName) ? getBesignerApp(appName) : undefined),
    [appName],
  )
  return (
    <BesignerAppContext.Provider value={state}>
      {children}
    </BesignerAppContext.Provider>
  )
}
BesignerAppProvider.displayName = 'BesignerAppProvider'
BesignerAppProvider.aglyn = true
