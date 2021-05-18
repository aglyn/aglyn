/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { AppController } from '../lib/aglyn-deprecated'
import { createContext, useContext } from 'react'

import { ComponentWithInjectedProp, InjectedContextProp, withContext } from '../hoc/with-consumer'


export const AppContext = createContext<AppController>(null)
AppContext.displayName = 'AppContext'

export const {
  displayName,
  Provider: AppContextProvider,
  Consumer: AppContextConsumer,
} = AppContext

export const useAppContext = () => useContext(AppContext)

const WithN = 'app'
type WithN = typeof WithN
export type AppContextConsumer = typeof AppContextConsumer
export type WithAppContextProps = InjectedContextProp<AppContextConsumer, WithN>

/**
 * App context HOC
 * @export
 * @template P
 * @param {ComponentWithInjectedProp<P, AppContextConsumer, WithN>} Component
 * @return {*}
 */
export function withAppContext<P>(Component: ComponentWithInjectedProp<P, AppContextConsumer, WithN>) {
  return withContext(AppContextConsumer, WithN)(Component)
}
