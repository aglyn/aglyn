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

import { createContext, useContext } from 'react'
import { ButtonProps } from '@material-ui/core/Button'
import { DialogProps } from '@material-ui/core/Dialog'
import { DialogTitleProps } from '@material-ui/core/DialogTitle'
import { DialogContentTextProps } from '@material-ui/core/DialogContentText'

export interface SelectionOptions {
  cancellationText?: ButtonProps['children']
  selectionText?: ButtonProps['children']
  cancellationButtonProps?: Partial<ButtonProps>
  selectionButtonProps?: Partial<ButtonProps>
  dialogProps?: Partial<DialogProps>
  title?: DialogTitleProps['children']
  description?: DialogContentTextProps['children']
  clientRect?: DOMRect
}

export type SelectFn = (options?: SelectionOptions) => Promise<unknown>

export interface SelectionContextType {
  select: SelectFn
}

export type UseSelectionType = () => SelectionContextType

export const DEFAULT_OPTIONS: SelectionOptions = {
  title: 'Are you sure?',
  description: '',
  selectionText: 'OK',
  cancellationText: 'Cancel',
  dialogProps: {},
  selectionButtonProps: {},
  cancellationButtonProps: {},
  clientRect: null,
}

export const buildOptions = (defaultOptions, options) => {
  const dialogProps = {
    ...(defaultOptions.dialogProps || DEFAULT_OPTIONS.dialogProps),
    ...(options.dialogProps || {}),
  }
  const selectionButtonProps = {
    ...(defaultOptions.selectionButtonProps || DEFAULT_OPTIONS.selectionButtonProps),
    ...(options.selectionButtonProps || {}),
  }
  const cancellationButtonProps = {
    ...(defaultOptions.cancellationButtonProps || DEFAULT_OPTIONS.cancellationButtonProps),
    ...(options.cancellationButtonProps || {}),
  }

  return {
    ...DEFAULT_OPTIONS,
    ...defaultOptions,
    ...options,
    dialogProps,
    selectionButtonProps,
    cancellationButtonProps,
  }
}

export const SelectionContext = createContext<SelectionContextType>(null)
export const useSelectionContext: UseSelectionType = () => {
  return useContext(SelectionContext)
}

export default SelectionContext
