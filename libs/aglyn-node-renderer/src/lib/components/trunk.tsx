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

import * as Aglyn from '@aglyn/aglyn'
import { observer } from 'mobx-react-lite'
import { forwardRef } from 'react'
import RendererComponents from '../contexts/renderer-components'

export interface TrunkProps {
  node: Aglyn.NodeSchema<any>
}

export const Trunk = observer(
  forwardRef<any, TrunkProps>((props, ref) => {
    const { node } = props

    return (
      <RendererComponents.Consumer>
        {({ StemComponent }) => <StemComponent ref={ref} node={node} />}
      </RendererComponents.Consumer>
    )
  }),
)
Trunk.displayName = 'Trunk'
Trunk['aglyn'] = true

export default Trunk
