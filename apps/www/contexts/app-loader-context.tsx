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

import {
  ComponentWithInjectedProp,
  InjectedContextProp,
  withContext,
} from '@aglyn/shared/ui/react'
import { _ln } from '@aglyn/shared/util/guards'
import { createUid } from '@aglyn/shared/util/helpers'
import { noopFactory } from '@aglyn/shared/util/tools'
import { ConditionalNonDist } from '@aglyn/shared/util/types'
import { createContext, PropsWithChildren, useContext, useState } from 'react'


export type QueueId = string
export type Queues = QueueId[]
export type TupledDequeueFn = [QueueId, DequeueLoading]
export type QueueResponse<Tuple = false> = ConditionalNonDist<Tuple, true, TupledDequeueFn, DequeueLoading>

export type DequeueLoading = () => void /* Should be called to dequeue/end loading event  */
export type EnqueueLoading = <T extends boolean>(asTuple?: T) => QueueResponse<T>

export type AppLoaderContextType = {
  queues: Queues
  isLoading: boolean // TODO: Which works best?
  queueLoading: EnqueueLoading
  checkLoading: () => boolean // TODO: Which works best?
}

export const APP_LOADER_CONTEXT_DEFAULT_VALUE: AppLoaderContextType = {
  queues: [],
  isLoading: false,
  queueLoading: noopFactory() as any,
  checkLoading: noopFactory() as any,
}

export const AppLoader = createContext<AppLoaderContextType>(
  APP_LOADER_CONTEXT_DEFAULT_VALUE,
)
AppLoader.displayName = 'AppLoader'

export const {
  Provider: AppLoaderProvider,
  Consumer: AppLoaderConsumer,
} = AppLoader

export const useAppLoader = () => useContext(AppLoader)
const createQueueId = () => createUid(5)

export interface AppLoaderProviderComponentProps extends PropsWithChildren<{}> {

}

export function AppLoaderProviderComponent(props: AppLoaderProviderComponentProps) {
  const {children} = props
  const [state, setState] = useState<AppLoaderContextType>({
    queues: [],
    isLoading: false,
    queueLoading: <T extends boolean>(asTuple?: T): QueueResponse<T> => {
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
            ...prevState, queues, isLoading: _ln(queues, 0, '>'),
          }
        })
      }
      enqueue()
      return (asTuple === true ? [queueId, dequeue] : dequeue) as QueueResponse<T>
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
