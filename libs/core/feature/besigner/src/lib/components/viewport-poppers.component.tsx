/**
 * @license
 * Copyright 2021 Aglyn LLC
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

import NoSsr from '@mui/material/NoSsr'
import { memo } from 'react'
import { CanvasRenderedElementRefsConsumer } from '../contexts/canvas-rendered-element-refs'
import { useAglynBesignerStoreState } from '../hooks/use-aglyn-besigner-store-state'
import { ElementPopperComponent } from './element-popper.component'


export interface ViewportPoppersComponentProps {

}

function ViewportPoppersComponentRaw(props: ViewportPoppersComponentProps) {
  const selected = useAglynBesignerStoreState('canvas', 'selected')
  const hovered = useAglynBesignerStoreState('canvas', 'hovered')

  return (
    <NoSsr defer>
      <CanvasRenderedElementRefsConsumer>
        {({getElementRef}) => (
          <>
            <ElementPopperComponent
              key="hovered"
              variant="hovered"
              onGetElementRef={getElementRef}
              $id={hovered?.$id}
            />
            <ElementPopperComponent
              key="selected"
              variant="selected"
              onGetElementRef={getElementRef}
              $id={selected?.$id}
              badgeable
            />
          </>
        )}
      </CanvasRenderedElementRefsConsumer>
    </NoSsr>
  )
}

ViewportPoppersComponentRaw.displayName = 'ViewportPoppersComponent'

export const ViewportPoppersComponent = memo(ViewportPoppersComponentRaw)
export default ViewportPoppersComponent
