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

import { getDisplayName } from '@aglyn/shared/util/tools'
import { ComponentType, Consumer, createElement } from 'react'


export const injectedProp = 'ctx'
export type injectedProp = 'ctx'

/**
 * Infer the context type from the consumer
 */
export type ConsumerContextType<C extends Consumer<any>> = C extends Consumer<infer T> ? T : never

/** The context props to inject into the component */
export type InjectedContextProp<C extends Consumer<any>,
  NM extends string = injectedProp> = {
  [K in NM]: ConsumerContextType<C>
}

/** A react component awaiting decoration of injected prop */
export type ComponentWithInjectedProp<P,
  C extends Consumer<any>,
  NM extends string = injectedProp> = ComponentType<P & InjectedContextProp<C, NM>>


/**
 * Helper util to HOC a context consumer
 *
 * @export
 * @template P
 * @template Key
 * @param {Consumer<any>} consumer
 * @param {Key} [prop]
 * @returns {*}  {(component: ComponentWithInjectedProp<P, typeof consumer, Key>) =>
 *   React.ComponentType<Omit<P, typeof prop>>}
 */
export function withContext<T, Key extends string = 'ctx'>(
  consumer: Consumer<T>, prop?: Key,
): <P>(component: ComponentType<P & Partial<Record<Key, T>>>) => ComponentType<Omit<P, Key>> {

  return function <P>(component: ComponentType<P & Record<Key, T>>): ComponentType<Omit<P, Key>> {
    function WithContext(props) {
      const getProps = (ctx: ConsumerContextType<typeof consumer>) => ({...props, [prop ?? injectedProp]: ctx})
      const children = (ctx) => createElement(component, getProps(ctx))
      return createElement(consumer, null, children)
    }
    WithContext.displayName = `WithContext(${getDisplayName(component)})`
    return WithContext
  }

}
