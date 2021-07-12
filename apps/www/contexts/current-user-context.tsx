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

import { FbUser } from '../lib/aglyn-deprecated'
import React, { createContext, useContext, useEffect, useState } from 'react'

import { ComponentWithInjectedProp, InjectedContextProp, withContext } from '../hoc/with-consumer'
import { withAppContext } from './app-context'


export type CurrentUserContext = {
  currentUser: FbUser
  loading: boolean
  error?: any
}

export const CurrentUserContext = createContext<CurrentUserContext>(null)
CurrentUserContext.displayName = 'CurrentUserContext'

// Custom hook that shorthands the context!
export const useCurrentUserContext = () => useContext(CurrentUserContext)

export const {
  displayName,
  Provider: CurrentUserContextProvider,
  Consumer: CurrentUserContextConsumer,
} = CurrentUserContext

export type Props = {}

export const CurrentUserProviderComponent = withAppContext<Props>(
  function CurrentUserProviderComponent(props) {
    const {children, app} = props
    const currentUser = app?.getCurrentUser()
    const [ctxState, setCtxState] = useState({
      currentUser,
      loading: true,
      error: null,
    })

    useEffect(() => {
      const unsubscribe = app?.onAuthStateChanged(
        (user: FbUser) => {
          setCtxState(prev => ({
            ...prev,
            currentUser: user ?? null,
            loading: false,
            error: null,
          }))
        },
        (error) => {
          setCtxState(prev => ({
            ...prev,
            loading: false,
            error,
          }))
        },
      )
      // Unsubscribe auth listener on unmount
      return () => { unsubscribe() }
    }, [])

    return (
      <CurrentUserContextProvider value={ctxState}>
        {children}
      </CurrentUserContextProvider>
    )
  },
)

const WithN = 'currentUserContext'
type WithN = typeof WithN
export type CurrentUserContextConsumer = typeof CurrentUserContextConsumer
export type WithCurrentUserContextProps = InjectedContextProp<CurrentUserContextConsumer, WithN>

/**
 * Current user context consumer HOC
 * @export
 * @template P
 * @param {ComponentWithInjectedProp<P, CurrentUserContextConsumer, WithN>} Component
 * @return {*}
 */
export function withCurrentUserCtx<P>(Component: ComponentWithInjectedProp<P, CurrentUserContextConsumer, WithN>) {
  return withContext(CurrentUserContextConsumer, WithN)(Component)
}
