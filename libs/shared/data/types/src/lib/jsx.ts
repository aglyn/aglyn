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
export type JSXIntrinsicElement<P = any> = JSXIntrinsicElementMap<P>[keyof JSXIntrinsicElementMap]

interface JSXNodeArray extends Array<JSXNode> {}

export interface JSXElementBase<
  P = any,
  T extends string | JSXElementConstructor<any> = string | JSXElementConstructor<any>
> {
  type: T
  props: P
  key: JSXKey | null
}

export interface JSXElementClassBase<P = {}, S = {}> {
  context: unknown
  setState<K extends keyof S>(
    state:
      | ((prevState: Readonly<S>, props: Readonly<P>) => Pick<S, K> | S | null)
      | (Pick<S, K> | S | null),
    callback?: () => void
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
