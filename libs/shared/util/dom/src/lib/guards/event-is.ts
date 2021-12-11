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
import { getNodeWindow, isNodeShadowRoot } from '@aglyn/shared-util-dom'


export function eventHasViewportRelativeCoordinates(
  event: Event,
): event is Event & Pick<PointerEvent, 'clientX' | 'clientY'> {
  return 'clientX' in event && 'clientY' in event
}

export function isEventKeyboardEvent(
  event: Event | undefined | null,
): event is KeyboardEvent {
  if (!event) {
    return false
  }

  const {KeyboardEvent} = getNodeWindow(event.target)

  return KeyboardEvent && event instanceof KeyboardEvent
}


export function isEventTouchEvent(
  event: Event | undefined | null,
): event is TouchEvent {
  if (!event) {
    return false
  }

  const {TouchEvent} = getNodeWindow(event.target)

  return TouchEvent && event instanceof TouchEvent
}

export function parentElementContainsChildElement(parent: Element, child: Element) {
  const rootNode = child.getRootNode && child.getRootNode()

  // First, attempt with faster native method
  if (parent.contains(child)) {
    return true
  }
  // then fallback to custom implementation with Shadow DOM support
  else if (rootNode && isNodeShadowRoot(rootNode)) {
    let next = child
    do {
      if (next && parent.isSameNode(next)) {
        return true
      }
      // $FlowFixMe[prop-missing]: need a better way to handle this...
      next = next.parentNode || next['host']
    } while (next)
  }

  // Give up, the result is false
  return false
}
