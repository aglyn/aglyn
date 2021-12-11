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

import { MKey } from '@aglyn/shared-data-types'
import { _isFnT } from '@aglyn/shared-util-guards'
import { getDisplayName } from '@aglyn/shared-util-tools'
import { ComponentType, createElement } from 'react'


/** Merge props for WithHoc utility functions */
export type WithHocProps<P, N extends MKey, T> = P & { [K in N]: T }

/** Component with merge props from WithHocProps for WithHoc utility functions */
export type WithHocComponent<P, N extends MKey, T> = ComponentType<WithHocProps<P, N, T>>

/** "with*" HOC function type */
export type WithHocFn<P, T, K extends MKey> = {
  (Component: WithHocComponent<P, K, T>, prop?: K): ComponentType<P>
}

/** Utility "with*" HOC utility function builder  */
export type WithHocFnBuilder = {
  <P, T, U extends string>(value: T | ((props: P) => T), injectedPropName: U): WithHocFn<P, T, U>
}

function withHocFactoryBuilderImpl<P, T, U extends MKey>(
  value: T | { (props: P): T },
  injectedPropName: U,
) {
  return function withHocFactory(
    Component: WithHocComponent<P, U, T>,
    overrideInjectedPropName?: U,
  ): ComponentType<P> {
    const propName = overrideInjectedPropName || injectedPropName
    function WithHocFactory(props: P) {
      const _value = _isFnT(value) ? value(props) : value
      const mergedProps = {...props, [propName]: _value} as P & { [K in U]: T }
      return createElement(Component, mergedProps)
    }
    WithHocFactory.displayName = `WithHocFactory(${getDisplayName(Component)})`
    return WithHocFactory
  }
}

export const withHocFactoryBuilder: WithHocFnBuilder = withHocFactoryBuilderImpl
