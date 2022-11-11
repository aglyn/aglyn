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
import { Fragment } from 'react'
import Stem from './stem'

export interface BranchProps {
  node: Aglyn.NodeSchema<any>
}

function RawBranch(props: BranchProps) {
  const { node } = props
  return (
    <Fragment key={node?.$id}>
      {node?.nodes?.map((nodeId) => (
        <Stem key={nodeId} nodeId={nodeId} />
      ))}
    </Fragment>
  )
}
RawBranch.displayName = 'Branch'
RawBranch.aglyn = true

const Branch = observer<BranchProps, any>(RawBranch, { forwardRef: true })

export { Branch }
export default Branch
