/**
 * @license
 * Copyright 2026 Aglyn LLC
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

import { createContext } from 'react'

/**
 * Nodes the canvas is showing despite the hidden class (AGL-592).
 *
 * Read from the `revealedNodeIds` flag once, at the top of the canvas, and
 * carried down by context: every leaf needs the answer, and a subscription
 * per leaf would put one on every element on the page. Undefined outside the
 * canvas, where nothing has been revealed.
 */
export const CanvasRevealContext = createContext<readonly string[] | undefined>(
  undefined,
)
CanvasRevealContext.displayName = 'CanvasRevealContext'

/**
 * Classes the canvas is rendering without (AGL-2486). Read from the
 * `mutedClasses` flag once, at the top of the canvas, for the same reason
 * the reveal list is: every leaf needs the answer.
 */
export const CanvasMutedClassesContext = createContext<
  readonly string[] | undefined
>(undefined)
CanvasMutedClassesContext.displayName = 'CanvasMutedClassesContext'

export default CanvasRevealContext
