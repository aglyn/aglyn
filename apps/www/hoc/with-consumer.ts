/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { getDisplayName } from '@aglyn/shared/util/helpers'
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
 * @returns {*}  {(component: ComponentWithInjectedProp<P, typeof consumer, Key>) => React.ComponentType<Omit<P, typeof prop>>}
 */
export function withContext<P = {}, Key extends string = 'ctx'>(
  consumer: Consumer<any>, prop?: Key,
): (component: ComponentWithInjectedProp<P, typeof consumer, Key>) => ComponentType<Omit<P, typeof prop>> {

  return function(component: ComponentWithInjectedProp<P, typeof consumer, Key>): ComponentType<Omit<P, typeof prop>> {
    function WithContext(props) {
      const getProps = (ctx: ConsumerContextType<typeof consumer>) => ({ ...props, [prop ?? injectedProp]: ctx })
      const children = (ctx) => createElement(component, getProps(ctx))
      return createElement(consumer, null, children)
    }
    WithContext.displayName = `WithContext(${getDisplayName(component)})`
    return WithContext
  }

}
