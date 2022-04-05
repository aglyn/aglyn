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

// eslint-disable-next-line @nrwl/nx/enforce-module-boundaries
import {createChainedFunction} from '@aglyn/shared-util-tools'
import {Collapse, emphasize, type SnackbarClassKey, styled} from '@mui/material'
import clsx from 'clsx'
import {forwardRef, useEffect, useRef, useState} from 'react'
import SnackbarContent from '../SnackbarContent'
import {type Snack} from '../SnackbarProvider'
import {
  type ClassNameMap,
  type RequiredBy,
  type SharedProps,
  type SnackbarProviderProps as ProviderProps,
  type TransitionHandlerProps,
} from '../types'
import {DEFAULTS, objectMerge, REASONS, transformer} from '../utils/constants'
import defaultIconVariants from '../utils/defaultIconVariants'
import Snackbar from './Snackbar'
import {getTransitionDirection} from './SnackbarItem.util'


const componentName = 'SnackbarItem'

const classes = {
  contentRoot: `${componentName}-contentRoot`,
  lessPadding: `${componentName}-lessPadding`,
  variantSuccess: `${componentName}-variantSuccess`,
  variantError: `${componentName}-variantError`,
  variantInfo: `${componentName}-variantInfo`,
  variantWarning: `${componentName}-variantWarning`,
  message: `${componentName}-message`,
  action: `${componentName}-action`,
  wrappedRoot: `${componentName}-wrappedRoot`,
}

const StyledSnackbar = styled(Snackbar)(({theme}) => {
  const mode = theme.palette.mode
  const backgroundColor = emphasize(theme.palette.background.default, mode === 'light' ? 0.8 : 0.98)

  return {
    [`&.${classes.wrappedRoot}`]: {
      position: 'relative',
      transform: 'translateX(0)',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    },
    [`.${classes.contentRoot}`]: {
      ...theme.typography.body2,
      backgroundColor,
      color: theme.palette.getContrastText(backgroundColor),
      alignItems: 'center',
      padding: '6px 16px',
      borderRadius: '4px',
      boxShadow: '0px 3px 5px -1px rgba(0,0,0,0.2),0px 6px 10px 0px rgba(0,0,0,0.14),0px 1px 18px 0px rgba(0,0,0,0.12)',
    },
    [`.${classes.lessPadding}`]: {
      paddingLeft: 8 * 2.5,
    },
    [`.${classes.variantSuccess}`]: {
      backgroundColor: '#43a047', // green
      color: '#fff',
    },
    [`.${classes.variantError}`]: {
      backgroundColor: '#d32f2f', // dark red
      color: '#fff',
    },
    [`.${classes.variantInfo}`]: {
      backgroundColor: '#2196f3', // nice blue
      color: '#fff',
    },
    [`.${classes.variantWarning}`]: {
      backgroundColor: '#ff9800', // amber
      color: '#fff',
    },
    [`.${classes.message}`]: {
      display: 'flex',
      alignItems: 'center',
      padding: '8px 0',
    },
    [`.${classes.action}`]: {
      display: 'flex',
      alignItems: 'center',
      marginLeft: 'auto',
      paddingLeft: 16,
      marginRight: -8,
    },
  }
})

type RemovedProps =
  | 'variant' // the one received from Provider is processed and passed to snack prop
  | 'anchorOrigin' // same as above
  | 'autoHideDuration' // same as above
  | 'preventDuplicate' // the one recevied from enqueueSnackbar is processed in provider, therefore
                       // shouldn't be passed to SnackbarItem */

export interface SnackbarItemProps extends RequiredBy<Omit<SharedProps, RemovedProps>, 'onEntered' | 'onExited' | 'onClose'> {
  snack: Snack;
  dense: ProviderProps['dense'];
  iconVariant: ProviderProps['iconVariant'];
  hideIconVariant: ProviderProps['hideIconVariant'];
  classes: Partial<ClassNameMap<SnackbarClassKey>>;
}

const SnackbarItem = forwardRef<any, SnackbarItemProps>(
  function RefRenderFn(props, ref) {

    const {classes: propClasses, ...rest} = props
    const timeout = useRef<ReturnType<typeof setTimeout>>()
    const [collapsed, setCollapsed] = useState(true)

    useEffect(() => (): void => {
      if (timeout.current) {
        clearTimeout(timeout.current)
      }
    }, [])

    const handleClose = createChainedFunction(
      [rest.snack.onClose, rest.onClose],
      null,
      rest.snack.snackbarId
    )

    const handleEntered: TransitionHandlerProps['onEntered'] = () => {
      if (rest.snack.requestClose) {
        handleClose(null, REASONS.INSTRCUTED)
      }
    }

    const handleExitedScreen = (): void => {
      timeout.current = setTimeout(() => {
        setCollapsed(!collapsed)
      }, 125)
    }

    const {
      style,
      dense,
      ariaAttributes: otherAriaAttributes,
      className: otherClassName,
      hideIconVariant,
      iconVariant,
      snack,
      action: otherAction,
      content: otherContent,
      TransitionComponent: otherTranComponent,
      TransitionProps: otherTranProps,
      transitionDuration: otherTranDuration,
      onEnter: ignoredOnEnter,
      onEntered: ignoredOnEntered,
      onEntering: ignoredOnEntering,
      onExit: ignoredOnExit,
      onExited: ignoredOnExited,
      onExiting: ignoredOnExiting,
      ...other
    } = rest

    const {
      persist,
      snackbarId,
      open,
      entered,
      requestClose,
      className: singleClassName,
      variant,
      content: singleContent,
      action: singleAction,
      ariaAttributes: singleAriaAttributes,
      anchorOrigin,
      message: snackMessage,
      TransitionComponent: singleTranComponent,
      TransitionProps: singleTranProps,
      transitionDuration: singleTranDuration,
      onEnter,
      onEntered,
      onEntering,
      onExit,
      onExited,
      onExiting,
      ...singleSnackProps
    } = snack

    const icon = {
      ...defaultIconVariants,
      ...iconVariant,
    }[variant]

    const ariaAttributes = {
      'aria-describedby': 'notistack-snackbar',
      ...objectMerge(singleAriaAttributes, otherAriaAttributes),
    }

    const TransitionComponent = singleTranComponent || otherTranComponent || DEFAULTS.TransitionComponent
    const transitionDuration = objectMerge(singleTranDuration, otherTranDuration, DEFAULTS.transitionDuration)
    const transitionProps = {
      direction: getTransitionDirection(anchorOrigin),
      ...objectMerge(singleTranProps, otherTranProps),
    }

    let action = singleAction || otherAction
    if (typeof action === 'function') {
      action = action(snackbarId)
    }

    let content = singleContent || otherContent
    if (typeof content === 'function') {
      content = content(snackbarId, snack.message)
    }

    // eslint-disable-next-line operator-linebreak
    const callbacks: { [key in keyof TransitionHandlerProps]?: any } = [
      'onEnter',
      'onEntering',
      'onEntered',
      'onExit',
      'onExiting',
      'onExited'
    ].reduce((acc, callbackName) => ({
      ...acc,
      [callbackName]: createChainedFunction(
        [
          rest.snack[callbackName as keyof Snack],
          rest[callbackName as keyof SnackbarItemProps],
        ],
        null,
        rest.snack.snackbarId
      ),
    }), {})

    return (
      <Collapse
        ref={ref}
        unmountOnExit
        timeout={175}
        in={collapsed}
        onExited={callbacks.onExited}
      >
        <StyledSnackbar
          {...other}
          {...singleSnackProps}
          open={open}
          className={clsx(
            propClasses.root,
            classes.wrappedRoot,
            propClasses[transformer.toAnchorOrigin(anchorOrigin)],
          )}
          onClose={handleClose}
        >
          <TransitionComponent
            appear
            in={open}
            timeout={transitionDuration}
            {...transitionProps}
            onExit={callbacks.onExit}
            onExiting={callbacks.onExiting}
            onExited={handleExitedScreen}
            onEnter={callbacks.onEnter}
            onEntering={callbacks.onEntering}
            // order matters. first callbacks.onEntered to set entered: true,
            // then handleEntered to check if there's a request for closing
            onEntered={createChainedFunction([callbacks.onEntered, handleEntered])}
          >
            {/* eslint-disable-next-line @typescript-eslint/ban-ts-comment */}
            {/* @ts-ignore */}
            {content || (
              <SnackbarContent
                {...ariaAttributes}
                role="alert"
                style={style}
                className={clsx(
                  classes.contentRoot,
                  {[classes.lessPadding]: !hideIconVariant && icon},
                  classes[transformer.toVariant(variant)],
                  propClasses[transformer.toVariant(variant)],
                  otherClassName,
                  singleClassName,
                )}
              >
                <div id={ariaAttributes['aria-describedby']} className={classes.message}>
                  {!hideIconVariant ? icon : null}
                  {snackMessage}
                </div>
                {action && (
                  <div className={classes.action}>{action}</div>
                )}
              </SnackbarContent>
            )}
          </TransitionComponent>
        </StyledSnackbar>
      </Collapse>
    )
  },
)

export default SnackbarItem
