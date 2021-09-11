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

import { DistributiveOmit } from '@aglyn/shared/util/types'
import {
  ComponentProps,
  ComponentPropsWithRef,
  ElementType,
  JSXElementConstructor,
  Ref,
} from 'react'


export type InferElementTypeProps<T> = T extends ElementType<infer P> ? P : never

export type OverrideComponentProp<P = any> = { component?: ElementType<P> }
export type OverrideComponentsProps<T extends OverrideComponentProp = any> =
  [T] extends [{ component: infer P }]
    ? InferElementTypeProps<P>
    : never
export type OverrideComponentPropPlusOverrideProps<T extends OverrideComponentProp = any> =
  [T] extends [{ component: ElementType }]
    ? OverrideComponentsProps<T> & Pick<T, 'component'>
    : { component?: undefined }

export type OverrideableComponentProps<P = any, T = OverrideComponentProp> = P & OverrideComponentPropPlusOverrideProps<T>

export type InnerRefProp<T = any> = {
  innerRef?: Ref<T>
}
export type PropsWithInnerRef<P, T> = InnerRefProp<T> & P


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
    : DecorationTargetProps[P];
};

/**
 * a function that takes {component} and returns a component that passes along
 * all the props to {component} except the {InjectedProps} and will accept
 * additional {AdditionalProps}
 */
export type PropInjector<InjectedProps, AdditionalProps = {}> = <C extends JSXElementConstructor<ConsistentWith<ComponentProps<C>, InjectedProps>>,
  >(
  component: C,
) => JSXElementConstructor<DistributiveOmit<JSX.LibraryManagedAttributes<C, ComponentProps<C>>, keyof InjectedProps> &
  AdditionalProps>;

/**
 * Generate a set of string literal types with the given default record `T` and
 * override record `U`.
 *
 * If the property value was `true`, the property key will be added to the
 * string union.
 *
 * @internal
 */
export type OverridableStringUnion<T extends string | number, U = {}> = GenerateStringUnion<Overwrite<Record<T, true>, U>>;

/**
 * Like `T & U`, but using the value types from `U` where their properties overlap.
 *
 * @internal
 */
export type Overwrite<T, U> = DistributiveOmit<T, keyof U> & U;

type GenerateStringUnion<T> = Extract<{
  [Key in keyof T]: true extends T[Key] ? Key : never;
}[keyof T],
  string>;

// https://stackoverflow.com/questions/53807517/how-to-test-if-two-types-are-exactly-the-same
type IfEquals<T, U, Y = unknown, N = never> = (<G>() => G extends T ? 1 : 2) extends <G,
    >() => G extends U ? 1 : 2
  ? Y
  : N;

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
      component: C;
    } & OverrideProps<M, C>,
  ): JSX.Element;
  (props: DefaultComponentProps<M>): JSX.Element;
  propTypes?: any;
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
  props: {};
  defaultComponent: ElementType;
}
