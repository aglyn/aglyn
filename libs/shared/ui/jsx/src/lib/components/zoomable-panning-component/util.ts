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


export type TransformationMatrix = {
  a: number,
  b: number,
  c: number,
  d: number,
  x: number,
  y: number,
}

export type BoundingBox = {
  top: number,
  left: number,
  width: number,
  height: number,
}

export type BoundaryRatio = {
  vertical: number,
  horizontal: number,
}

export type Coordinates = {
  x: number,
  y: number,
}

export type BoundCoordinates = {boundX: number, boundY: number, offsetX: number, offsetY: number}

export type TransformationParameters = {
  angle: number,
  scale: number,
  offsetX: number,
  offsetY: number,
}

export const ZOOM_SPEED_MULTIPLIER = 0.065

// Transform matrix use to rotate, zoom and pan
// Can be written as T(centerX, centerY) * R(theta) * T(-centerX, -centerY) * S(scale, scale) + T(offsetX, offsetY)
// ( a , c, x )
// ( b , d, y )
// ( 0 , 0, 1 )
export const TransformMatrix = (transformationParameters: TransformationParameters, centerCoordinates: Coordinates, ): TransformationMatrix => {
  const {angle, scale, offsetX, offsetY} = transformationParameters
  const {x: centerX, y: centerY} = centerCoordinates
  const theta = angle * Math.PI / 180
  const a = Math.cos(theta) * scale
  const b = Math.sin(theta) * scale
  const c = -b
  const d = a
  const transformX = -centerX * a + centerY * b + centerX * scale
  const transformY = centerX * c - centerY * d + centerY * scale
  return {a, b, c, d, x: transformX + offsetX, y: transformY + offsetY}
}

const applyTransformMatrix = (
  transformationParameters: TransformationParameters,
  centerCoordinates: Coordinates,
) => (x, y): [number, number] => {
  const {a, b, c, d, x: transformX, y: transformY} = TransformMatrix(transformationParameters, centerCoordinates)
  return [
    x * a + y * c + transformX,
    x * b + y * d + transformY,
  ]
}

export const getTransformedBoundingBox = (
  transformationParameters: TransformationParameters,
  boundingBox: BoundingBox,
): BoundingBox => {
  const {top, left, width, height} = boundingBox
  const center = {
    x: width / 2,
    y: height / 2,
  }

  const getTransformedCoordinates = applyTransformMatrix(transformationParameters, center)

  const [x1, y1] = getTransformedCoordinates(left, top)
  const [x2, y2] = getTransformedCoordinates(left + width, top)
  const [x3, y3] = getTransformedCoordinates(left + width, top + height)
  const [x4, y4] = getTransformedCoordinates(left, top + height)

  return {
    top: Math.min(y1, y2, y3, y4),
    left: Math.min(x1, x2, x3, x4),
    width: Math.max(x1, x2, x3, x4) - Math.min(x1, x2, x3, x4),
    height: Math.max(y1, y2, y3, y4) - Math.min(y1, y2, y3, y4),
  }
}

export const getScaleMultiplier = (
  delta: number,
  zoomSpeed = 1,
): number => {
  const speed = ZOOM_SPEED_MULTIPLIER * zoomSpeed
  let scaleMultiplier = 1
  if (delta > 0) { // zoom out
    scaleMultiplier = (1 - speed)
  }
  else if (delta < 0) { // zoom in
    scaleMultiplier = (1 + speed)
  }

  return scaleMultiplier
}

export const boundCoordinates = (
  x: number,
  y: number,
  boundaryRatio: BoundaryRatio,
  boundingBox: BoundingBox,
  containerHeight: number,
  containerWidth: number,
  offsetX = 0,
  offsetY = 0,
): BoundCoordinates => {

  const {top, left, width, height} = boundingBox
  // check that computed are inside boundaries otherwise set to the bounding box limits
  let boundX = left
  let boundY = top

  if (boundY < -boundaryRatio.vertical * height) {
    boundY = -boundaryRatio.vertical * height
  }
  else if (boundY > containerHeight - (1 - boundaryRatio.vertical) * height) {
    boundY = containerHeight - (1 - boundaryRatio.vertical) * height
  }

  if (boundX < -boundaryRatio.horizontal * width) {
    boundX = -boundaryRatio.horizontal * width
  }
  else if (boundX > containerWidth - (1 - boundaryRatio.horizontal) * width) {
    boundX = containerWidth - (1 - boundaryRatio.horizontal) * width
  }

  // return new bounds coordinates for the transform matrix
  // not the computed x/y coordinates
  return {
    boundX: x - (left - boundX),
    boundY: y - (top - boundY),
    offsetX: offsetX - (left - boundX),
    offsetY: offsetY - (top - boundY),
  }
}


export const preventDefault = (e) => {
  e.preventDefault()
}

export const captureTextSelection = () => {
  if (typeof window !== 'undefined') {
    window.addEventListener('selectstart', preventDefault)
  }
}

export const releaseTextSelection = () => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('selectstart', preventDefault)
  }
}
