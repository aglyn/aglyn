/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import {
  buildOptions,
  DEFAULT_OPTIONS,
  SelectionContext,
  SelectionOptions,
} from './selection.context'
import { ElementType, Fragment, MouseEventHandler, ReactNode, useCallback, useState } from 'react'
import SelectionComponent from '../components/selection.component'

export interface SelectionProviderComponentProps {
  defaultOptions?: SelectionOptions
  children?: ReactNode
  component: ElementType<{
    open: boolean
    options: SelectionOptions
    onClose: MouseEventHandler<unknown>
    onCancel: MouseEventHandler<unknown>
    onConfirm: MouseEventHandler<unknown>
  }>
}

function SelectionProviderComponent(props: SelectionProviderComponentProps) {
  const { children, defaultOptions = {}, component: Component } = props
  const [options, setOptions] = useState({ ...DEFAULT_OPTIONS, ...defaultOptions })
  const [resolveReject, setResolveReject] = useState([])
  const [resolve, reject] = resolveReject

  const select = useCallback(
    (options: SelectionOptions = {}) => {
      return new Promise((resolve, reject) => {
        setOptions(buildOptions(defaultOptions, options))
        setResolveReject([resolve, reject])
      })
    },
    [defaultOptions]
  )

  const handleClose = useCallback(() => {
    setResolveReject([])
  }, [])

  const handleCancel = useCallback(() => {
    reject()
    handleClose()
  }, [reject, handleClose])

  const handleConfirm = useCallback(() => {
    resolve()
    handleClose()
  }, [resolve, handleClose])

  return (
    <Fragment>
      <SelectionContext.Provider value={{ select }}>{children}</SelectionContext.Provider>
      <Component
        open={resolveReject.length === 2}
        options={options}
        onClose={handleClose}
        onCancel={handleCancel}
        onConfirm={handleConfirm}
      />
    </Fragment>
  )
}

SelectionProviderComponent.defaultProps = {
  component: SelectionComponent,
}
export default SelectionProviderComponent
