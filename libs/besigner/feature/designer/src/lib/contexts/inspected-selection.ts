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

import * as Besigner from '@aglyn/besigner'
import type { BesignerInspected } from './inspector-extras-context'

/**
 * What the Attributes panel tells a host section about the selection
 * (AGL-2908).
 *
 * `editable` is the drag manager's rule, which is the rule the panel already
 * draws its own in-place actions under — Save as reusable component, Detach
 * from component: the canvas root fails it, and so does a node whose schema
 * forbids dragging, which is how locked layout chrome reaches the panel.
 *
 * It is computed here rather than in the section because a section is handed
 * a node and nothing else. Working the rule out for itself would mean
 * importing the editor into a host app or a plugin, which is exactly what
 * the zone exists to avoid, and would leave two answers to one question.
 */
export function besignerInspected(
  node: BesignerInspected['node'] | null | undefined,
): BesignerInspected | null {
  if (!node) return null
  return { node, editable: Besigner.dnd.canDragNode(node) }
}
