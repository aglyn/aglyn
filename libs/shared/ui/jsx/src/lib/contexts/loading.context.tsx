/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import { type ConditionalNonDist } from '@aglyn/shared-data-types'
import { noop } from '@aglyn/shared-util-tools'
import { createUid } from '@aglyn/shared-util-vendor'
import { createContext, useContext, useRef, useState } from 'react'
import {
  createHocWithContextConsumer,
  type InjectedContextConsumerProps,
} from '../hocs/create-hoc-with-context-consumer'

export type QueueId = string
export type Queues = Array<QueueId>
export type TupledDequeue = [QueueId, DequeueLoading]
export type QueueResponse<T extends boolean = false> = ConditionalNonDist<
  T,
  true,
  TupledDequeue,
  DequeueLoading
>

export type EnqueueLoading = <T extends boolean = false>(
  asTuple?: T,
) => QueueResponse<T>
export type DequeueLoading = (
  queueId?: QueueId,
) => void /* Call to dequeue/end loading event */
export type DequeueAllLoading = () => void
export type CheckLoading = (queueId?: QueueId) => boolean

export type LoadingContextType = {
  // queues: Queues
  loading: boolean
  queueLoading: EnqueueLoading
  dequeueLoading: DequeueLoading
  dequeueAllLoading: DequeueAllLoading
  checkLoading: CheckLoading
}

export const LOADING_CONTEXT_DEFAULT_VALUE: LoadingContextType = {
  loading: false,
  queueLoading: noop as any,
  dequeueLoading: noop as any,
  dequeueAllLoading: noop as any,
  checkLoading: noop as any,
}

export const LoadingContext = createContext<LoadingContextType>(
  LOADING_CONTEXT_DEFAULT_VALUE,
)
LoadingContext.displayName = 'LoadingContext'
LoadingContext.aglyn = true

export const { Provider: LoadingProvider, Consumer: LoadingConsumer } =
  LoadingContext

const createQueueId = () => {
  return createUid()
}

export const useLoading = () => {
  const context = useContext(LoadingContext)
  return context
}

export interface LoadingProviderComponentProps {
  children?: JSX.Children
}

export function LoadingProviderComponent(props: LoadingProviderComponentProps) {
  const { children } = props
  const localRef = useRef<Queues>([])
  const [state, setState] = useState<LoadingContextType>(() => ({
    loading: false,
    queueLoading: <T extends boolean>(asTuple?: T): QueueResponse<T> => {
      const queueId = createQueueId()
      const dequeue: DequeueLoading = () => state.dequeueLoading(queueId)
      localRef.current.push(queueId)
      setState((prev) => ({ ...prev, loading: true }))
      return (
        asTuple === true ? [queueId, dequeue] : dequeue
      ) as QueueResponse<T>
    },
    dequeueLoading: (queueId?: QueueId) => {
      localRef.current = localRef.current.filter((i) => i !== queueId)
      setState((prev) => ({ ...prev, loading: state.checkLoading() }))
    },
    dequeueAllLoading: () => {
      localRef.current = []
    },
    checkLoading: (queueId?: QueueId) => {
      if (queueId) {
        return localRef.current.indexOf(queueId) >= 0
      }
      return localRef.current.length > 0
    },
  }))

  return <LoadingProvider value={state}>{children}</LoadingProvider>
}

const WithN = '_contextLoading'
type WithN = typeof WithN
export type LoadingConsumer = typeof LoadingConsumer
export type WithInjectedLoadingContextProps = InjectedContextConsumerProps<
  LoadingConsumer,
  WithN
>

/**
 * App loading context HOC prop injector
 */
export const withInjectedLoadingContext = createHocWithContextConsumer(
  LoadingConsumer,
  WithN,
)
