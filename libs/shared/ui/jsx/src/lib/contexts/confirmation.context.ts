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

import { noop } from '@aglyn/shared-util-tools'
import type { ButtonProps, DialogProps } from '@mui/material'
import { type Context, createContext, useContext } from 'react'

export type ConfirmationContextConfig = {
  cancellationText?: JSX.Children
  confirmationText?: JSX.Children
  cancellationButtonProps?: Partial<ButtonProps>
  confirmationButtonProps?: Partial<ButtonProps>
  dialogProps?: Partial<DialogProps>
  title?: JSX.Children
  description?: JSX.Children
}
export type ConfirmFunctionOptions = ConfirmationContextConfig
export type ConfirmFunction = <T>(
  options?: ConfirmFunctionOptions,
) => Promise<T>
export type ConfirmationContextType = {
  confirm: ConfirmFunction
}
export type ConfirmationContext = Context<ConfirmationContextType>

export const DEFAULT_CONTEXT_VALUE: ConfirmationContextType = {
  confirm: noop as any,
}
export const DEFAULT_CONTEXT_CONFIG: ConfirmationContextConfig = {
  title: 'Are you sure?',
  description: '',
  confirmationText: 'OK',
  cancellationText: 'Cancel',
  dialogProps: {},
  confirmationButtonProps: {},
  cancellationButtonProps: {},
}

export const buildConfirmationContextConfig = (defaultConfig, config) => {
  const dialogProps = {
    ...(defaultConfig.dialogProps || DEFAULT_CONTEXT_CONFIG.dialogProps),
    ...(config.dialogProps || {}),
  }
  const confirmationButtonProps = {
    ...(defaultConfig.confirmationButtonProps ||
      DEFAULT_CONTEXT_CONFIG.confirmationButtonProps),
    ...(config.confirmationButtonProps || {}),
  }
  const cancellationButtonProps = {
    ...(defaultConfig.cancellationButtonProps ||
      DEFAULT_CONTEXT_CONFIG.cancellationButtonProps),
    ...(config.cancellationButtonProps || {}),
  }

  return {
    ...DEFAULT_CONTEXT_CONFIG,
    ...defaultConfig,
    ...config,
    dialogProps,
    confirmationButtonProps,
    cancellationButtonProps,
  }
}

export const ConfirmationContext: ConfirmationContext =
  createContext<ConfirmationContextType>(DEFAULT_CONTEXT_VALUE)
ConfirmationContext.displayName = 'ConfirmationContext'
ConfirmationContext.aglyn = true

export function useConfirmationContext(): ConfirmationContextType {
  return useContext(ConfirmationContext)
}

export default ConfirmationContext
