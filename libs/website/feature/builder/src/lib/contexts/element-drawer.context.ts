/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { createContext, useContext } from 'react'
import { ButtonProps } from '@material-ui/core/Button'
import { DialogProps } from '@material-ui/core/Dialog'
import { DialogTitleProps } from '@material-ui/core/DialogTitle'
import { DialogContentTextProps } from '@material-ui/core/DialogContentText'

export interface ElementDrawerOptions {
  cancellationText?: ButtonProps['children']
  selectionText?: ButtonProps['children']
  cancellationButtonProps?: Partial<ButtonProps>
  selectionButtonProps?: Partial<ButtonProps>
  dialogProps?: Partial<DialogProps>
  title?: DialogTitleProps['children']
  description?: DialogContentTextProps['children']
  type?: 'browse-site-components' | 'edit-element-traits'
}

export type ElementDrawerFn = (options?: ElementDrawerOptions) => Promise<unknown>

export interface ElementDrawerContextType {
  elementDrawer: ElementDrawerFn
}

export type UseElementDrawerType = () => ElementDrawerContextType

export const DEFAULT_OPTIONS: ElementDrawerOptions = {
  title: 'Are you sure?',
  description: '',
  selectionText: 'OK',
  cancellationText: 'Cancel',
  dialogProps: {},
  selectionButtonProps: {},
  cancellationButtonProps: {},
  type: 'browse-site-components',
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

export const ElementDrawerContext = createContext<ElementDrawerContextType>(null)
export const useElementDrawerContext: UseElementDrawerType = () => {
  return useContext(ElementDrawerContext)
}

export default ElementDrawerContext
