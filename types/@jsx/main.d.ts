/**
 * @license
 * Copyright 2024 Aglyn LLC
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
import type {
  Component as ReactComponent,
  ReactElement,
  ReactNode,
} from 'react'
import type { JSX as ReactJSX } from 'react/jsx-runtime'

declare global {
  namespace JSX {
    // React 19 removed these from the global JSX namespace; restore them here so
    // type annotations like JSX.Element and JSX.IntrinsicElements continue to work.
    interface Element extends ReactElement<any, any> {}
    interface ElementClass extends ReactJSX.ElementClass {}
    interface IntrinsicAttributes extends ReactJSX.IntrinsicAttributes {}
    interface IntrinsicClassAttributes<T> extends ReactJSX.IntrinsicClassAttributes<T> {}
    interface IntrinsicElements extends ReactJSX.IntrinsicElements {}
    type LibraryManagedAttributes<C, P> = ReactJSX.LibraryManagedAttributes<C, P>

    /** The index key when symbol is not supported */
    type Key = string | number
    /** The attribute key prop components */
    type KeyPropType = Key | null | undefined
    /** The attribute key prop components */
    type KeyProps = { key: KeyPropType }
    namespace Key {
      /** The index signature for an object key  */
      type Any = string | number | symbol
      /** The index signature for a mapped object */
      type Map = string | symbol
      /** The index signature type of T */
      type Of<T> = keyof T
      /** The index value type of T  */
      type OfIndex<T, K extends Of<T> = Of<T>> = T[K]
    }

    /** Type safe object "{}" record (optionally specify index type) */
    type AnyObj<K extends Key.Any = Key.Any> = Record<K, unknown>
    /** Dictionary collection optionally specify values to T */
    type EmptyObj<K extends Key.Any = never> = Record<K, never>
    /** Any type of object record with string index types */
    type AnyProps<K extends Key.Any = Key.Any> = Partial<Record<K, unknown>>
    /** From T, omit properties in union with 'K' "distributively" for union types */
    type DistributiveOmit<T, K extends Key.Any> = T extends any
      ? Omit<T, K>
      : never

    type Text = string | number
    type Child = Element | Text
    type Fragment = Iterable<ReactNode>
    /** Alias for React.ReactNode — the full set of renderable content in React 19. */
    type Node = ReactNode
    type NodeList = Node[] | ArrayLike<Node>
    type NodeIterableList = NodeList | Iterable<Node>
    type Children = Node

    type IntrinsicElementMap<P = any> = {
      [K in keyof IntrinsicElements]: P extends IntrinsicElements[K] ? K : never
    }
    type IntrinsicElement<P = any> =
      IntrinsicElementMap<P>[keyof IntrinsicElements]

    type ElementFunctionComponent<P = any> = {
      (props: P): ReactNode
    }
    type ElementClassComponent<P = any> = ComponentClass<P, any>
    type ComponentType<P> =
      | ElementFunctionComponent<P>
      | ElementClassComponent<P>
    type ElementType<P = any> = IntrinsicElement<P> | ComponentType<P>

    type ElementConstructor<P> =
      | ((props: P) => ReactNode)
      | (new (props: P) => Component<P, any>)

    // interface Element<
    //   P = any,
    //   T extends string | JSXElementConstructor<any> =
    //     | string
    //     | JSXElementConstructor<any>,
    // > {
    //   type: T
    //   props: P
    //   key: Key | null
    // }

    interface ComponentClass<P = EmptyObj, S = any> {
      new (props: P, context?: any): Component<P, S>
    }

    interface Component<P = EmptyObj, S = EmptyObj>
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

    interface Portal extends Element {
      children: Children
    }

    interface FunctionComponent<P = EmptyObj, S = any> {
      (props: PropsWithChildren<P>, context?: any): ReactNode
      propTypes?: WeakValidationMap<P> | undefined
      contextTypes?: PropValidationMap<any> | undefined
      defaultProps?: Partial<P> | undefined
      displayName?: string | undefined
    }

    // TODO: similar to how Fragment is actually a symbol, the values returned
    // from createContext, forwardRef and memo are actually objects that are
    // treated specially by the renderer; see:
    // https://github.com/facebook/react/blob/v16.6.0/packages/react/src/ReactContext.js#L35-L48
    // https://github.com/facebook/react/blob/v16.6.0/packages/react/src/forwardRef.js#L42-L45
    // https://github.com/facebook/react/blob/v16.6.0/packages/react/src/memo.js#L27-L31
    // However, we have no way of telling the JSX parser that it's a JSX
    // element type or its props other than by pretending to be a normal
    // component.  We don't just use ComponentType or FunctionComponent types
    // because you are not supposed to attach statics to this object, but
    // rather to the original function.
    interface ExoticComponent<P = EmptyObj> {
      /**
       * **NOTE**: Exotic components are not callable.
       */
      (props: P): ReactNode
      readonly $$typeof: symbol
    }

    interface NamedExoticComponent<P = EmptyObj> extends ExoticComponent<P> {
      displayName?: string | undefined
    }

    // will show `ForwardRef(${Component.displayName || Component.name})` in
    // devtools by default, but can be given its own specific name
    interface ForwardRefExoticComponent<P> extends NamedExoticComponent<P> {
      defaultProps?: Partial<P> | undefined
      propTypes?: WeakValidationMap<P> | undefined
    }

    type RefCallback<T> = {
      bivarianceHack(instance: T | null): void
    }['bivarianceHack']

    interface RefObject<T> {
      readonly current: T | null
    }

    interface MutableRefObject<T> {
      current: T
    }

    type Ref<T> = RefCallback<T> | RefObject<T> | null
    /**
     * Gets the instance type for a React element. The instance will be
     * different for various component types:
     *
     * - React class components will be the class instance. So if you had
     * `class Foo extends React.Component<{}> {}` and used
     * `React.ElementRef<typeof Foo>` then the type would be the instance of
     * `Foo`.
     * - React stateless functional components do not have a backing instance
     * and so `React.ElementRef<typeof Bar>`
     *   (when `Bar` is `function Bar() {}`) will give you the `undefined`
     * type.
     * - JSX intrinsics like `div` will give you their DOM instance. For
     * `React.ElementRef<'div'>` that would be
     *   `HTMLDivElement`. For `React.ElementRef<'input'>` that would be
     * `HTMLInputElement`.
     * - React stateless functional components that forward a `ref` will give
     * you the `ElementRef` of the forwarded to component.
     *
     * `C` must be the type _of_ a React component so you need to use typeof as
     * in React.ElementRef<typeof MyComponent>.
     *
     * @todo In Flow, this works a little different with forwarded refs and the
     *   `AbstractComponent` that
     *       `React.forwardRef()` returns.
     */
    type ElementRef<
      C extends
        | ForwardRefExoticComponent<any>
        | { new (props: any): Component<any> }
        | ((props: any, context?: any) => ReactElement | null)
        | keyof JSX.IntrinsicElements,
    > =
      // need to check first if `ref` is a valid prop for ts@3.0
      // otherwise it will infer `{}` instead of `never`
      'ref' extends keyof ComponentPropsWithRef<C>
        ? NonNullable<ComponentPropsWithRef<C>['ref']> extends Ref<
            infer Instance
          >
          ? Instance
          : never
        : never

    type ComponentRef<T extends ElementType> = T extends NamedExoticComponent<
      ComponentPropsWithoutRef<T> & RefAttributes<infer Method>
    >
      ? Method
      : ComponentPropsWithRef<T> extends RefAttributes<infer Method>
        ? Method
        : never

    interface RefAttributes<T> extends Attributes {
      ref?: Ref<T> | undefined
    }

    /** Ensures that the props do not include ref at all */
    type PropsWithoutRef<P> =
      // Pick would not be sufficient for this. We'd like to avoid unnecessary
      // mapping and need a distributive conditional to support unions. see:
      // https://www.typescriptlang.org/docs/handbook/2/conditional-types.html#distributive-conditional-types
      // https://github.com/Microsoft/TypeScript/issues/28339
      P extends any
        ? 'ref' extends keyof P
          ? Pick<P, Exclude<keyof P, 'ref'>>
          : P
        : P
    /** Ensures that the props do not include forwardedRef at all */
    type PropsWithoutForwardedRef<P> = P extends any
      ? 'forwardedRef' extends keyof P
        ? Pick<P, Exclude<keyof P, 'forwardedRef'>>
        : P
      : P

    /** Ensures that the props do not include string ref, which cannot be forwarded */
    type PropsWithRef<P> =
      // Just "P extends { ref?: infer R }" looks sufficient, but R will infer as
      // {} if P is {}.
      'ref' extends keyof P
        ? P extends { ref?: infer R | undefined }
          ? string extends R
            ? PropsWithoutRef<P> & { ref?: Exclude<R, string> | undefined }
            : P
          : P
        : P
    /** Ensures that the props do not include string forwardedRef, which cannot be forwarded */
    type PropsWithForwardedRef<P> = 'forwardedRef' extends keyof P
      ? P extends { forwardedRef?: infer R | undefined }
        ? string extends R
          ? PropsWithoutRef<P> & {
              forwardedRef?: Exclude<R, string> | undefined
            }
          : P
        : P
      : P

    type ComponentPropsWithRef<T extends ElementType> =
      T extends ElementClassComponent<infer P>
        ? PropsWithoutRef<P> & RefAttributes<InstanceType<T>>
        : PropsWithRef<ComponentProps<T>>
    type ComponentPropsWithoutRef<T extends ElementType> = PropsWithoutRef<
      ComponentProps<T>
    >

    type ComponentPropsWithForwardedRef<T extends ElementType> =
      T extends ElementClassComponent<infer P>
        ? PropsWithoutForwardedRef<P> & RefAttributes<InstanceType<T>>
        : PropsWithForwardedRef<ComponentProps<T>>
    type ComponentPropsWithoutForwardedRef<T extends ElementType> =
      PropsWithoutForwardedRef<ComponentProps<T>>

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

    type PropsWithChildren<P = unknown> = P & {
      children?: ReactNode | undefined
    }

    interface Attributes {
      key?: KeyPropType
    }

    interface ElementAttributesProperty {
      props: EmptyObj
    }

    interface ElementChildrenAttribute {
      children: EmptyObj
    }

    interface ResolveProps<P = unknown, U extends P = P> {
      <U extends P>(props: P): U
      <U extends P>(props: P): PromiseLike<U>
      (props: P): U
      (props: P): PromiseLike<U>
    }

    type PropValidator<T> = PropTypesValidator<T>
    type PropRequireable<T> = PropTypesRequireable<T>
    type PropValidationMap<T> = PropTypesValidationMap<T>
    type WeakValidationMap<T> = {
      [K in keyof T]?: null extends T[K]
        ? PropValidator<T[K] | null | undefined>
        : undefined extends T[K]
          ? PropValidator<T[K] | null | undefined>
          : PropValidator<T[K]>
    }
  }
}

export {}
