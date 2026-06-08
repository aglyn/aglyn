/**
 * @license
 * Copyright 2023 Aglyn LLC
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

import { getApp } from '@aglyn/core-data-app'
import {
  type AppUUN,
  type CanvasSetElementsPayload,
  DEFAULT_APP_UUN,
  type IAglynAppController,
} from '@aglyn/core-data-foundation'
import { createContext, useContext, useMemo } from 'react'

export type IAglynAppContext = IAglynAppController | undefined

export const AglynAppContext = createContext<IAglynAppContext>(undefined)
AglynAppContext.displayName = 'AglynAppContext'
AglynAppContext.aglyn = true
export default AglynAppContext

export function useAglynAppContext<
  T extends IAglynAppController = IAglynAppController,
>(): T {
  return useContext(AglynAppContext) as T
}

export interface AglynAppContextComponentProps {
  appName?: AppUUN
  children?: JSX.Children
  canvasElements?: CanvasSetElementsPayload
}

export function AglynAppProvider(props: AglynAppContextComponentProps) {
  const { appName = DEFAULT_APP_UUN, children, canvasElements } = props

  const state = useMemo<IAglynAppContext>(() => getApp(appName), [appName])

  return (
    <AglynAppContext.Provider value={state}>
      {children}
    </AglynAppContext.Provider>
  )
}
AglynAppProvider.displayName = 'AglynAppProvider'
AglynAppProvider.aglyn = true
