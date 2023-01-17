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

import { AglynComponentsContext } from '@aglyn/core-feature-renderer'
import { type ElementType, Fragment, useCallback, useState } from 'react'
import {
  CloseableDrawerComponent,
  type CloseableDrawerProps,
} from '../components/closeable-drawer.component'
import ComponentsGridListComponent from '../components/components-grid-list.component'
import {
  buildOptions,
  DEFAULT_OPTIONS,
  ElementDrawerContext,
  type ElementDrawerOptions,
} from './element-drawer-context'

export interface ComponentsDrawerContextProviderProps
  extends Partial<CloseableDrawerProps> {
  defaultOptions?: ElementDrawerOptions
  children?: JSX.Children
  component?: ElementType<CloseableDrawerProps>
}

function ComponentsDrawerContextProvider(
  props: ComponentsDrawerContextProviderProps,
) {
  const { children, defaultOptions, component, ...rest } = props
  const Component = component || CloseableDrawerComponent
  const [options, setOptions] = useState(() => ({
    ...DEFAULT_OPTIONS,
    ...defaultOptions,
  }))
  const [resolveReject, setResolveReject] = useState([])
  const [resolve, reject] = resolveReject
  const isOpen = resolveReject.length === 2

  const handleClose = useCallback(
    (e, reason) => {
      reject && reject({ reason })
      setResolveReject([])
    },
    [reject],
  )
  const handleOnActionClick = useCallback(
    (e, item) => {
      resolve && resolve({ option: item })
      setResolveReject([])
    },
    [resolve],
  )

  const elementDrawer = useCallback(
    (options: ElementDrawerOptions = {}) => {
      return new Promise((resolve, reject) => {
        setOptions(buildOptions(defaultOptions, options))
        setResolveReject([resolve, reject])
      })
    },
    [defaultOptions],
  )

  return (
    <Fragment>
      <ElementDrawerContext.Provider value={{ elementDrawer }}>
        {children}
      </ElementDrawerContext.Provider>
      <AglynComponentsContext.Consumer>
        {({ nodePresets }) => (
          <Component
            open={isOpen}
            onClose={handleClose}
            action={'Close'}
            onActionClick={handleClose}
            drawerTitle={options?.title}
            {...rest}
          >
            <ComponentsGridListComponent
              onActionClick={handleOnActionClick}
              items={nodePresets}
            />
          </Component>
        )}
      </AglynComponentsContext.Consumer>
    </Fragment>
  )
}
ComponentsDrawerContextProvider.displayName = 'ComponentsDrawerContextProvider'
ComponentsDrawerContextProvider.aglyn = true
ComponentsDrawerContextProvider.defaultProps = {
  defaultOptions: {},
}

export { ComponentsDrawerContextProvider }
export default ComponentsDrawerContextProvider
