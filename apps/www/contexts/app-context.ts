/**
 * @license
 * Copyright 2021 Aglyn LLC
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

import { AppController } from '../lib/aglyn-deprecated'
import { createContext, useContext } from 'react'
import { ComponentWithInjectedProp, withContext } from '@aglyn/shared/ui/react'

export type AppContextType = AppController

export const AppContext = createContext<AppContextType>(null)
AppContext.displayName = 'AppContext'

export const {
  displayName,
  Provider: AppContextProvider,
  Consumer: AppContextConsumer,
} = AppContext

export type AppContextConsumer = typeof AppContextConsumer

/**
 * App context HOC
 * @export
 * @template P
 * @param {ComponentWithInjectedProp<P, AppContextType, 'app'>} Component
 * @return {*}
 */
export function withAppContext<P>(
  Component: ComponentWithInjectedProp<P, AppContextConsumer, 'app'>
) {
  return withContext(AppContextConsumer, 'app')(Component)
}

export const useAppContext = () => useContext(AppContext)
