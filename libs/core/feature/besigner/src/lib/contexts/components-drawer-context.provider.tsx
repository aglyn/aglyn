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

import { AglynComponentsContext } from '@aglyn/core-feature-renderer'
import { ElementType, Fragment, ReactNode, useCallback, useMemo, useState } from 'react'
import {
  ComponentsDrawerComponent,
  ComponentsDrawerComponentProps,
} from '../components/components-drawer.component'
import {
  buildOptions,
  DEFAULT_OPTIONS,
  ElementDrawerContext,
  ElementDrawerOptions,
} from './element-drawer-context'

export interface ComponentsDrawerContextProviderProps
  extends Partial<ComponentsDrawerComponentProps> {
  defaultOptions?: ElementDrawerOptions
  children?: ReactNode
  component?: ElementType<ComponentsDrawerComponentProps>
}

function ComponentsDrawerContextProvider(props: ComponentsDrawerContextProviderProps) {
  const { children, defaultOptions, component, ...rest } = props
  const Component = component || ComponentsDrawerComponent
  const [options, setOptions] = useState(() => ({ ...DEFAULT_OPTIONS, ...defaultOptions }))
  const [resolveReject, setResolveReject] = useState([])
  const [resolve, reject] = resolveReject
  const isOpen = useMemo(() => resolveReject.length === 2, [resolveReject])

  const handleClose = useCallback((e, reason) => {
    setResolveReject([])
  }, [])
  const handleCancel = useCallback(
    (e, reason) => {
      reject({ reason })
      handleClose(e, reason)
    },
    [reject, handleClose]
  )
  const handleConfirm = useCallback(
    (e, item) => {
      resolve({ option: item })
      handleClose(e, 'resolved')
    },
    [resolve, handleClose, resolveReject]
  )

  const elementDrawer = useCallback(
    (options: ElementDrawerOptions = {}) => {
      return new Promise((resolve, reject) => {
        setOptions(buildOptions(defaultOptions, options))
        setResolveReject([resolve, reject])
      })
    },
    [defaultOptions]
  )

  const context = useMemo(() => ({ elementDrawer }), [elementDrawer])

  return (
    <Fragment>
      <ElementDrawerContext.Provider value={context}>{children}</ElementDrawerContext.Provider>
      <AglynComponentsContext.Consumer>
        {({ templateBlocks }) => (
          <Component
            open={isOpen}
            options={options}
            onClose={handleClose}
            onCancel={handleCancel}
            onConfirm={handleConfirm}
            items={templateBlocks}
            {...rest}
          />
        )}
      </AglynComponentsContext.Consumer>
    </Fragment>
  )
}
ComponentsDrawerContextProvider.displayName = 'ComponentsDrawerContextProvider'
ComponentsDrawerContextProvider.defaultProps = {
  defaultOptions: {},
}

export { ComponentsDrawerContextProvider }
export default ComponentsDrawerContextProvider
