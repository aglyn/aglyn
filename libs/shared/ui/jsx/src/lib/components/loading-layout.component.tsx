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

import { getDisplayName } from '@aglyn/shared-util-tools'
import { hoistNonReactStatics } from '@aglyn/shared-util-vendor'
import { useRouter } from 'next/router'
import { type ComponentType, forwardRef, useEffect } from 'react'
import {
  LoadingProviderComponent,
  useLoading,
} from '../contexts/loading.context'
import { NextRouterEvent } from '../hooks/router-events'
import {
  LoadingOverlayComponent,
  type LoadingOverlayComponentProps,
} from './loading-overlay.component'

function RouterLoading({ children }) {
  const router = useRouter()
  const { queueLoading } = useLoading()
  useEffect(() => {
    const dequeue = []
    const handleStart = (url) => {
      dequeue.push(queueLoading())
    }
    const handleStop = () => {
      if (dequeue.length > 0) dequeue.pop()()
    }

    router.events.on(NextRouterEvent.ROUTE_CHANGE_START, handleStart)
    router.events.on(NextRouterEvent.ROUTE_CHANGE_COMPLETE, handleStop)
    router.events.on(NextRouterEvent.ROUTE_CHANGE_ERROR, handleStop)
    return () => {
      router.events.off(NextRouterEvent.ROUTE_CHANGE_START, handleStart)
      router.events.off(NextRouterEvent.ROUTE_CHANGE_COMPLETE, handleStop)
      router.events.off(NextRouterEvent.ROUTE_CHANGE_ERROR, handleStop)
      if (dequeue.length > 0) dequeue.forEach((i) => i())
    }
  }, [queueLoading, router])

  return children
}
RouterLoading.displayName = 'RouterLoading'
RouterLoading.aglyn = true

export interface LoadingLayoutComponentProps
  extends Partial<LoadingOverlayComponentProps> {}

const LoadingLayoutComponent = forwardRef<any, LoadingLayoutComponentProps>(
  (props, ref) => {
    const { children, ...rest } = props

    return (
      <LoadingProviderComponent>
        <LoadingOverlayComponent ref={ref} {...rest}>
          <RouterLoading>{children}</RouterLoading>
        </LoadingOverlayComponent>
      </LoadingProviderComponent>
    )
  },
)
LoadingLayoutComponent.displayName = 'LoadingLayoutComponent'
LoadingLayoutComponent.aglyn = true

export function withLoadingLayoutComponent<P>(
  WrappedComponent: ComponentType<P>,
  loadingLoadingProps: LoadingLayoutComponentProps,
) {
  const displayName = getDisplayName(WrappedComponent)
  const WithLoadingLayoutComponent = forwardRef<any, P>((props, ref) => {
    return (
      <LoadingLayoutComponent ref={ref} {...loadingLoadingProps}>
        <WrappedComponent {...props} />
      </LoadingLayoutComponent>
    )
  })
  WithLoadingLayoutComponent.displayName = `WithLoadingLayoutComponent(${displayName})`
  hoistNonReactStatics(WithLoadingLayoutComponent, WrappedComponent)
  return WithLoadingLayoutComponent
}

export { LoadingLayoutComponent }
export default LoadingLayoutComponent
