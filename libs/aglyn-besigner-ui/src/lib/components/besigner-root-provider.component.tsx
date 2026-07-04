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

import type {
  AppUUN,
  CanvasSetElementsPayload,
} from '@aglyn/aglyn'
import {
  AglynAppProvider,
  ElementComponentsContextProvider,
  ElementsContextProvider,
} from '@aglyn/aglyn-node-renderer'
import { getDisplayName } from '@aglyn/shared-util-tools'
import { hoistNonReactStatics } from '@aglyn/shared-util-vendor'
import { NoSsr } from '@mui/material'
import { type ComponentType, Fragment } from 'react'
import ComponentsDrawerContextProvider from '../contexts/components-drawer-context.provider'
import RenderedCanvasElementsProvider from '../contexts/rendered-canvas-elements'
import BesignerDndContext from './besigner-dnd-context.component'

export interface BesignerComponentProps {
  noSsr?: boolean
  appName?: AppUUN
  canvasElements?: CanvasSetElementsPayload
  children?: JSX.Children
}

export const withBesignerContext = <P,>(Component: ComponentType<P>) => {
  const displayName = getDisplayName(Component)
  const WithBesignerContext = (props: BesignerComponentProps & P) => {
    const { noSsr, appName, canvasElements, ...rest } = props
    return (
      <BesignerRootProviderComponent>
        <Component {...(rest as P)} />
      </BesignerRootProviderComponent>
    )
  }
  WithBesignerContext.displayName = `WithBesignerComponent(${displayName})`
  hoistNonReactStatics(WithBesignerContext, Component)
  return WithBesignerContext
}

export const BesignerRootProviderComponent = (
  props: BesignerComponentProps,
) => {
  /*forwardRef<any, BesignerComponentProps>(
 (props, ref) => {*/
  const { noSsr, appName, canvasElements, children } = props
  const Wrapper = noSsr ? NoSsr : Fragment

  return (
    <Wrapper>
      <AglynAppProvider canvasElements={canvasElements} appName={appName}>
        <BesignerDndContext>
          <ElementComponentsContextProvider>
            <ElementsContextProvider>
              <RenderedCanvasElementsProvider>
                <ComponentsDrawerContextProvider>
                  {children}
                </ComponentsDrawerContextProvider>
              </RenderedCanvasElementsProvider>
            </ElementsContextProvider>
          </ElementComponentsContextProvider>
        </BesignerDndContext>
      </AglynAppProvider>
    </Wrapper>
  )
}

BesignerRootProviderComponent.displayName = 'BesignerRootProviderComponent'
BesignerRootProviderComponent.aglyn = true

export default BesignerRootProviderComponent
