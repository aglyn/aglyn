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
import { makeAutoObservable } from 'mobx'
import { computedFn } from 'mobx-utils'
import { ContextType, createContext, useContext, useRef, useState } from 'react'
import {
  createHocWithContextConsumer,
  type InjectedContextConsumerProps,
} from '../hocs/create-hoc-with-context-consumer'

export type QueueId = string
export type Queues = QueueId[]
export type TupledDequeue = [QueueId, DequeueLoading]
export type QueueResponse<T extends boolean> = ConditionalNonDist<
  T,
  true,
  TupledDequeue,
  DequeueLoading
>

export interface LoadingHelper {
  enqueue<T extends boolean = false>(asTuple?: T): QueueResponse<T>
  dequeue(queueId?: QueueId): void
  dequeueAll(): void
  check(queueId?: QueueId): boolean
}

export type EnqueueLoading = LoadingHelper['enqueue']
export type DequeueLoading = LoadingHelper['dequeue']
export type DequeueAllLoading = LoadingHelper['dequeueAll']
export type CheckLoading = LoadingHelper['check']

export type EnqueueResponse = {
  (): LoadingManager
  readonly queueId: QueueId
}

export class LoaderItem {
  public loading(): boolean {
    return this.manager.queues.has(this.id)
  }

  constructor(
    public readonly id: QueueId,
    private readonly manager: LoadingManager,
  ) {
    makeAutoObservable(this)
  }

  public dequeue() {
    this.manager.dequeue(this.id)
    return this
  }
}

export class LoadingManager {
  public queues: Map<QueueId, LoaderItem> = new Map()

  public get loading(): boolean {
    return this.queues.size > 0
  }

  constructor() {
    makeAutoObservable(this)
  }

  public check = computedFn((id: QueueId) => {
    return this.queues.has(id)
  })

  public static createQueueId() {
    return createUid()
  }

  public enqueue(): LoaderItem {
    const id = LoadingManager.createQueueId()
    const loader = new LoaderItem(id, this)
    this.queues.set(id, new LoaderItem(id, this))
    return loader
  }

  public dequeue(id: QueueId): this {
    if (this.queues.has(id)) {
      this.queues.delete(id)
    } else {
      console.error('Invalid loading queue ID', id)
    }
    return this
  }
}

export const LoadingContext = createContext({
  loading: false,
  queueLoading: noop as EnqueueLoading,
  dequeueLoading: noop as DequeueLoading,
  dequeueAllLoading: noop as DequeueAllLoading,
  checkLoading: noop as CheckLoading,
})
LoadingContext.displayName = 'LoadingContext'

export type LoadingContextType = ContextType<typeof LoadingContext>

export const { Consumer: LoadingConsumer } = LoadingContext

const createQueueId = () => {
  return createUid()
}

export const useLoading = () => {
  return useContext(LoadingContext)
}

export interface LoadingProviderProps {
  children?: JSX.Children
}

export function LoadingProviderComponent(props: LoadingProviderProps) {
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

  return (
    <LoadingContext.Provider value={state}>{children}</LoadingContext.Provider>
  )
}

const WithN = '_contextLoading'
type WithN = typeof WithN
export type LoadingConsumer = typeof LoadingConsumer
export type WithInjectedLoadingContextProps = InjectedContextConsumerProps<
  typeof LoadingContext.Consumer,
  WithN
>

/**
 * App loading context HOC prop injector
 */
export const withInjectedLoadingContext = createHocWithContextConsumer(
  LoadingContext.Consumer,
  WithN,
)
