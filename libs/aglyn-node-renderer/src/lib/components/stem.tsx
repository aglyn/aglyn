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

// Type-only: this file names `Aglyn.NodeSchema` and nothing else, and a
// VALUE namespace import of the core barrel is opaque to a bundler — it
// cannot know which exports are read, so every module the barrel reaches
// is pinned into the published page's first load.
import type * as Aglyn from '@aglyn/aglyn'
// Deep import, NOT the barrel — see the note in `leaf.tsx`.
import { ErrorBoundaryComponent } from '@aglyn/shared-ui-jsx/components/error-boundary.component'
import { observer } from 'mobx-react-lite'
import { forwardRef } from 'react'
import RendererComponents from '../contexts/renderer-components'

export interface StemProps {
  node: Aglyn.NodeSchema<any>
}

export const Stem = observer(
  forwardRef<any, StemProps>((props, ref) => {
    const { node } = props

    if (!node) {
      console.error(`Error rendering`, node)
      return <div data-aglyn="stem:missing" />
    }

    return (
      <ErrorBoundaryComponent fallback={<div data-aglyn={`stem:error:${node.$id}`} />}>
        <RendererComponents.Consumer>
          {({ LeafComponent, BranchComponent }) => (
            <LeafComponent ref={ref} node={node}>
              <BranchComponent node={node} />
            </LeafComponent>
          )}
        </RendererComponents.Consumer>
      </ErrorBoundaryComponent>
    )
  }),
)
Stem.displayName = 'Stem'
Stem['aglyn'] = true

export default Stem
