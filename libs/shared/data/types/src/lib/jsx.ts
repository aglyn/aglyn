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

import type {
  Requireable as PropTypesRequireable,
  ValidationMap as PropTypesValidationMap,
  Validator as PropTypesValidator,
} from 'prop-types'
import type {Component, ComponentProps, ComponentPropsWithRef, ElementType, Ref} from 'react'
import type {AnyObj, DistributiveOmit, EmptyObj} from './basic'


export type JSXKey = string | number

export type JSXText = string | symbol
export type JSXChild = JSXElementBase | JSXText
export type JSXFragment = EmptyObj | JSXNodeArray
export type JSXNode = JSXChild | JSXFragment | JSXPortal | boolean | null | undefined

export type JSXIntrinsicElements = JSX.IntrinsicElements
export type JSXIntrinsicAttributes = JSX.IntrinsicAttributes
export type JSXIntrinsicClassAttributes<T> = JSX.IntrinsicClassAttributes<T>
export type JSXIntrinsicElementMap<P = any> = {
  [K in keyof JSXIntrinsicElements]: P extends JSXIntrinsicElements[K] ? K : never
}

export type JSXElementFunctionComponent<P> = (props: P) => JSXElement | null
export type JSXElementClassComponent<P> = new (props: P) => JSXElementClass
export type JSXElementConstructor<P> = JSXElementFunctionComponent<P> | JSXElementClassComponent<P>
export type JSXIntrinsicElement<P = any> = JSXIntrinsicElementMap<P>[keyof JSXIntrinsicElements]
export type JSXElementType<P = any> =
  | JSXIntrinsicElement<P>
  | JSXElementConstructor<P>

export type JSXPropValidator<T> = PropTypesValidator<T>;
export type JSXPropRequireable<T> = PropTypesRequireable<T>;
export type JSXPropValidationMap<T> = PropTypesValidationMap<T>;
type JSXWeakValidationMap<T> = {
  [K in keyof T]?: null extends T[K]
    ? JSXPropValidator<T[K] | null | undefined>
    : undefined extends T[K]
      ? JSXPropValidator<T[K] | null | undefined>
      : JSXPropValidator<T[K]>
}

export type JSXRefCallback<T> = {bivarianceHack(instance: T | null): void}['bivarianceHack'];
export type JSXRef<T> = JSXRefCallback<T> | JSXRefObject<T> | null
/** Ensures that the props do not include ref at all */
export type JSXPropsWithoutRef<P> =
// Pick would not be sufficient for this. We'd like to avoid unnecessary mapping and need a
// distributive conditional to support unions. see:
// https://www.typescriptlang.org/docs/handbook/2/conditional-types.html#distributive-conditional-types
// https://github.com/Microsoft/TypeScript/issues/28339
  P extends any ? ('ref' extends keyof P ? Pick<P, Exclude<keyof P, 'ref'>> : P) : P;

/** Ensures that the props do not include string ref, which cannot be forwarded */
export type JSXPropsWithRef<P> =
// Just "P extends { ref?: infer R }" looks sufficient, but R will infer as {} if P is {}.
  'ref' extends keyof P
    ? P extends {ref?: infer R | undefined}
      ? string extends R
        ? JSXPropsWithoutRef<P> & {ref?: Exclude<R, string> | undefined}
        : P
      : P
    : P;

export type JSXPropsWithChildren<P> = P & {children?: JSXNode | undefined};

export interface JSXRefObject<T> {
  readonly current: T | null;
}

export interface JSXAttributes {
  key?: JSXKey | null | undefined;
}

export interface JSXRefAttributes<T> extends JSXAttributes {
  ref?: JSXRef<T> | undefined;
}

export interface JSXNodeArray extends Array<JSXNode> {}

export interface JSXElementBase<P = any, T extends string | JSXElementConstructor<any> = string | JSXElementConstructor<any>> {
  type: T
  props: P
  key: JSXKey | null
}

export interface JSXElementClassBase<P = EmptyObj, S = EmptyObj> extends Component<P, S> {
  context: unknown
  setState<K extends keyof S>(
    state:
      | ((prevState: Readonly<S>, props: Readonly<P>) => Pick<S, K> | S | null)
      | (Pick<S, K> | S | null),
    callback?: () => void,
  ): void
  forceUpdate(callback?: () => void): void
  render(): JSXNode
  readonly props: Readonly<P>
  state: Readonly<S>
}

export interface JSXPortal extends JSXElementBase {
  key: JSXKey | null
  children: JSXNode
}

export interface JSXElement extends JSXElementBase {}

export interface JSXElementClass extends JSXElementClassBase {}

export interface JSXElementAttributesProperty extends JSX.ElementAttributesProperty {}

export interface JSXElementChildrenAttribute extends JSX.ElementChildrenAttribute {}

// TODO: similar to how Fragment is actually a symbol, the values returned from createContext,
// forwardRef and memo are actually objects that are treated specially by the renderer; see:
// https://github.com/facebook/react/blob/v16.6.0/packages/react/src/ReactContext.js#L35-L48
// https://github.com/facebook/react/blob/v16.6.0/packages/react/src/forwardRef.js#L42-L45
// https://github.com/facebook/react/blob/v16.6.0/packages/react/src/memo.js#L27-L31
// However, we have no way of telling the JSX parser that it's a JSX element type or its props
// other than by pretending to be a normal component.  We don't just use ComponentType or
// FunctionComponent types because you are not supposed to attach statics to this object, but
// rather to the original function.
export interface JSXExoticComponent<P = AnyObj> {
  /**
   * **NOTE**: Exotic components are not callable.
   */
  (props: P): (JSXElementBase | null);
  readonly $$typeof: symbol;
}

export interface JSXNamedExoticComponent<P = AnyObj> extends JSXExoticComponent<P> {
  displayName?: string | undefined;
}

// will show `ForwardRef(${Component.displayName || Component.name})` in devtools by default,
// but can be given its own specific name
export interface JSXForwardRefExoticComponent<P> extends JSXNamedExoticComponent<P> {
  defaultProps?: Partial<P> | undefined;
  propTypes?: JSXWeakValidationMap<P> | undefined;
}

export interface ResolveProps<P = any> {
  <OUT = P>(inProps: P): OUT
}

export type InnerRefProp<T = any> = {innerRef?: Ref<T>}
export type PropsWithInnerRef<P, T = any> = P & InnerRefProp<T>

export type InferElementTypeProps<T> = T extends ElementType<infer P> ? P : never

export type OverrideComponentProp<P = any> = {component?: ElementType<P>}

export type OverrideComponentsProps<T extends OverrideComponentProp = any> =
  [T] extends [{component: infer P}]
    ? InferElementTypeProps<P>
    : never

export type OverrideComponentPropPlusOverrideProps<T extends OverrideComponentProp = any> =
  [T] extends [{component: ElementType}]
    ? OverrideComponentsProps<T> & Pick<T, 'component'>
    : {component?: undefined}

export type OverrideableComponentProps<P = any, T = OverrideComponentProp> = P &
  OverrideComponentPropPlusOverrideProps<T>


//
//
//
//
//
//
//
//
//
//
//


/**
 * `T extends ConsistentWith<T, U>` means that where `T` has overlapping properties with
 * `U`, their value types do not conflict.
 *
 * @internal
 */
export type ConsistentWith<DecorationTargetProps, InjectedProps> = {
  [P in keyof DecorationTargetProps]: P extends keyof InjectedProps
    ? InjectedProps[P] extends DecorationTargetProps[P]
      ? DecorationTargetProps[P]
      : InjectedProps[P]
    : DecorationTargetProps[P]
}

/**
 * a function that takes {component} and returns a component that passes along
 * all the props to {component} except the {InjectedProps} and will accept
 * additional {AdditionalProps}
 */
export type PropInjectorComponent<InjectedProps, AdditionalProps = EmptyObj> = {
  <C extends JSXElementConstructor<ConsistentWith<ComponentProps<C>, InjectedProps>>>(
    component: C,
  ): JSXElementConstructor<DistributiveOmit<JSX.LibraryManagedAttributes<C, ComponentProps<C>>,
    keyof InjectedProps> & AdditionalProps>
}

/**
 * Generate a set of string literal types with the given default record `T` and
 * override record `U`.
 *
 * If the property value was `true`, the property key will be added to the
 * string union.
 *
 * @internal
 */
export type OverridableStringUnion<T extends string | number, U = EmptyObj> = GenerateStringUnion<Overwrite<Record<T, true>, U>>

/**
 * Like `T & U`, but using the value types from `U` where their properties overlap.
 *
 * @internal
 */
export type Overwrite<T, U> = DistributiveOmit<T, keyof U> & U

type GenerateStringUnion<T> = Extract<{
  [Key in keyof T]: true extends T[Key] ? Key : never
}[keyof T],
  string>

// https://stackoverflow.com/questions/53807517/how-to-test-if-two-types-are-exactly-the-same
type IfEquals<T, U, Y = unknown, N = never> = (<G>() => G extends T ? 1 : 2) extends <G>() => G extends U ? 1 : 2
  ? Y
  : N

/**
 * A component whose root component can be controlled via a `component` prop.
 *
 * Adjusts valid props based on the type of `component`.
 */
export interface OverridableComponent<M extends OverridableTypeMap> {
  <C extends ElementType>(
    props: {
      /**
       * The component used for the root node.
       * Either a string to use a HTML element or a component.
       */
      component: C
    } & OverrideProps<M, C>,
  ): JSX.Element
  (props: DefaultComponentProps<M>): JSX.Element
  propTypes?: any
}

/**
 * Props of the component if `component={Component}` is used.
 */
// prettier-ignore
export type OverrideProps<M extends OverridableTypeMap,
  C extends ElementType> = (
  & BaseProps<M>
  & DistributiveOmit<ComponentPropsWithRef<C>, keyof BaseProps<M>>
  );

/**
 * Props if `component={Component}` is NOT used.
 */
// prettier-ignore
export type DefaultComponentProps<M extends OverridableTypeMap> =
  & BaseProps<M>
  & DistributiveOmit<ComponentPropsWithRef<M['defaultComponent']>, keyof BaseProps<M>>;

/**
 * Props defined on the component.
 */
// prettier-ignore
export type BaseProps<M extends OverridableTypeMap> = M['props'];

export interface OverridableTypeMap {
  props: EmptyObj
  defaultComponent: ElementType
}
