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

import { createContext, type RefAttributes } from 'react'
import type { BranchProps } from '../components/branch'
import type { LeafProps } from '../components/leaf'
import type { StemProps } from '../components/stem'
import type { TrunkProps } from '../components/trunk'

export interface RenderComponentsContext {
  TrunkComponent: JSX.ForwardRefExoticComponent<TrunkProps & RefAttributes<any>>
  StemComponent: JSX.ForwardRefExoticComponent<StemProps & RefAttributes<any>>
  BranchComponent: JSX.FunctionComponent<BranchProps>
  LeafComponent: JSX.ForwardRefExoticComponent<LeafProps & RefAttributes<any>>
}
export const RendererComponents = createContext<RenderComponentsContext>({
  TrunkComponent: null,
  StemComponent: null,
  BranchComponent: null,
  LeafComponent: null,
})
RendererComponents.displayName = 'RendererComponents'
RendererComponents['aglyn'] = true

export default RendererComponents
