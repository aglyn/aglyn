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

import * as Aglyn from '@aglyn/aglyn'
import { observer } from 'mobx-react-lite'
import { type MutableRefObject } from 'react'
import RendererComponents from '../contexts/renderer-components'
import type { StemProps } from './stem'

export interface TrunkProps {
  node: Aglyn.NodeSchema<any>
}

function TrunkRaw(props: TrunkProps, ref: MutableRefObject<any>) {
  const { node } = props

  return (
    <RendererComponents.Consumer key={node?.$id}>
      {({ StemComponent }) => <StemComponent ref={ref} node={node} />}
    </RendererComponents.Consumer>
  )
}
TrunkRaw.displayName = 'Trunk'
TrunkRaw.aglyn = true

export const Trunk = observer<StemProps, any>(TrunkRaw, { forwardRef: true })
export default Trunk
