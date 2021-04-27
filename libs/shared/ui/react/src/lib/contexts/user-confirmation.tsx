/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import {
  createContext,
  ElementType,
  Fragment,
  MouseEventHandler,
  ReactNode,
  useCallback,
  useContext,
  useState,
} from 'react'
import { ButtonProps } from '@material-ui/core/Button'
import { DialogProps } from '@material-ui/core/Dialog'
import { DialogTitleProps } from '@material-ui/core/DialogTitle'
import { DialogContentTextProps } from '@material-ui/core/DialogContentText'
import DialogConfirm from '../components/dialog-confirm/dialog-confirm'


export interface UserConfirmationOptions {
  cancellationText?: ButtonProps['children']
  confirmationText?: ButtonProps['children']
  cancellationButtonProps?: Partial<ButtonProps>
  confirmationButtonProps?: Partial<ButtonProps>
  dialogProps?: Partial<DialogProps>
  title?: DialogTitleProps['children']
  description?: DialogContentTextProps['children']
}

export type UserConfirmationContextType = (options?: UserConfirmationOptions) => Promise<unknown>
export type UseUserConfirmationType = () => UserConfirmationContextType

export const UserConfirmationContext = createContext<UserConfirmationContextType>(null)
export const useUserConfirmation: UseUserConfirmationType = () => {
  return useContext(UserConfirmationContext)
}

const DEFAULT_OPTIONS: UserConfirmationOptions = {
  title: 'Are you sure?',
  description: '',
  confirmationText: 'OK',
  cancellationText: 'Cancel',
  dialogProps: {},
  confirmationButtonProps: {},
  cancellationButtonProps: {},
}
const buildOptions = (defaultOptions, options) => {
  const dialogProps = {
    ...(defaultOptions.dialogProps || DEFAULT_OPTIONS.dialogProps),
    ...(options.dialogProps || {}),
  }
  const confirmationButtonProps = {
    ...(defaultOptions.confirmationButtonProps || DEFAULT_OPTIONS.confirmationButtonProps),
    ...(options.confirmationButtonProps || {}),
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
    confirmationButtonProps,
    cancellationButtonProps,
  }
}

export interface UserConfirmationProviderComponentProps {
  defaultOptions?: UserConfirmationOptions
  children?: ReactNode
  component: ElementType<{
    open: boolean
    options: UserConfirmationOptions
    onClose: MouseEventHandler<unknown>
    onCancel: MouseEventHandler<unknown>
    onConfirm: MouseEventHandler<unknown>
  }>
}

const UserConfirmationProviderComponent = (props: UserConfirmationProviderComponentProps) => {
  const { children, defaultOptions = {}, component: Component } = props
  const [options, setOptions] = useState({ ...DEFAULT_OPTIONS, ...defaultOptions })
  const [resolveReject, setResolveReject] = useState([])
  const [resolve, reject] = resolveReject

  const confirmFn = useCallback((options: UserConfirmationOptions = {}) => {
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
      <UserConfirmationContext.Provider value={confirmFn}>
        {children}
      </UserConfirmationContext.Provider>
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

UserConfirmationProviderComponent.defaultProps = {
  component: DialogConfirm,
}

export default UserConfirmationProviderComponent
