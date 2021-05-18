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
    const { children, app } = props
    const currentUser = app.getCurrentUser()
    const [ctxState, setCtxState] = useState({
      currentUser,
      loading: true,
      error: null
    })

    useEffect(() => {
      const unsubscribe = app.getApp().auth().onAuthStateChanged(
        (user: FbUser) => {
          setCtxState(prev => ({
            ...prev,
            currentUser: user ?? null,
            loading: false,
            error: null
          }))
        },
        (error) => {
          setCtxState(prev => ({
            ...prev,
            loading: false,
            error,
          }))
        }
      )
      // Unsubscribe auth listener on unmount
      return () => { unsubscribe() }
    }, [])

    return (
      <CurrentUserContextProvider value={ctxState}>
        {children}
      </CurrentUserContextProvider>
    )
  }
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
