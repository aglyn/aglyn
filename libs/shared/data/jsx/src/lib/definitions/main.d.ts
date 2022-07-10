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

import type {
  Requireable as PropTypesRequireable,
  ValidationMap as PropTypesValidationMap,
  Validator as PropTypesValidator,
} from 'prop-types'
import type { Component as ReactComponent } from 'react'

declare global {
  namespace JSX {
    type Key = string | number
    /** The index signature for an object key  */
    type PKey = keyof any

    /** Dictionary collection optionally specify values to T */
    type EmptyObj<K extends PKey = PKey> = Record<never, never>
    /** Type safe object "{}" record (optionally specify index type) */
    type AnyObj<K extends PKey = PKey> = Record<K, unknown>
    /** From T, omit properties in union with 'K' "distributively" for union types */
    type DistributiveOmit<T, K extends PKey> = T extends any
      ? Omit<T, K>
      : never

    export type Text = string | number
    export type Child = Element | Text
    export type Fragment = Iterable<Node>
    export type Node = Child | Fragment | Portal | boolean | null | undefined
    export type NodeList = Node[] | ArrayLike<Node>
    export type NodeIterableList = NodeList | Iterable<Node>
    export type Children = Node

    export type IntrinsicElementMap<P = any> = {
      [K in keyof IntrinsicElements]: P extends IntrinsicElements[K] ? K : never
    }
    export type IntrinsicElement<P = any> =
      IntrinsicElementMap<P>[keyof IntrinsicElements]

    export type ElementFunctionComponent<P = any> = {
      (props: P): JSX.Element | null
    }
    export type ElementClassComponent<P = any> = ComponentClass<P, any>
    export type ComponentType<P> =
      | ElementFunctionComponent<P>
      | ElementClassComponent<P>
    export type ElementType<P = any> = IntrinsicElement<P> | ComponentType<P>

    export type ElementConstructor<P> =
      | ((props: P) => Element | null)
      | (new (props: P) => Component<P, any>)

    export type PropValidator<T> = PropTypesValidator<T>
    export type PropRequireable<T> = PropTypesRequireable<T>
    export type PropValidationMap<T> = PropTypesValidationMap<T>
    type WeakValidationMap<T> = {
      [K in keyof T]?: null extends T[K]
        ? PropValidator<T[K] | null | undefined>
        : undefined extends T[K]
        ? PropValidator<T[K] | null | undefined>
        : PropValidator<T[K]>
    }

    export type RefCallback<T> = {
      bivarianceHack(instance: T | null): void
    }['bivarianceHack']
    export type Ref<T> = RefCallback<T> | RefObject<T> | null
    /** Ensures that the props do not include ref at all */
    export type PropsWithoutRef<P> =
      // Pick would not be sufficient for this. We'd like to avoid unnecessary mapping and need a
      // distributive conditional to support unions. see:
      // https://www.typescriptlang.org/docs/handbook/2/conditional-types.html#distributive-conditional-types
      // https://github.com/Microsoft/TypeScript/issues/28339
      P extends any
        ? 'ref' extends keyof P
          ? Pick<P, Exclude<keyof P, 'ref'>>
          : P
        : P

    /** Ensures that the props do not include string ref, which cannot be forwarded */
    export type PropsWithRef<P> =
      // Just "P extends { ref?: infer R }" looks sufficient, but R will infer as {} if P is {}.
      'ref' extends keyof P
        ? P extends { ref?: infer R | undefined }
          ? string extends R
            ? PropsWithoutRef<P> & { ref?: Exclude<R, string> | undefined }
            : P
          : P
        : P

    export type PropsWithChildren<P> = P & { children?: Children }

    /**
     * NOTE: prefer ComponentPropsWithRef, if the ref is forwarded,
     * or ComponentPropsWithoutRef when refs are not supported.
     */
    type ComponentProps<
      T extends keyof IntrinsicElements | ElementConstructor<any>,
    > = T extends ElementConstructor<infer P>
      ? P
      : T extends keyof IntrinsicElements
      ? IntrinsicElements[T]
      : AnyObj

    export type ComponentPropsWithRef<T extends ElementType> =
      T extends ElementClassComponent<infer P>
        ? PropsWithoutRef<P> & RefAttributes<InstanceType<T>>
        : PropsWithRef<ComponentProps<T>>

    export type ComponentPropsWithoutRef<T extends ElementType> =
      PropsWithoutRef<ComponentProps<T>>

    export type ComponentRef<T extends ElementType> =
      T extends NamedExoticComponent<
        ComponentPropsWithoutRef<T> & RefAttributes<infer Method>
      >
        ? Method
        : ComponentPropsWithRef<T> extends RefAttributes<infer Method>
        ? Method
        : never

    export interface RefObject<T> {
      readonly current: T | null
    }

    export interface Attributes {
      key?: Key | null | undefined
    }

    export interface RefAttributes<T> extends Attributes {
      ref?: Ref<T> | undefined
    }

    export interface Element<
      P = any,
      T extends string | ComponentType<any> = string | ComponentType<any>,
    > {
      type: T
      props: P
      key: Key | null
    }

    export interface Component<P = EmptyObj, S = EmptyObj>
      extends ReactComponent<P, S> {
      context: unknown
      setState<K extends keyof S>(
        state:
          | ((
              prevState: Readonly<S>,
              props: Readonly<P>,
            ) => Pick<S, K> | S | null)
          | (Pick<S, K> | S | null),
        callback?: () => void,
      ): void
      forceUpdate(callback?: () => void): void
      render(): Node
      readonly props: Readonly<P>
      state: Readonly<S>
    }

    export interface Portal extends Element {
      key: Key | null
      children: Children
    }

    export interface ComponentClass<P = EmptyObj, S = any> {
      new (props: P, context?: any): Component<P, S>
    }

    export interface FunctionComponent<P = EmptyObj, S = any> {
      (props: PropsWithChildren<P>, context?: any): Element<any, any> | null
      propTypes?: WeakValidationMap<P> | undefined
      contextTypes?: PropValidationMap<any> | undefined
      defaultProps?: Partial<P> | undefined
      displayName?: string | undefined
    }

    export interface ElementAttributesProperty {
      props: EmptyObj
    }

    export interface ElementChildrenAttribute {
      children: EmptyObj
    }

    // TODO: similar to how Fragment is actually a symbol, the values returned from createContext,
    // forwardRef and memo are actually objects that are treated specially by the renderer; see:
    // https://github.com/facebook/react/blob/v16.6.0/packages/react/src/ReactContext.js#L35-L48
    // https://github.com/facebook/react/blob/v16.6.0/packages/react/src/forwardRef.js#L42-L45
    // https://github.com/facebook/react/blob/v16.6.0/packages/react/src/memo.js#L27-L31
    // However, we have no way of telling the JSX parser that it's a JSX element type or its props
    // other than by pretending to be a normal component.  We don't just use ComponentType or
    // FunctionComponent types because you are not supposed to attach statics to this object, but
    // rather to the original function.
    export interface ExoticComponent<P = AnyObj> {
      /**
       * **NOTE**: Exotic components are not callable.
       */
      (props: P): Element | null
      readonly $$typeof: symbol
    }

    export interface NamedExoticComponent<P = AnyObj>
      extends ExoticComponent<P> {
      displayName?: string | undefined
    }

    // will show `ForwardRef(${Component.displayName || Component.name})` in devtools by default,
    // but can be given its own specific name
    export interface ForwardRefExoticComponent<P>
      extends NamedExoticComponent<P> {
      defaultProps?: Partial<P> | undefined
      propTypes?: WeakValidationMap<P> | undefined
    }

    export interface ResolveProps<P = any> {
      <OUT = P>(inProps: P): OUT
    }

    export type InnerRefProp<T = any> = { innerRef?: Ref<T> }
    export type PropsWithInnerRef<P, T = any> = P & InnerRefProp<T>
  }
}

export {}
