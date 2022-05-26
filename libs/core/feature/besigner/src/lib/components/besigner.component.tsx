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

import type {AppUUN, CanvasSetElementsPayload} from '@aglyn/core-data-framework'
import {
  AglynAppProvider,
  ElementComponentsContextProvider,
  ElementsContextProvider,
} from '@aglyn/core-feature-renderer'
import {LOADING_OVERLAY_ELEMENT} from '@aglyn/shared-ui-jsx'
import {NoSsr} from '@mui/material'
import dynamic from 'next/dynamic'
import {forwardRef, Fragment} from 'react'
import ComponentsDrawerContextProvider from '../contexts/components-drawer-context.provider'
import RenderedCanvasElementsProvider from '../contexts/rendered-canvas-elements'
import BesignerDndContext from './besigner-dnd-context.component'
import type {WorkspaceEditorComponentProps} from './workspace-editor.component'


const WorkspaceEditorComponent = dynamic<WorkspaceEditorComponentProps>(
  () => import('./workspace-editor.component').then((mod) => mod.WorkspaceEditorComponent),
  {ssr: false, loading: () => LOADING_OVERLAY_ELEMENT},
)

export interface BesignerComponentProps extends WorkspaceEditorComponentProps {
  noSsr?: boolean
  appName?: AppUUN
  canvasElements?: CanvasSetElementsPayload
}

const BesignerComponent = forwardRef<any, BesignerComponentProps>(
  function RefRenderFn(props, ref) {
    const {
      noSsr,
      appName,
      canvasElements,
      ...rest
    } = props
    const Wrapper = noSsr ? NoSsr : Fragment

    return (
      <Wrapper>
        <AglynAppProvider
          canvasElements={canvasElements}
          appName={appName}
        >
          <BesignerDndContext>
            <ElementComponentsContextProvider>
              <ElementsContextProvider>
                <RenderedCanvasElementsProvider>
                  <ComponentsDrawerContextProvider>
                    <WorkspaceEditorComponent ref={ref} {...rest} />
                  </ComponentsDrawerContextProvider>
                </RenderedCanvasElementsProvider>
              </ElementsContextProvider>
            </ElementComponentsContextProvider>
          </BesignerDndContext>
        </AglynAppProvider>
      </Wrapper>
    )
  },
)

BesignerComponent.displayName = 'BesignerComponent'
BesignerComponent.aglyn = true
BesignerComponent.defaultProps = {}

export {BesignerComponent}
export default BesignerComponent
