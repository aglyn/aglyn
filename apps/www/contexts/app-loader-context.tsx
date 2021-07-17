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

import { Conditional } from '@aglyn/shared/ui/react'
import { _ln, Uid } from '@aglyn/shared/util/helpers'
import React, { createContext, useContext, useState } from 'react'

import { ComponentWithInjectedProp, InjectedContextProp, withContext } from '../hoc/with-consumer'


export type QueueId = string
export type Queues = QueueId[]
export type TupledDequeueFn = [QueueId, DequeueLoading]
export type QueueResponse<Tuple extends boolean = null> = Conditional<Tuple, true, TupledDequeueFn, DequeueLoading>

export type DequeueLoading = () => void /* Should be called to dequeue/end loading event  */
export type EnqueueLoading = (asTuple?: boolean) => QueueResponse<typeof asTuple>

export type AppLoaderContextType = {
  queues: Queues
  isLoading: boolean // TODO: Which works best?
  queueLoading: EnqueueLoading
  checkLoading: () => boolean // TODO: Which works best?
}

export const AppLoader = createContext<AppLoaderContextType>(null)
AppLoader.displayName = 'AppLoader'

export const {
  Provider: AppLoaderProvider,
  Consumer: AppLoaderConsumer,
} = AppLoader

export const useAppLoader = () => useContext(AppLoader)
const createQueueId = () => Uid.nanoid(5)

export function AppLoaderProviderComponent(props: React.PropsWithChildren<unknown>) {
  const {children} = props
  const [state, setState] = useState<AppLoaderContextType>({
    queues: [],
    isLoading: false,
    queueLoading: (asTuple?: boolean) => {
      const queueId = createQueueId()
      const enqueue = () => {
        // Queue by appending the queueId to queue array
        setState(prevState => ({
          ...prevState,
          queues: [...prevState.queues, queueId],
          isLoading: true,
        }))
      }
      const dequeue = () => {
        // Dequeue by removing the queueId to queue array
        setState(prevState => {
          const queues = prevState.queues.filter(i => i !== queueId)
          return {
            ...prevState, queues, isLoading: _ln(queues),
          }
        })
      }
      enqueue()
      return asTuple ? [queueId, dequeue] : dequeue
    },
    checkLoading: () => Boolean(state.queues.length),
  })

  // TODO fix loss of dequeue instance on async overwrite
  // const routeQueue = React.useRef<{[id: string]: [fn: DequeueLoading]}>({})
  // useOnRouteChangeStart(() => {
  //   const {[]} = routeQueue.current ?? []
  //   if (dequeue) {dequeue()};
  //   routeQueue.current = state.queueLoading(true)
  // })
  // useOnRouteChangeError(() => {
  //   const [,dequeue] = routeQueue.current ?? []
  //   if (dequeue) {dequeue()};
  //   routeQueue.current = null
  // })
  // useOnRouteChangeComplete(() => {
  //   const [,dequeue] = routeQueue.current ?? []
  //   if (dequeue) {dequeue()};
  //   routeQueue.current = null
  // })

  return (
    <AppLoaderProvider value={state}>
      {children}
    </AppLoaderProvider>
  )
}

const WithN = 'appLoader'
type WithN = typeof WithN
export type AppLoaderConsumer = typeof AppLoaderConsumer
export type WithAppLoaderProps = InjectedContextProp<AppLoaderConsumer, WithN>

/**
 * App loading context HOC prop injector
 * @export
 * @template P
 * @param {ComponentWithInjectedProp<P, AppLoaderConsumer, WithN>} Component
 * @return {*}
 */
export function withAppLoader<P>(Component: ComponentWithInjectedProp<P, AppLoaderConsumer, WithN>) {
  return withContext(AppLoaderConsumer, WithN)(Component)
}
