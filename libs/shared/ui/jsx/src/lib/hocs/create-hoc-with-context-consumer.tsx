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

import {getDisplayName} from '@aglyn/shared-util-tools'
import {hoistNonReactStatics} from '@aglyn/shared-util-vendor'
import {ComponentType, Consumer, forwardRef, ForwardRefExoticComponent} from 'react'


export const DEFAULT_INJECTED_PROP_NAME = 'ctx'
export type DEFAULT_INJECTED_PROP_NAME = typeof DEFAULT_INJECTED_PROP_NAME

/**
 * Infer the context type from the consumer
 */
export type ConsumerContextType<C extends Consumer<any>> =
  C extends Consumer<infer T>
    ? T
    : never

/** The context props to inject into the component */
export type InjectedContextConsumerProps<C extends Consumer<any>, NM extends string = DEFAULT_INJECTED_PROP_NAME> = {
  [K in NM]: ConsumerContextType<C>
}

/** A react component awaiting decoration of injected prop */
export type ComponentWithInjectedProp<P,
  CTX_C extends Consumer<any>,
  InjectedProp extends string = DEFAULT_INJECTED_PROP_NAME> = ComponentType<P & InjectedContextConsumerProps<CTX_C, InjectedProp>>

export interface WithContextConsumer<T, Key extends string = 'ctx'> {
  <P>(component: ComponentType<P & Partial<Record<Key, T>>>): ForwardRefExoticComponent<Omit<P, Key>>
}

/**
 * Helper util to HOC a context consumer
 */
export function createHocWithContextConsumer<T, K extends string = 'ctx'>(
  Consumer: Consumer<T>,
  prop?: K,
): WithContextConsumer<T, K> {
  const injectedPropName = prop || DEFAULT_INJECTED_PROP_NAME

  function withContextConsumer<P>(
    Component: ComponentType<P & Record<K, T>>,
  ): ForwardRefExoticComponent<Omit<P, K>> {
    const displayName = getDisplayName(Component)

    const DecoratedComponent = forwardRef<any, P>(
      function RefRenderFn(props, ref) {
        return (
          <Consumer>
            {(ctx) => (
              <Component
                ref={ref}
                {...{[injectedPropName]: ctx} as Record<K, T>}
                {...props as P}
              />
            )}
          </Consumer>
        )
      },
    )

    DecoratedComponent.displayName = `WithContext(${displayName})`
    hoistNonReactStatics(DecoratedComponent, Component)
    return DecoratedComponent as ForwardRefExoticComponent<Omit<P, K>>
  }

  return withContextConsumer
}
