/**
 * @license
 * Copyright 2024 Aglyn LLC
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
'use client'

import {
  type ElementType,
  Fragment,
  type MouseEventHandler,
  useCallback,
  useMemo,
  useState,
} from 'react'
import ConfirmationContext, {
  buildConfirmationContextConfig,
  type ConfirmationContextConfig,
  type ConfirmFunction,
  DEFAULT_CONTEXT_CONFIG,
} from '../contexts/confirmation.context'
import DialogConfirm from './dialog-confirm'

export interface ConfirmationProviderComponentProps {
  defaultOptions?: ConfirmationContextConfig
  children?: JSX.Children
  component?: ElementType<{
    open: boolean
    options: ConfirmationContextConfig
    onClose: MouseEventHandler<unknown>
    onCancel: MouseEventHandler<unknown>
    onConfirm: MouseEventHandler<unknown>
  }>
}

export function ConfirmationProviderComponent(
  props: ConfirmationProviderComponentProps,
) {
  const {
    children,
    defaultOptions = {},
    component: Component = DialogConfirm,
  } = props
  const [options, setOptions] = useState({
    ...DEFAULT_CONTEXT_CONFIG,
    ...defaultOptions,
  })
  const [resolveReject, setResolveReject] = useState([])
  const [resolve, reject] = resolveReject

  const confirm = useCallback<ConfirmFunction>(
    (options: ConfirmationContextConfig = {}) => {
      return new Promise((resolve, reject) => {
        setOptions(buildConfirmationContextConfig(defaultOptions, options))
        setResolveReject([resolve, reject])
      })
    },
    [defaultOptions],
  )

  const handleClose = useCallback(() => {
    setResolveReject([])
  }, [])

  // The first answer settles the promise and clears the pair, but the dialog
  // stays on screen through its exit transition. A second click in that
  // window (a double click, a repeated Enter) has no question left to answer,
  // so it must not call the cleared resolve or reject.
  const handleCancel = useCallback(() => {
    if (!reject) return
    reject()
    handleClose()
  }, [reject, handleClose])

  const handleConfirm = useCallback(() => {
    if (!resolve) return
    resolve()
    handleClose()
  }, [resolve, handleClose])

  const child = useMemo(() => {
    return (
      <ConfirmationContext.Provider value={{ confirm }}>
        {children}
      </ConfirmationContext.Provider>
    )
  }, [children, confirm])

  return (
    <Fragment>
      {child}
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
ConfirmationProviderComponent.aglyn = true

export default ConfirmationProviderComponent
