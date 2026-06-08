/**
 * @license
 * Copyright 2024 Aglyn LLC
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
import { Fragment } from 'react'
import RendererComponents from '../contexts/renderer-components'

export interface BranchProps {
  node: Aglyn.NodeSchema<any>
}

// Branch renders a Fragment — no single DOM root to attach a ref to,
// so forwardRef is intentionally omitted here.
export const Branch = observer((props: BranchProps) => {
  const { node } = props
  const nodes = node?.children ?? []
  return (
    <RendererComponents.Consumer>
      {({ StemComponent }) => (
        <Fragment>
          {nodes.map((child, key) => (
            <StemComponent key={child?.$id ?? key} node={child} />
          ))}
        </Fragment>
      )}
    </RendererComponents.Consumer>
  )
})
Branch.displayName = 'Branch'
Branch['aglyn'] = true

export default Branch
