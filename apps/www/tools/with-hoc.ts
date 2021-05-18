import { ComponentType, createElement } from 'react'

import { _isFn } from '@aglyn/common/tools/guards'
import { getDisplayName } from '@aglyn/common/utils/getDisplayName'


/** Merge props for WithHoc utility functions */
export type WithHocProps<P, N extends string, T> = P & { [K in N]: T }

/** Component with merge props from WithHocProps for WithHoc utility functions */
export type WithHocComponent<P, N extends string, T> = ComponentType<WithHocProps<P, N, T>>

/** "with*" HOC function type */
export type WithHocFn<P, T, K extends string> = {
  (Component: WithHocComponent<P, typeof prop, T>, prop?: K): ComponentType<P>
}

/** Utility "with*" HOC utility function builder  */
export type WithHocFnBuilder = {
  <P, T>(value: T | ((props: P) => T), defaultProp: string): WithHocFn<P, T, typeof defaultProp>
}

export const withHocFnBuilder: WithHocFnBuilder = <P, T>(value: T | ((props: P) => T), defaultProp: string) => {
  return function withHocFn(Component: WithHocComponent<P, typeof prop, T>, prop = defaultProp): ComponentType<P> {
    function DecoratedComponent(props: P) {
      const _value = _isFn(value) ? value(props) : value
      const newProps = { ...props, [prop]: _value }
      return createElement(Component, newProps)
    }
    DecoratedComponent.displayName = `WithHocFn(${getDisplayName(Component)})`
    return DecoratedComponent
  }
}
