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

/**
 * Part of the following typing and documentation is from material-ui/src/Snackbar/Snackbar.d.ts
 */
import {type ClickAwayListenerProps, type SnackbarClassKey, type StandardProps} from '@mui/material'
import {type TransitionProps} from '@mui/material/transitions'
import {
  type AriaAttributes,
  type ComponentType,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
  type SyntheticEvent,
} from 'react'
import SnackbarProvider from './SnackbarProvider'


export type RequiredBy<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>
export type ClassNameMap<ClassKey extends string = string> = Record<ClassKey, string>
type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>
type Modify<T, R> = Pick<T, Exclude<keyof T, keyof R>> & R

export type SnackbarId = string | number
export type VariantType = 'default' | 'error' | 'success' | 'warning' | 'info'
export type CloseReason = 'timeout' | 'clickaway' | 'maxsnack' | 'instructed'

export type SnackbarMessage = string | ReactNode
export type SnackbarAction = ReactNode | ((snackbarId: SnackbarId) => ReactNode)
export type SnackbarContentCallback = ReactNode | ((
  snackbarId: SnackbarId,
  message: SnackbarMessage,
) => ReactNode)


// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TransitionCloseHandler = (
  event: SyntheticEvent<any> | null,
  reason: CloseReason,
  snackbarId?: SnackbarId,
) => void
export type TransitionEnterHandler = (
  node: HTMLElement,
  isAppearing: boolean,
  snackbarId: SnackbarId,
) => void
export type TransitionHandler = (node: HTMLElement, snackbarId: SnackbarId) => void

export type ContainerClassKey =
  | 'containerRoot'
  | 'containerAnchorOriginTopCenter'
  | 'containerAnchorOriginBottomCenter'
  | 'containerAnchorOriginTopRight'
  | 'containerAnchorOriginBottomRight'
  | 'containerAnchorOriginTopLeft'
  | 'containerAnchorOriginBottomLeft'

export type VariantClassKey = 'variantSuccess' | 'variantError' | 'variantInfo' | 'variantWarning'
export type CombinedClassKey = VariantClassKey | ContainerClassKey | SnackbarClassKey

export interface SnackbarOrigin {
  vertical: 'top' | 'bottom'
  horizontal: 'left' | 'center' | 'right'
}

export interface IconVariant {
  /**
   * Icon displayed when variant of a snackbar is set to `default`.
   */
  default: ReactNode
  /**
   * Icon displayed when variant of a snackbar is set to `error`.
   */
  error: ReactNode
  /**
   * Icon displayed when variant of a snackbar is set to `success`.
   */
  success: ReactNode
  /**
   * Icon displayed when variant of a snackbar is set to `warning`.
   */
  warning: ReactNode
  /**
   * Icon displayed when variant of a snackbar is set to `info`.
   */
  info: ReactNode
}

/**
 * @category Shared
 */
export interface TransitionHandlerProps {
  /**
   * Callback fired before snackbar requests to get closed.
   * The `reason` parameter can optionally be used to control the response to `onClose`.
   *
   * @param {object} event The event source of the callback
   * @param {string} reason Can be:`"timeout"` (`autoHideDuration` expired) or: `"clickaway"`
   *  or: `"maxsnack"` (snackbar was closed because `maxSnack` has reached) or: `"instructed"`
   * (snackbar was closed programmatically)
   * @param {string|number|undefined} snackbarId ID of a Snackbar. snackbarId will be `undefined` if
   *   closeSnackbar is called with no snackbarId (user requested all the snackbars to be closed)
   */
  onClose: TransitionCloseHandler
  /**
   * Callback fired before the transition is entering.
   */
  onEnter: TransitionHandler
  /**
   * Callback fired when the transition is entering.
   */
  onEntering: TransitionHandler
  /**
   * Callback fired when the transition has entered.
   */
  onEntered: TransitionEnterHandler
  /**
   * Callback fired before the transition is exiting.
   */
  onExit: TransitionHandler
  /**
   * Callback fired when the transition is exiting.
   */
  onExiting: TransitionHandler
  /**
   * Callback fired when the transition has exited.
   */
  onExited: TransitionHandler
}

export type SnackbarContentProps = HTMLAttributes<HTMLDivElement>

// backwards compatibility
export type WithSnackbarProps = ProviderContext

/**
 * @category Shared
 */
export interface SnackbarProps extends StandardProps<HTMLAttributes<HTMLDivElement>, SnackbarClassKey> {
  /**
   * The anchor of the `Snackbar`.
   * @default { horizontal: left, vertical: bottom }
   */
  anchorOrigin?: SnackbarOrigin
  /**
   * The number of milliseconds to wait before automatically calling the
   * `onClose` function. By default snackbars get closed after 5000 milliseconds.
   * Set autoHideDuration to 'null' if you don't want snackbars to automatically close.
   * Alternatively pass `persist: true` in the options parameter of enqueueSnackbar.
   * @default 5000
   */
  autoHideDuration?: number | null
  /**
   * @ignore
   * Properties applied to ClickAwayListener component
   */
  ClickAwayListenerProps?: Partial<ClickAwayListenerProps>
  /**
   * Aria attributes applied to snackbar's content component
   */
  ariaAttributes?: AriaAttributes
  /**
   * If `true`, the `autoHideDuration` timer will expire even if the window is not focused.
   * @default false
   */
  disableWindowBlurListener?: boolean
  /**
   * The number of milliseconds to wait before dismissing after user interaction.
   * If `autoHideDuration` property isn't specified, it does nothing.
   * If `autoHideDuration` property is specified but `resumeHideDuration` isn't,
   * we use the default value.
   * @default autoHideDuration / 2 ms.
   */
  resumeHideDuration?: number
  /**
   * The component used for the transition. (e.g. Slide, Grow, Zoom, etc.)
   * @default Slide
   */
  TransitionComponent?: ComponentType<TransitionProps>
  /**
   * The duration for the transition, in milliseconds.
   * You may specify the duration with an object in the following shape:
   * ```js
   * transitionDuration={{ enter: 300, exit: 500 }}
   * ```
   * @default { enter: 225, exit: 195 }
   */
  transitionDuration?: {appear?: number, enter?: number, exit?: number}
  /**
   * Properties applied to Transition component (e.g. Slide, Grow, Zoom, etc.)
   */
  TransitionProps?: TransitionProps
}

/**
 * @category Shared
 */
export interface SharedProps extends Omit<SnackbarProps, 'classes'>, Partial<TransitionHandlerProps> {
  /**
   * Used to easily display different variant of snackbars. When passed to `SnackbarProvider`
   * all snackbars inherit the `variant`, unless you override it in `enqueueSnackbar` options.
   * @default default
   */
  variant?: VariantType
  /**
   * Ignores displaying multiple snackbars with the same `message`
   * @default false
   */
  allowDuplicate?: boolean
  /**
   * Replace the snackbar. Callback used for displaying entirely customized snackbar.
   * @param {string|number} snackbarId ID of a snackbar
   */
  content?: SnackbarContentCallback
  /**
   * Callback used for getting action(s). actions are mostly buttons displayed in Snackbar.
   * @param {string|number} snackbarId ID of a snackbar
   */
  action?: SnackbarAction
}

/**
 * @category Enqueue
 */
export interface OptionsObject extends SharedProps {
  /**
   * Unique identifier to reference a snackbar.
   * @default random unique string
   */
  snackbarId?: SnackbarId
  /**
   * Snackbar stays on the screen, unless it is dismissed (programmatically or through user
   * interaction).
   * @default false
   */
  persist?: boolean
}

/**
 * All material-ui props, including class keys for notistack and material-ui with additional
 * notistack props
 * @category Provider
 */
export interface SnackbarProviderProps extends SharedProps {
  /**
   * Most of the time this is your App. every component from this point onward
   * will be able to show snackbars.
   */
  children: ReactNode | ReactNode[]
  /**
   * Denser margins for snackbars. Recommended to be used on mobile devices.
   * @default false
   */
  dense?: boolean
  /**
   * Maximum snackbars that can be stacked on top of one another.
   * @default 3
   */
  maxSnack?: number
  /**
   * Hides iconVariant if set to `true`.
   * @default false
   */
  hideIconVariant?: boolean
  /**
   * Valid and exist HTML Node element, used to target `ReactDOM.createPortal`
   */
  domRoot?: HTMLElement
  /**
   * Override or extend the styles applied to the container component or Snackbars.
   */
  classes?: Partial<ClassNameMap<CombinedClassKey>>
  /**
   * Little icon that is displayed at left corner of a snackbar.
   */
  iconVariant?: Partial<IconVariant>
  /**
   * @ignore
   * SnackbarProvider's ref
   */
  ref?: Ref<SnackbarProvider>
}

export interface ProviderContext {
  enqueueSnackbar: (message: SnackbarMessage, options?: OptionsObject) => SnackbarId
  closeSnackbar: (snackbarId?: SnackbarId) => void
}
