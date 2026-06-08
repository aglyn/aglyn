/**
 * @license
 * Copyright 2023 Aglyn LLC
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

import type { clippingParents, viewport } from './constants/enums'

export type VisualViewport = EventTarget & {
  width: number
  height: number
  offsetLeft: number
  offsetTop: number
  scale: number
}

export type Rect = {
  width: number
  height: number
  x: number
  y: number
}

export type ElementOffsets = {
  y: number
  x: number
}

export type ClientRectObject = {
  x: number
  y: number
  top: number
  left: number
  right: number
  bottom: number
  width: number
  height: number
}

export type VirtualElement = {
  getBoundingClientRect: () => ClientRect | DOMRect
  contextElement?: Element
}

export type Coordinates = {
  x: number
  y: number
}

export interface LayoutRect {
  width: number
  height: number
  offsetLeft: number
  offsetTop: number
}

export interface ViewRect extends LayoutRect {
  top: number
  left: number
  right: number
  bottom: number
}

export type Boundary = HTMLElement | Array<HTMLElement> | typeof clippingParents

export type RootBoundary = typeof viewport | 'document'

export * from './constants/enums'

export * from './lib/controllers/page-title'

export * from './lib/guards/element-contains-child-element'
export * from './lib/guards/event-has-viewport-coordinates'
export * from './lib/guards/is-element-html-element'
export * from './lib/guards/is-element-scroll-parent-element'
export * from './lib/guards/is-element-window'
export * from './lib/guards/is-keyboard-event'
export * from './lib/guards/is-node-element'
export * from './lib/guards/is-node-object'
export * from './lib/guards/is-node-shadow-root'
export * from './lib/guards/is-node-table-element'
export * from './lib/guards/is-node-window-document'
export * from './lib/guards/is-svg-element'
export * from './lib/guards/is-touch-event'

export * from './lib/get-element-rect-as-client-rect'
export * from './lib/get-element-client-rect-bounding'
export * from './lib/get-element-client-rect-bounding-inner'
export * from './lib/get-element-clipping-rect'
export * from './lib/get-element-computed-style'
export * from './lib/get-element-document-element'
export * from './lib/get-element-document-element-rect'
export * from './lib/get-element-list-scroll-parents'
export * from './lib/get-element-node-name'
export * from './lib/get-element-offset-parent'
export * from './lib/get-element-parent-node'
export * from './lib/get-element-scroll-parent'
export * from './lib/get-element-viewport-rect'
export * from './lib/get-element-window-scroll-bar-x'
export * from './lib/get-event-coordinates'
export * from './lib/get-node-window'
export * from './lib/get-node-window-scroll'
export * from './lib/get-iframe-document'
