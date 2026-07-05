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

import {
  Component,
  createRef,
  PointerEvent,
  MouseEvent,
  KeyboardEvent,
  TouchEvent,
  WheelEvent,
  HTMLAttributes, PropsWithoutRef, PropsWithRef,
} from 'react'
import warning from 'warning'
import {
  BoundCoordinates,
  boundCoordinates,
  captureTextSelection,
  Coordinates,
  getScaleMultiplier,
  getTransformedBoundingBox,
  releaseTextSelection,
  TransformationMatrix,
  TransformationParameters,
  TransformMatrix,
} from './util'


type OnStateChangeData = {
  x: number,
  y: number,
  scale: number,
  angle: number
}

export interface ZoomablePanningComponentProps extends PropsWithRef<HTMLAttributes<HTMLDivElement>> {
  zoomSpeed: number,
  doubleZoomSpeed: number,
  disabled?: boolean,
  autoCenter?: boolean,
  autoCenterZoomLevel?: number,
  disableKeyInteraction?: boolean,
  disableDoubleClickZoom?: boolean,
  disableScrollZoom?: boolean,
  realPinch?: boolean,
  keyMapping?: Record<string, {x: number, y: number, z: number}>,
  minZoom: number,
  maxZoom: number,
  preventPan: (event: PointerEvent<HTMLDivElement> | MouseEvent, x: number, y: number) => boolean,
  noStateUpdate: boolean,
  boundaryRatioVertical: number,
  boundaryRatioHorizontal: number,
  enableBoundingBox?: boolean,

  onPanStart?: (event: MouseEvent<any> | TouchEvent<any>) => void,
  onPan?: (event: MouseEvent<any> | TouchEvent<any>) => void,
  onPanEnd?: (event: MouseEvent<any> | TouchEvent<any>) => void,
  onStateChange?: (data: OnStateChangeData) => void,
}

type State = {
  x: number,
  y: number,
  scale: number,
  angle: number
}

const getTransformMatrixString = (transformationMatrix: TransformationMatrix) => {
  const {a, b, c, d, x, y} = transformationMatrix
  return `matrix(${a}, ${b}, ${c}, ${d}, ${x}, ${y})`
}

export class ZoomablePanningComponent extends Component<ZoomablePanningComponentProps, State> {
  static defaultProps = {
    zoomSpeed: 1,
    doubleZoomSpeed: 1.75,
    disabled: false,
    minZoom: 0,
    maxZoom: Infinity,
    noStateUpdate: true,
    boundaryRatioVertical: 0.8,
    boundaryRatioHorizontal: 0.8,
    disableDoubleClickZoom: false,
    disableScrollZoom: false,
    preventPan: () => false,
  }

  container = createRef<HTMLDivElement>()
  dragContainer = createRef<HTMLDivElement>()

  mousePos = {
    x: 0,
    y: 0,
  }
  panning = false
  touchInProgress = false
  panStartTriggered = false

  pinchZoomLength = 0

  prevPanPosition = {
    x: 0,
    y: 0,
  }

  frameAnimation = 0
  intermediateFrameAnimation = 0

  transformMatrixString = `matrix(1, 0, 0, 1, 0, 0)`
  intermediateTransformMatrixString = `matrix(1, 0, 0, 1, 0, 0)`

  override state: State = {
    x: 0,
    y: 0,
    scale: 1,
    angle: 0,
  }

  override componentDidMount(): void {
    const {autoCenter, autoCenterZoomLevel, minZoom, maxZoom} = this.props

    if (this.container.current) {
      this.container.current.addEventListener('wheel', this.onWheel as any, {passive: false})
    }

    if (maxZoom < minZoom) {
      throw new Error('[PanZoom]: maxZoom props cannot be inferior to minZoom')
    }
    if (autoCenter) {
      this.autoCenter(autoCenterZoomLevel, false)
    }
  }

  override componentDidUpdate(prevProps: ZoomablePanningComponentProps, prevState: State): void {
    if (prevProps.autoCenter !== this.props.autoCenter
      && this.props.autoCenter) {
      this.autoCenter(this.props.autoCenterZoomLevel)
    }
    if (
      (prevState.x !== this.state.x
        || prevState.y !== this.state.y
        || prevState.scale !== this.state.scale
        || prevState.angle !== this.state.angle)
      && this.props.onStateChange
    ) {
      this.props.onStateChange({
        x: this.state.x,
        y: this.state.y,
        scale: this.state.scale,
        angle: this.state.angle,
      })
    }
  }

  override componentWillUnmount(): void {
    this.cleanMouseListeners()
    this.cleanTouchListeners()
    releaseTextSelection()
    if (this.container.current) {
      this.container.current.removeEventListener('wheel', this.onWheel as any, {passive: false} as any)
    }
  }

  onDoubleClick = (e: MouseEvent<any>) => {
    const {onDoubleClick, disableDoubleClickZoom, doubleZoomSpeed} = this.props

    if (typeof onDoubleClick === 'function') {
      onDoubleClick(e)
    }

    if (disableDoubleClickZoom) {
      return
    }

    const offset = this.getOffset(e)
    this.zoomTo(offset.x, offset.y, doubleZoomSpeed)
  }

  onMouseDown = (e: MouseEvent<any>) => {
    const {preventPan, onMouseDown} = this.props

    if (typeof onMouseDown === 'function') {
      onMouseDown(e)
    }

    if (this.props.disabled) {
      return
    }

    // Touch events fire mousedown on modern browsers, but it should not
    // be considered as we will handle touch event separately
    if (this.touchInProgress) {
      e.stopPropagation()
      return
    }

    const isLeftButton = ((e.button === 1 && window.event !== null) || e.button === 0)
    if (!isLeftButton) {
      return
    }

    const offset = this.getOffset(e)

    // check if there is nothing preventing the pan
    if (preventPan && preventPan(e, offset.x, offset.y)) {
      return
    }

    this.mousePos = {
      x: offset.x,
      y: offset.y,
    }

    // keep the current pan value in memory to allow noStateUpdate panning
    this.prevPanPosition = {
      x: this.state.x,
      y: this.state.y,
    }

    this.panning = true

    this.setMouseListeners()

    // Prevent text selection
    captureTextSelection()
  }

  onMouseMove = (e: MouseEvent<any>) => {
    if (this.panning) {
      const {noStateUpdate} = this.props

      // TODO disable if using touch event

      this.triggerOnPanStart(e)

      const offset = this.getOffset(e)
      const dx = offset.x - this.mousePos.x
      const dy = offset.y - this.mousePos.y

      this.mousePos = {
        x: offset.x,
        y: offset.y,
      }

      this.moveBy(dx, dy, noStateUpdate)
      this.triggerOnPan(e)
    }
  }

  onMouseUp = (e: MouseEvent<any>) => {
    const {noStateUpdate} = this.props

    // if using noStateUpdate we still need to set the new values in the state
    if (noStateUpdate) {
      this.setState({x: this.prevPanPosition.x, y: this.prevPanPosition.y})
    }

    this.triggerOnPanEnd(e)
    this.cleanMouseListeners()
    this.panning = false
    releaseTextSelection()
  }

  onWheel = (e: WheelEvent<any>) => {
    const {disableScrollZoom, disabled, zoomSpeed} = this.props
    if (disableScrollZoom || disabled) {
      return
    }

    const scale = getScaleMultiplier(e.deltaY, zoomSpeed)
    const offset = this.getOffset(e)
    this.zoomTo(offset.x, offset.y, scale)
    e.preventDefault()
  }

  onKeyDown = (e: KeyboardEvent<any>) => {
    const {keyMapping, disableKeyInteraction, onKeyDown} = this.props

    if (typeof onKeyDown === 'function') {
      onKeyDown(e)
    }

    if (disableKeyInteraction) {
      return
    }

    const keys: Record<string, { x: number; y: number; z: number }> = {
      '38': {x: 0, y: -1, z: 0}, // up
      '40': {x: 0, y: 1, z: 0}, // down
      '37': {x: -1, y: 0, z: 0}, // left
      '39': {x: 1, y: 0, z: 0}, // right
      '189': {x: 0, y: 0, z: 1}, // zoom out
      '109': {x: 0, y: 0, z: 1}, // zoom out
      '187': {x: 0, y: 0, z: -1}, // zoom in
      '107': {x: 0, y: 0, z: -1}, // zoom in
      ...keyMapping,
    }

    const mappedCoords = keys[String(e.keyCode)]
    if (mappedCoords) {
      const {x, y, z} = mappedCoords
      e.preventDefault()
      e.stopPropagation()

      if ((x || y) && this.container.current) {
        const containerRect = this.container.current.getBoundingClientRect()
        const offset = Math.min(containerRect.width, containerRect.height)
        const moveSpeedRatio = 0.05
        const dx = offset * moveSpeedRatio * x
        const dy = offset * moveSpeedRatio * y

        this.moveBy(dx, dy)
      }

      if (z) {
        this.centeredZoom(z)
      }
    }
  }

  onKeyUp = (e: KeyboardEvent<any>) => {
    const {disableKeyInteraction, onKeyUp} = this.props

    if (typeof onKeyUp === 'function') {
      onKeyUp(e)
    }

    if (disableKeyInteraction) {
      return
    }

    if (this.prevPanPosition && (this.prevPanPosition.x !== this.state.x || this.prevPanPosition.y !== this.state.y)) {
      this.setState({x: this.prevPanPosition.x, y: this.prevPanPosition.y})
    }
  }

  onTouchStart = (e: TouchEvent<any>) => {
    const {preventPan, onTouchStart, disabled} = this.props
    if (typeof onTouchStart === 'function') {
      onTouchStart(e)
    }

    if (disabled) {
      return
    }

    if (e.touches.length === 1) {
      // Drag
      const touch = e.touches[0]
      const offset = this.getOffset(touch as any)

      if (preventPan && preventPan(e as any, offset.x, offset.y)) {
        return
      }

      this.mousePos = {
        x: offset.x,
        y: offset.y,
      }

      // keep the current pan value in memory to allow noStateUpdate panning
      this.prevPanPosition = {
        x: this.state.x,
        y: this.state.y,
      }

      this.touchInProgress = true
      this.setTouchListeners()
    }
    else if (e.touches.length === 2) {
      // pinch
      this.pinchZoomLength = this.getPinchZoomLength(e.touches[0] as any, e.touches[1] as any)
      this.touchInProgress = true
      this.setTouchListeners()
    }
  }

  onToucheMove = (e: TouchEvent<any>) => {
    const {realPinch, noStateUpdate, zoomSpeed} = this.props
    if (e.touches.length === 1) {
      e.stopPropagation()
      const touch = e.touches[0]
      const offset = this.getOffset(touch as any)

      const dx = offset.x - this.mousePos.x
      const dy = offset.y - this.mousePos.y

      if (dx !== 0 || dy !== 0) {
        this.triggerOnPanStart(e)
      }

      this.mousePos = {
        x: offset.x,
        y: offset.y,
      }

      this.moveBy(dx, dy, noStateUpdate)
      this.triggerOnPan(e)
    }
    else if (e.touches.length === 2) {
      const finger1 = e.touches[0]
      const finger2 = e.touches[1]
      const currentPinZoomLength = this.getPinchZoomLength(finger1 as any, finger2 as any)

      let scaleMultiplier = 1

      if (realPinch) {
        scaleMultiplier = currentPinZoomLength / this.pinchZoomLength
      }
      else {
        let delta = 0
        if (currentPinZoomLength < this.pinchZoomLength) {
          delta = 1
        }
        else if (currentPinZoomLength > this.pinchZoomLength) {
          delta = -1
        }
        scaleMultiplier = getScaleMultiplier(delta, zoomSpeed)
      }

      this.mousePos = {
        x: (finger1.clientX + finger2.clientX) / 2,
        y: (finger1.clientY + finger2.clientY) / 2,
      }
      this.zoomTo(this.mousePos.x, this.mousePos.y, scaleMultiplier)
      this.pinchZoomLength = currentPinZoomLength
      e.stopPropagation()
    }
  }

  onTouchEnd = (e: TouchEvent<any>) => {
    if (e.touches.length > 0) {
      const offset = this.getOffset(e.touches[0] as any)
      this.mousePos = {
        x: offset.x,
        y: offset.y,
      }

      // when removing a finger we don't go through onTouchStart
      // thus we need to set the prevPanPosition here
      this.prevPanPosition = {
        x: this.state.x,
        y: this.state.y,
      }
    }
    else {
      const {noStateUpdate} = this.props
      if (noStateUpdate) {
        this.setState({x: this.prevPanPosition.x, y: this.prevPanPosition.y})
      }

      this.touchInProgress = false

      this.triggerOnPanEnd(e)
      this.cleanTouchListeners()
    }
  }

  setMouseListeners = () => {
    document.addEventListener('mousemove', this.onMouseMove as any)
    document.addEventListener('mouseup', this.onMouseUp as any)
  }

  cleanMouseListeners = () => {
    document.removeEventListener('mousemove', this.onMouseMove as any)
    document.removeEventListener('mouseup', this.onMouseUp as any)

    if (this.frameAnimation) {
      window.cancelAnimationFrame(this.frameAnimation)
      this.frameAnimation = 0
    }

    if (this.intermediateFrameAnimation) {
      window.cancelAnimationFrame(this.intermediateFrameAnimation)
      this.intermediateFrameAnimation = 0
    }
  }

  setTouchListeners = () => {
    document.addEventListener('touchmove', this.onToucheMove as any)
    document.addEventListener('touchend', this.onTouchEnd as any)
    document.addEventListener('touchcancel', this.onTouchEnd as any)
  }

  cleanTouchListeners = () => {
    document.removeEventListener('touchmove', this.onToucheMove as any)
    document.removeEventListener('touchend', this.onTouchEnd as any)
    document.removeEventListener('touchcancel', this.onTouchEnd as any)

    if (this.frameAnimation) {
      window.cancelAnimationFrame(this.frameAnimation)
      this.frameAnimation = 0
    }

    if (this.intermediateFrameAnimation) {
      window.cancelAnimationFrame(this.intermediateFrameAnimation)
      this.intermediateFrameAnimation = 0
    }
  }

  triggerOnPanStart = (e: MouseEvent<any> | TouchEvent<any>) => {
    const {onPanStart} = this.props
    if (!this.panStartTriggered && onPanStart && typeof onPanStart === 'function') {
      onPanStart(e)
    }
    this.panStartTriggered = true
  }

  triggerOnPan = (e: MouseEvent<any> | TouchEvent<any>) => {
    const {onPan} = this.props
    if (typeof onPan === 'function') {
      onPan(e)
    }
  }

  triggerOnPanEnd = (e: MouseEvent<any> | TouchEvent<any>) => {
    const {onPanEnd} = this.props
    this.panStartTriggered = false
    if (typeof onPanEnd === 'function') {
      onPanEnd(e)
    }
  }

  getPinchZoomLength = (finger1: Touch, finger2: Touch): number => {
    return Math.sqrt(
      (finger1.clientX - finger2.clientX) * (finger1.clientX - finger2.clientX) +
      (finger1.clientY - finger2.clientY) * (finger1.clientY - finger2.clientY),
    )
  }

  getContainer = (): HTMLDivElement => {
    const {current: container} = this.container
    if (!container) {
      throw new Error('Could not find container DOM element.')
    }
    return container
  }

  getDragContainer = (): HTMLDivElement => {
    const {current: dragContainer} = this.dragContainer
    if (!dragContainer) {
      throw new Error('Could not find dragContainer DOM element.')
    }
    return dragContainer
  }

  autoCenter = (zoomLevel = 1, animate = true) => {
    const container = this.getContainer()
    const dragContainer = this.getDragContainer()
    const {minZoom, maxZoom} = this.props
    const containerRect = container.getBoundingClientRect()
    const {clientWidth, clientHeight} = dragContainer
    const widthRatio = containerRect.width / clientWidth
    const heightRatio = containerRect.height / clientHeight
    let scale = Math.min(widthRatio, heightRatio) * zoomLevel

    if (scale < minZoom) {
      console.warn(`[PanZoom]: initial zoomLevel produces a scale inferior to minZoom, reverted to default: ${minZoom}. Consider using a zoom level > ${minZoom}`)
      scale = minZoom
    }
    else if (scale > maxZoom) {
      console.warn(`[PanZoom]: initial zoomLevel produces a scale superior to maxZoom, reverted to default: ${maxZoom}. Consider using a zoom level < ${maxZoom}`)
      scale = maxZoom
    }

    const x = (containerRect.width - (clientWidth * scale)) / 2
    const y = (containerRect.height - (clientHeight * scale)) / 2

    let afterStateUpdate = undefined
    if (!animate) {
      const transition = dragContainer.style.transition
      dragContainer.style.transition = 'none'
      afterStateUpdate = () => {
        setTimeout(() => {
          const dragContainer = this.getDragContainer()
          dragContainer.style.transition = transition
        }, 0)
      }
    }

    this.prevPanPosition = {x, y}
    this.setState({x, y, scale, angle: 0}, afterStateUpdate)
  }

  moveByRatio = (x: number, y: number, moveSpeedRatio = 0.05) => {
    const container = this.getContainer()
    const containerRect = container.getBoundingClientRect()
    const offset = Math.min(containerRect.width, containerRect.height)
    const dx = offset * moveSpeedRatio * x
    const dy = offset * moveSpeedRatio * y

    this.moveBy(dx, dy, false)
  }

  moveBy = (dx: number, dy: number, noStateUpdate = true) => {
    const {x, y, scale, angle} = this.state

    // Allow better performance by not updating the state on every change
    if (noStateUpdate) {
      const {x: prevTransformX, y: prevTransformY} = this.getTransformMatrix(this.prevPanPosition.x, this.prevPanPosition.y, scale, angle)
      const {a, b, c, d, x: transformX, y: transformY} = this.getTransformMatrix(this.prevPanPosition.x + dx, this.prevPanPosition.y + dy, scale, angle)
      const {boundX, boundY, offsetX, offsetY} = this.getBoundCoordinates({x: transformX, y: transformY}, {angle, scale, offsetX: this.prevPanPosition.x + dx, offsetY: this.prevPanPosition.y + dy})

      const intermediateX = prevTransformX + (prevTransformX - boundX) / 2
      const intermediateY = prevTransformY + (prevTransformY - boundY) / 2

      this.intermediateTransformMatrixString = getTransformMatrixString({a, b, c, d, x: intermediateX, y: intermediateY})
      this.transformMatrixString = getTransformMatrixString({a, b, c, d, x: boundX, y: boundY})

      // get bound x / y coords without the rotation offset
      this.prevPanPosition = {
        x: offsetX,
        y: offsetY,
      }

      // only apply intermediate animation if it is different from the end result
      if (this.intermediateTransformMatrixString !== this.transformMatrixString) {
        this.intermediateFrameAnimation = window.requestAnimationFrame(this.applyIntermediateTransform)
      }

      this.frameAnimation = window.requestAnimationFrame(this.applyTransform)
    }
    else {
      const {x: transformX, y: transformY} = this.getTransformMatrix(x + dx, y + dy, scale, angle)
      const {boundX, boundY} = this.getBoundCoordinates({x: transformX, y: transformY}, {angle, scale, offsetX: x + dx, offsetY: y + dy})

      this.setState({
        x: x + dx - (transformX - boundX),
        y: y + dy - (transformY - boundY),
      })
    }
  }

  rotate = (value: number | ((prevAngle: number) => number)) => {
    const {angle} = this.state
    let newAngle: number
    if (typeof value === 'function') {
      newAngle = value(angle)
    }
    else {
      newAngle = value
    }
    this.setState({angle: newAngle})
  }

  zoomAbs = (x: number, y: number, zoomLevel: number) => {
    this.zoomTo(x, y, zoomLevel / this.state.scale)
  }

  zoomTo = (x: number, y: number, ratio: number) => {
    const {minZoom, maxZoom} = this.props
    const {x: transformX, y: transformY, scale, angle} = this.state

    let newScale = scale * ratio
    if (newScale < minZoom) {
      if (scale === minZoom) {
        return
      }
      ratio = minZoom / scale
      newScale = minZoom
    }
    else if (newScale > maxZoom) {
      if (scale === maxZoom) {
        return
      }
      ratio = maxZoom / scale
      newScale = maxZoom
    }

    const newX = x - ratio * (x - transformX)
    const newY = y - ratio * (y - transformY)

    const {boundX, boundY} = this.getBoundCoordinates({x: newX, y: newY}, {angle, scale, offsetX: newX, offsetY: newY})
    this.prevPanPosition = {x: boundX, y: boundY}
    this.setState({x: boundX, y: boundY, scale: newScale})
  }

  centeredZoom = (delta: number, zoomSpeed?: number) => {
    const container = this.getContainer()
    const scaleMultiplier = getScaleMultiplier(delta, zoomSpeed || this.props.zoomSpeed)
    const containerRect = container.getBoundingClientRect()
    this.zoomTo(containerRect.width / 2, containerRect.height / 2, scaleMultiplier)
  }

  zoomIn = (zoomSpeed?: number) => {
    this.centeredZoom(-1, zoomSpeed)
  }

  zoomOut = (zoomSpeed?: number) => {
    this.centeredZoom(1, zoomSpeed)
  }

  reset = () => {
    this.setState({x: 0, y: 0, scale: 1, angle: 0})
  }

  getContainerBoundingRect = (): ClientRect => {
    return this.getContainer().getBoundingClientRect()
  }

  getOffset = (e: MouseEvent<any> | Touch): Coordinates => {
    const containerRect = this.getContainerBoundingRect()
    const offsetX = e.clientX - containerRect.left
    const offsetY = e.clientY - containerRect.top
    return {x: offsetX, y: offsetY}
  }

  getTransformMatrix = (
    x: number,
    y: number,
    scale: number,
    angle: number
  ): TransformationMatrix => {
    if (!this.dragContainer.current) {
      return {a: scale, b: 0, c: 0, d: scale, x, y}
    }

    const {clientWidth, clientHeight} = this.getDragContainer()
    const centerX = clientWidth / 2
    const centerY = clientHeight / 2

    return TransformMatrix({angle, scale, offsetX: x, offsetY: y}, {x: centerX, y: centerY})
  }

  // Apply transform through rAF
  applyTransform = () => {
    this.getDragContainer().style.transform = this.transformMatrixString
    this.frameAnimation = 0
  }

  // Apply intermediate transform through rAF
  applyIntermediateTransform = () => {
    this.getDragContainer().style.transform = this.intermediateTransformMatrixString
    this.intermediateFrameAnimation = 0
  }

  getBoundCoordinates = (
    coordinates: Coordinates,
    transformationParameters: TransformationParameters
  ): BoundCoordinates => {
    const {x, y} = coordinates
    const {enableBoundingBox, boundaryRatioVertical, boundaryRatioHorizontal} = this.props
    const {offsetX = 0, offsetY = 0} = transformationParameters

    if (!enableBoundingBox) {
      return {
        boundX: x,
        boundY: y,
        offsetX: x,
        offsetY: y,
      }
    }

    const {height: containerHeight, width: containerWidth} = this.getContainerBoundingRect()
    const {clientTop, clientLeft, clientWidth, clientHeight} = this.getDragContainer()
    const clientBoundingBox = {top: clientTop, left: clientLeft, width: clientWidth, height: clientHeight}

    return boundCoordinates(x, y,
      {vertical: boundaryRatioVertical, horizontal: boundaryRatioHorizontal},
      getTransformedBoundingBox(transformationParameters, clientBoundingBox),
      containerHeight, containerWidth,
      offsetX, offsetY,
    )
  }

  override render() {
    const {
      children,
      autoCenter,
      autoCenterZoomLevel,
      zoomSpeed,
      doubleZoomSpeed,
      disabled,
      disableDoubleClickZoom,
      disableScrollZoom,
      disableKeyInteraction,
      realPinch,
      keyMapping,
      minZoom,
      maxZoom,
      enableBoundingBox,
      boundaryRatioVertical,
      boundaryRatioHorizontal,
      noStateUpdate,
      onPanStart,
      onPan,
      onPanEnd,
      preventPan,
      style,
      onDoubleClick,
      onMouseDown,
      onKeyDown,
      onKeyUp,
      onTouchStart,
      onStateChange,
      ...restPassThroughProps
    } = this.props
    const {x, y, scale, angle} = this.state
    const transform = getTransformMatrixString(this.getTransformMatrix(x, y, scale, angle))

    if (process.env['NODE_ENV'] !== 'production') {
      warning(
        onDoubleClick === undefined || typeof onDoubleClick === 'function',
        'Expected `onDoubleClick` listener to be a function, instead got a value of `%s` type.',
        typeof onDoubleClick,
      )
      warning(
        onMouseDown === undefined || typeof onMouseDown === 'function',
        'Expected `onMouseDown` listener to be a function, instead got a value of `%s` type.',
        typeof onMouseDown,
      )
      warning(
        onKeyDown === undefined || typeof onKeyDown === 'function',
        'Expected `onKeyDown` listener to be a function, instead got a value of `%s` type.',
        typeof onKeyDown,
      )
      warning(
        onKeyUp === undefined || typeof onKeyUp === 'function',
        'Expected `onKeyUp` listener to be a function, instead got a value of `%s` type.',
        typeof onKeyUp,
      )
      warning(
        onTouchStart === undefined || typeof onTouchStart === 'function',
        'Expected `onTouchStart` listener to be a function, instead got a value of `%s` type.',
        typeof onTouchStart,
      )
    }

    return (
      <div
        ref={this.container}
        {
          ...(disableKeyInteraction ? {} : {
            tabIndex: 0, // enable onKeyDown event
          })
        }
        onDoubleClick={this.onDoubleClick}
        onMouseDown={this.onMouseDown}
        // React onWheel event listener is broken on Chrome 73
        // The default options for the wheel event listener has been defaulted to passive
        // but this behaviour breaks the zoom feature of PanZoom.
        // Until further research onWheel listener is replaced by
        // this.container.addEventListener('mousewheel', this.onWheel, { passive: false })
        // see Chrome motivations
        // https://developers.google.com/web/updates/2019/02/scrolling-intervention
        // onWheel={this.onWheel}
        onKeyDown={this.onKeyDown}
        onKeyUp={this.onKeyUp}
        onTouchStart={this.onTouchStart}
        style={{cursor: disabled ? 'initial' : 'pointer', ...style}}
        {...restPassThroughProps}
      >
        <div
          ref={this.dragContainer}
          style={{
            display: 'inline-block',
            transformOrigin: '0 0 0',
            transform,
            transition: 'all 0.10s linear',
            willChange: 'transform',
          }}
        >
          {children}
        </div>
      </div>
    )
  }
}

export default ZoomablePanningComponent
