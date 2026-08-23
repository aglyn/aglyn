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
 * Optional transform applied to the fully merged sx of every rendered
 * Leaf (caller sx + node props.sx + node-level sx) just before it
 * reaches the element (AGL-581). The besigner canvas provides it while
 * an artboard device preview is active, re-targeting viewport media
 * queries (visibility bands, custom width queries) at the simulated
 * device width. Production tenant rendering never mounts the provider,
 * so published sites keep real media-query behavior untouched.
 *
 * `nodeId` (AGL-2486) lets a transform apply to ONE node rather than the
 * whole canvas — the interaction-state hold renders only the SELECTED
 * element as if hovered/pressed/focused, and every other leaf must keep
 * rendering its resting state. Optional and ignored by the device-width
 * transform, which is canvas-wide.
 */
export type LeafSxTransform = (sx: unknown, nodeId?: string) => unknown

export const LeafSxTransformContext = createContext<
  LeafSxTransform | undefined
>(undefined)
LeafSxTransformContext.displayName = 'LeafSxTransformContext'

export default LeafSxTransformContext
