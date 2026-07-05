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

import {createHocWithContextConsumer} from '@aglyn/shared-ui-jsx'
import {createContext, type PropsWithChildren, useContext, useEffect, useState} from 'react'
import {type FbUser} from '@aglyn/shared-util-fbclient'
import {type AppContextType, withAppContext} from './app-context'


export type CurrentUserContextType = {
  currentUser: FbUser
  loading: boolean
  error?: any
}

export const CurrentUserContext = createContext<CurrentUserContextType>(null)
CurrentUserContext.displayName = 'CurrentUserContext'
CurrentUserContext.aglyn = true

export const {
  displayName,
  Provider: CurrentUserContextProvider,
  Consumer: CurrentUserContextConsumer,
} = CurrentUserContext

export type CurrentUserContextConsumer = typeof CurrentUserContextConsumer

export interface CurrentUserProviderComponentProps extends PropsWithChildren {
  app: AppContextType
}

function CurrentUserProviderComponentRaw(props: CurrentUserProviderComponentProps) {
  const {children, app} = props
  const currentUser = app?.getCurrentUser?.()
  const [ctxState, setCtxState] = useState(() => ({
    currentUser,
    loading: true,
    error: null,
  }))

  useEffect(() => {
    const unsubscribe = app?.onAuthStateChanged?.(
      (user: FbUser) => {
        setCtxState((prev) => ({
          ...prev,
          currentUser: user ?? null,
          loading: false,
          error: null,
        }))
      },
      (error) => {
        setCtxState((prev) => ({
          ...prev,
          loading: false,
          error,
        }))
      },
    )
    // Unsubscribe auth listener on unmount
    return () => {
      if (unsubscribe) unsubscribe()
    }
  }, [])

  return <CurrentUserContextProvider value={ctxState}>{children}</CurrentUserContextProvider>
}
// Custom hook that shorthands the context!
export const useCurrentUserContext = () => useContext(CurrentUserContext)
export const CurrentUserProviderComponent = withAppContext(CurrentUserProviderComponentRaw)

/**
 * Current user context consumer HOC
 */
export const withCurrentUserContext = createHocWithContextConsumer(
  CurrentUserContextConsumer,
  'currentUserContext',
)
