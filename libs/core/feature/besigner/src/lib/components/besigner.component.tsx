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

import {AppUUN} from '@aglyn/core-data-framework'
import {
  AglynAppContextComponent,
  ElementComponentsContextProvider,
  ElementsContextProvider,
} from '@aglyn/core-feature-renderer'
import {consoleThemeDark, consoleThemeLight, withTheme} from '@aglyn/shared-feature-themes'
import {ConfirmationProviderComponent} from '@aglyn/shared-ui-jsx'
import NoSsr from '@mui/material/NoSsr'
import {forwardRef, Fragment} from 'react'
import {ComponentsDrawerContextProvider} from '../contexts/components-drawer-context.provider'
import BesignerDndContext from './besigner-dnd-context.component'
import {WorkspaceEditorComponent, WorkspaceEditorComponentProps} from './workspace-editor.component'


export interface BesignerComponentProps extends WorkspaceEditorComponentProps {
  noSsr?: boolean
  appName?: AppUUN
}

const BesignerComponentRaw = forwardRef<any, BesignerComponentProps>(function RefRenderFn(
  props,
  ref,
) {
  const {noSsr, appName, ...rest} = props
  const Wrapper = noSsr ? NoSsr : Fragment


  return (
    <Wrapper>
      <AglynAppContextComponent appName={appName}>
        <BesignerDndContext>
          <ElementComponentsContextProvider>
            <ElementsContextProvider>
              <ConfirmationProviderComponent>
                <ComponentsDrawerContextProvider>
                  {/*<SnackbarProvider maxSnack={3}>*/}
                  <WorkspaceEditorComponent ref={ref} {...rest} />
                  {/*</SnackbarProvider>*/}
                </ComponentsDrawerContextProvider>
              </ConfirmationProviderComponent>
            </ElementsContextProvider>
          </ElementComponentsContextProvider>
        </BesignerDndContext>
      </AglynAppContextComponent>
    </Wrapper>
  )
})

BesignerComponentRaw.displayName = 'BesignerComponent'
BesignerComponentRaw.defaultProps = {}

export const BesignerComponent = withTheme({
  theme: [consoleThemeLight, consoleThemeDark],
})(BesignerComponentRaw)
export default BesignerComponent
