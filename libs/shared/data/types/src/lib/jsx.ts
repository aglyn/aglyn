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

import type { Component } from 'react'
import { ElementType, Ref } from 'react'


export type JSXKey = string | number

export type JSXText = string | symbol
export type JSXChild = JSXElementBase | JSXText
export type JSXFragment = {} | JSXNodeArray
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
  JSXIntrinsicElement<P>
  | JSXElementConstructor<P>

interface JSXNodeArray extends Array<JSXNode> {}

export interface JSXElementBase<P = any,
  T extends string | JSXElementConstructor<any> = string | JSXElementConstructor<any>> {
  type: T
  props: P
  key: JSXKey | null
}

export interface JSXElementClassBase<P = {}, S = {}> extends Component<P, S> {
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

interface JSXPortal extends JSXElementBase {
  key: JSXKey | null
  children: JSXNode
}

export interface JSXElement extends JSXElementBase {}

export interface JSXElementClass extends JSXElementClassBase {}

export interface JSXElementAttributesProperty extends JSX.ElementAttributesProperty {}

export interface JSXElementChildrenAttribute extends JSX.ElementChildrenAttribute {}

export interface ResolveProps<P = any> {
  <OUT = P>(inProps: P): OUT
}

export type InnerRefProp<T = any> = { innerRef?: Ref<T> }
export type PropsWithInnerRef<P, T> = InnerRefProp<T> & P

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

export type OverrideableComponentProps<P = any, T = OverrideComponentProp> = P &
  OverrideComponentPropPlusOverrideProps<T>
