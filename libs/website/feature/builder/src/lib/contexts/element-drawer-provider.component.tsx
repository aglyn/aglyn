/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
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
