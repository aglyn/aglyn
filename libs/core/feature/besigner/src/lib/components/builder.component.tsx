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

import { AppUUN } from '@aglyn/core-data-framework'
import {
  AglynAppContextComponent,
  ElementComponentsContextProvider,
  ElementsContextProvider,
} from '@aglyn/core-feature-renderer'
import { consoleThemeDark, consoleThemeLight, withTheme } from '@aglyn/shared-feature-themes'
import { ConfirmationProviderComponent } from '@aglyn/shared-ui-jsx'
import { DndContext } from '@dnd-kit/core'
import NoSsr from '@mui/material/NoSsr'
import { forwardRef, Fragment, useCallback } from 'react'
import { ComponentsDrawerContextProvider } from '../contexts/components-drawer-context.provider'
import { EditorComponent, EditorComponentProps } from './editor.component'

export interface BuilderComponentProps extends EditorComponentProps {
  noSsr?: boolean
  appName?: AppUUN
}

const BuilderComponentRaw = forwardRef<any, BuilderComponentProps>(function RefRenderFn(
  props,
  ref
) {
  const { noSsr, appName, ...rest } = props
  const Wrapper = noSsr ? NoSsr : Fragment

  const handleDragStart = useCallback((...args) => {
    console.log('drag start', ...args)
  }, [])
  const handleDragEnd = useCallback((...args) => {
    console.log('drag end', ...args)
  }, [])

  return (
    <Wrapper>
      <AglynAppContextComponent appName={appName}>
        <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <ElementComponentsContextProvider>
            <ElementsContextProvider>
              <ConfirmationProviderComponent>
                <ComponentsDrawerContextProvider>
                  {/*<SnackbarProvider maxSnack={3}>*/}
                  <EditorComponent ref={ref} {...rest} />
                  {/*</SnackbarProvider>*/}
                </ComponentsDrawerContextProvider>
              </ConfirmationProviderComponent>
            </ElementsContextProvider>
          </ElementComponentsContextProvider>
        </DndContext>
      </AglynAppContextComponent>
    </Wrapper>
  )
})

BuilderComponentRaw.displayName = 'BuilderComponent'
BuilderComponentRaw.defaultProps = {}

export const BuilderComponent = withTheme({
  theme: [consoleThemeLight, consoleThemeDark],
})(BuilderComponentRaw)
export default BuilderComponent
