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


import type { Coordinates } from '../types'
import { eventHasViewportRelativeCoordinates, isEventTouchEvent } from './guards/event-is'


/**
 * Returns the normalized x and y coordinates for mouse and touch events.
 */
export function getEventCoordinates(event: Event): Coordinates {
  if (isEventTouchEvent(event)) {
    if (event.touches && event.touches.length) {
      const {clientX: x, clientY: y} = event.touches[0]

      return {
        x,
        y,
      }
    }
    else if (event.changedTouches && event.changedTouches.length) {
      const {clientX: x, clientY: y} = event.changedTouches[0]

      return {
        x,
        y,
      }
    }
  }

  if (eventHasViewportRelativeCoordinates(event)) {
    return {
      x: event.clientX,
      y: event.clientY,
    }
  }

  return {
    x: 0,
    y: 0,
  }
}
export default getEventCoordinates
