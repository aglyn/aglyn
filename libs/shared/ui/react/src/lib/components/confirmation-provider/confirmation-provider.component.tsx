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

import { ElementType, Fragment, MouseEventHandler, ReactNode, useCallback, useState } from 'react'
import DialogConfirm from '../dialog-confirm/dialog-confirm'
import { ConfirmationContext, ConfirmationOptions } from '../../contexts/confirmation.context'
import { DEFAULT_OPTIONS, buildOptions } from '../../contexts/confirmation.context'


export interface ConfirmationProviderComponentProps {
  defaultOptions?: ConfirmationOptions
  children?: ReactNode
  component: ElementType<{
    open: boolean
    options: ConfirmationOptions
    onClose: MouseEventHandler<unknown>
    onCancel: MouseEventHandler<unknown>
    onConfirm: MouseEventHandler<unknown>
  }>
}

export function ConfirmationProviderComponent(props: ConfirmationProviderComponentProps) {
  const { children, defaultOptions = {}, component: Component } = props
  const [options, setOptions] = useState({ ...DEFAULT_OPTIONS, ...defaultOptions })
  const [resolveReject, setResolveReject] = useState([])
  const [resolve, reject] = resolveReject

  const confirm = useCallback((options: ConfirmationOptions = {}) => {
    return new Promise((resolve, reject) => {
      setOptions(buildOptions(defaultOptions, options))
      setResolveReject([resolve, reject])
    })
  }, [defaultOptions])

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
      <ConfirmationContext.Provider value={{ confirm }}>
        {children}
      </ConfirmationContext.Provider>
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
ConfirmationProviderComponent.displayName = 'ConfirmationProviderComponent'
ConfirmationProviderComponent.defaultProps = {
  component: DialogConfirm,
}
export default ConfirmationProviderComponent
