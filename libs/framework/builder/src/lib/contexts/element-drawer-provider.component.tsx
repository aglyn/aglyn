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

import ElementDrawerContext, {
  buildOptions,
  DEFAULT_OPTIONS,
  ElementDrawerOptions,
} from './element-drawer.context'
import {
  ElementType,
  Fragment,
  MouseEvent,
  MouseEventHandler,
  ReactNode,
  useCallback,
  useState,
} from 'react'
import ElementDrawerComponent from '../components/element-drawer.component'

export interface ElementDrawerProviderComponentProps {
  defaultOptions?: ElementDrawerOptions
  children?: ReactNode
  component: ElementType<{
    open: boolean
    options: ElementDrawerOptions
    onClose: {
      bivarianceHack<T>(
        event: MouseEvent<T>,
        reason: 'backdropClick' | 'escapeKeyDown' | 'closeButton' | 'resolved'
      ): void
    }['bivarianceHack']
    onCancel: {
      bivarianceHack<T>(
        event: MouseEvent<T>,
        reason: 'backdropClick' | 'escapeKeyDown' | 'closeButton'
      ): void
    }['bivarianceHack']
    onConfirm: {
      bivarianceHack<T>(event: MouseEvent<T>, selection: unknown): void
    }['bivarianceHack']
  }>
}

function ElementDrawerProviderComponent(props: ElementDrawerProviderComponentProps) {
  const { children, defaultOptions = {}, component: Component } = props
  const [options, setOptions] = useState({ ...DEFAULT_OPTIONS, ...defaultOptions })
  const [resolveReject, setResolveReject] = useState([])
  const [resolve, reject] = resolveReject
  const open = Boolean(resolveReject.length === 2)

  const elementDrawer = useCallback(
    (options: ElementDrawerOptions = {}) => {
      return new Promise((resolve, reject) => {
        setOptions(buildOptions(defaultOptions, options))
        setResolveReject([resolve, reject])
      })
    },
    [defaultOptions]
  )

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

  return (
    <Fragment>
      <ElementDrawerContext.Provider value={{ elementDrawer }}>
        {children}
      </ElementDrawerContext.Provider>
      <Component
        open={open}
        options={options}
        onClose={handleClose}
        onCancel={handleCancel}
        onConfirm={handleConfirm}
      />
    </Fragment>
  )
}

ElementDrawerProviderComponent.defaultProps = {
  component: ElementDrawerComponent,
}
export default ElementDrawerProviderComponent
