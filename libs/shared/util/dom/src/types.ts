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


export type VisualViewport = EventTarget & {
  width: number,
  height: number,
  offsetLeft: number,
  offsetTop: number,
  scale: number,
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
  getBoundingClientRect: () => ClientRect | DOMRect,
  contextElement?: Element,
}

export type Coordinates = {
  x: number;
  y: number;
}
