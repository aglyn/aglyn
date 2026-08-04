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

import type * as Aglyn from '@aglyn/aglyn'
import { createContext } from 'react'

/**
 * Host-app callbacks for reusable-component flows (AGL-35). The designer
 * stays storage-agnostic: the console provides `onPromote` ("Save as
 * reusable component" on a selected subtree) and `onDemote` ("Detach" an
 * instance into an editable copy); the Attributes panel shows the actions
 * only when the callbacks exist.
 */
export interface ComponentPromotionContextValue {
  onPromote?: (node: Aglyn.NodeSchema<any>) => void
  onDemote?: (node: Aglyn.NodeSchema<any>) => void
  /**
   * Props each definition declares, keyed by definition id (AGL-1247), so
   * the Attributes panel can offer a selected instance one field per prop.
   * The designer stays storage-agnostic: the console reads the definitions
   * and passes them down, exactly as it does the callbacks above.
   */
  declaredProps?: Record<string, Aglyn.ReusableComponentProp[] | undefined>
}

export const ComponentPromotionContext =
  createContext<ComponentPromotionContextValue>({})
ComponentPromotionContext.displayName = 'ComponentPromotionContext'

export default ComponentPromotionContext
