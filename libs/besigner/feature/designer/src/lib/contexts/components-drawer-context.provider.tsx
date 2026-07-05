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

import { type ElementType, Fragment, useCallback, useState } from 'react'
import { type CloseableDrawerProps } from '../components/closeable-drawer.component'
import ComponentPicker from '../components/component-picker'
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

export type ComponentPickerResolve<T> = (value: T | PromiseLike<T>) => void
export type ComponentPickerReject = (reason?: unknown) => void

export function ComponentsDrawerContextProvider(
  props: ComponentsDrawerContextProviderProps,
) {
  const { children, defaultOptions = {} } = props
  const [options, setOptions] = useState(() => ({
    ...DEFAULT_OPTIONS,
    ...defaultOptions,
  }))

  const [[resolve, reject], setCallbacks] = useState<
    [resolve?: any, reject?: any]
  >([])
  const open = Boolean(resolve)

  const handleResolve = useCallback(
    (e, item) => {
      try {
        resolve(item)
      } catch (e) {
        console.error(e)
      } finally {
        setCallbacks([])
      }
    },
    [resolve],
  )

  const handleReject = useCallback(
    (e, reason: string) => {
      try {
        reject(reason || 'canceled')
      } catch (e) {
        console.error(e)
      } finally {
        setCallbacks([])
      }
    },
    [reject],
  )

  const elementDrawer = useCallback(
    (opts?: ElementDrawerOptions) => {
      setOptions(buildOptions(defaultOptions, opts))
      return new Promise((resolve, reject) => {
        setCallbacks([resolve, reject])
      })
    },
    [defaultOptions],
  )

  return (
    <Fragment>
      <ElementDrawerContext.Provider value={{ elementDrawer }}>
        {children}
      </ElementDrawerContext.Provider>
      <ComponentPicker
        open={open}
        onClose={handleReject}
        onSelectItem={handleResolve}
      />
    </Fragment>
  )
}
ComponentsDrawerContextProvider.displayName = 'ComponentsDrawerContextProvider'
ComponentsDrawerContextProvider.aglyn = true

export default ComponentsDrawerContextProvider
