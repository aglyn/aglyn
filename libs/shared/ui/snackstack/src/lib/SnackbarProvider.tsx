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

import {createChainedFunction} from '@aglyn/shared-util-tools'
import clsx from 'clsx'
import {Component} from 'react'
import {createPortal} from 'react-dom'
import SnackbarContainer from './SnackbarContainer'
import SnackbarContext from './SnackbarContext'
import SnackbarItem from './SnackbarItem'
import type {
  OptionsObject,
  ProviderContext,
  RequiredBy,
  SnackbarId,
  SnackbarMessage,
  SnackbarProviderProps,
  TransitionHandlerProps,
} from './types'
import {
  DEFAULTS,
  isDefined,
  merge,
  MESSAGES,
  omitContainerKeys,
  originKeyExtractor,
  REASONS,
  transformer,
} from './utils/constants'
import warning from './utils/warning'


type Reducer = (state: State) => State;
type SnacksByPosition = {[snackbarId: string]: Snack[]};

export interface Snack extends RequiredBy<OptionsObject, 'snackbarId' | 'variant' | 'anchorOrigin'> {
  message: SnackbarMessage;
  open: boolean;
  entered: boolean;
  requestClose: boolean;
}

interface State {
  snacks: Snack[];
  queue: Snack[];
  contextValue: ProviderContext;
}

class SnackbarProvider extends Component<SnackbarProviderProps, State> {

  get maxSnack(): number {
    return this.props.maxSnack || DEFAULTS.maxSnack
  }

  constructor(props: SnackbarProviderProps) {
    super(props)
    this.state = {
      snacks: [],
      queue: [], // eslint-disable-line react/no-unused-state
      contextValue: {
        enqueueSnackbar: this.enqueueSnackbar.bind(this),
        closeSnackbar: this.closeSnackbar.bind(this),
      },
    }
  }

  /**
   * Adds a new snackbar to the queue to be presented. Returns generated or user
   * defined snackbarId referencing the new snackbar or null
   */
  public enqueueSnackbar = (message: SnackbarMessage, opts: OptionsObject = {}): SnackbarId => {
    const {
      snackbarId,
      allowDuplicate,
      ...options
    } = opts

    const hasSpecifiedKey = isDefined(snackbarId)
    const id = hasSpecifiedKey ? (snackbarId as SnackbarId) : new Date().getTime() + Math.random()

    const merger = merge(options, this.props, DEFAULTS)
    const snack: Snack = {
      snackbarId: id,
      ...options,
      message,
      open: true,
      entered: false,
      requestClose: false,
      variant: merger('variant'),
      anchorOrigin: merger('anchorOrigin'),
      autoHideDuration: merger('autoHideDuration'),
    }

    if (options.persist) {
      snack.autoHideDuration = undefined
    }

    this.setState((state) => {
      if ((allowDuplicate === undefined && this.props.allowDuplicate) || allowDuplicate) {
        const compareFunction = (item: Snack): boolean => (
          hasSpecifiedKey ? item.snackbarId === snackbarId : item.message === message
        )

        const inQueue = state.queue.findIndex(compareFunction) > -1
        const inView = state.snacks.findIndex(compareFunction) > -1
        if (inQueue || inView) {
          return state
        }
      }

      return this.handleDisplaySnack({
        ...state,
        queue: [...state.queue, snack],
      })
    })

    return id
  }

  /**
   * Close snackbar with the given snackbarId
   */
  public closeSnackbar: ProviderContext['closeSnackbar'] = (snackbarId) => {
    // call individual snackbar onClose callback passed through options parameter
    const toBeClosed = this.state.snacks.find(item => item.snackbarId === snackbarId)
    if (isDefined(snackbarId) && toBeClosed && toBeClosed.onClose) {
      toBeClosed.onClose(null, REASONS.INSTRUCTED, snackbarId)
    }

    this.handleCloseSnack(null, REASONS.INSTRUCTED, snackbarId)
  }

  public render(): JSX.Element {
    const {contextValue} = this.state
    const {
      maxSnack: dontspread1,
      allowDuplicate: dontspread2,
      variant: dontspread3,
      anchorOrigin: dontspread4,
      iconVariant,
      dense,
      hideIconVariant,
      domRoot,
      children,
      classes = {},
      ...props
    } = this.props

    const categ = this.state.snacks.reduce<SnacksByPosition>((acc, current) => {
      const category = originKeyExtractor(current.anchorOrigin)
      const existingOfCategory = acc[category] || []
      return {
        ...acc,
        [category]: [...existingOfCategory, current],
      }
    }, {})

    const snackbars = Object.keys(categ).map((origin) => {
      const snacks = categ[origin]
      return (
        <SnackbarContainer
          key={origin}
          dense={Boolean(dense)}
          anchorOrigin={snacks[0].anchorOrigin}
          className={clsx(
            classes.containerRoot,
            classes[transformer.toContainerAnchorOrigin(origin)],
          )}
        >
          {snacks.map(snack => (
            <SnackbarItem
              {...props}
              key={snack.snackbarId}
              snack={snack}
              dense={Boolean(dense)}
              iconVariant={iconVariant}
              hideIconVariant={hideIconVariant}
              classes={omitContainerKeys(classes)}
              onClose={this.handleCloseSnack}
              onExited={createChainedFunction([this.handleExitedSnack, this.props.onExited])}
              onEntered={createChainedFunction([this.handleEnteredSnack, this.props.onEntered])}
            />
          ))}
        </SnackbarContainer>
      )
    })

    return (
      <SnackbarContext.Provider value={contextValue}>
        {children}
        {domRoot ? createPortal(snackbars, domRoot) : snackbars}
      </SnackbarContext.Provider>
    )
  }


  /**
   * Reducer: Display snack if there's space for it. Otherwise, immediately
   * begin dismissing the oldest message to start showing the new one.
   */
  private handleDisplaySnack: Reducer = (state) => {
    const {snacks} = state
    if (snacks.length >= this.maxSnack) {
      return this.handleDismissOldest(state)
    }
    return this.processQueue(state)
  }

  /**
   * Reducer: Display items (notifications) in the queue if there's space for them.
   */
  private processQueue: Reducer = (state) => {
    const {queue, snacks} = state
    if (queue.length > 0) {
      return {
        ...state,
        snacks: [...snacks, queue[0]],
        queue: queue.slice(1, queue.length),
      }
    }
    return state
  }

  /**
   * Reducer: Hide oldest snackbar on the screen because there exists a new one which we have to
   * display.
   * (ignoring the one with 'persist' flag. i.e. explicitly told by user not to get dismissed).
   *
   * Note 1: If there is already a message leaving the screen, no new messages are dismissed.
   * Note 2: If the oldest message has not yet entered the screen, only a request to close the
   *         snackbar is made. Once it entered the screen, it will be immediately dismissed.
   */
  private handleDismissOldest: Reducer = (state) => {
    if (state.snacks.some(item => !item.open || item.requestClose)) {
      return state
    }

    let popped = false
    let ignore = false

    const persistentCount = state.snacks.reduce((acc, current) => (
      acc + (current.open && current.persist ? 1 : 0)
    ), 0)

    if (persistentCount === this.maxSnack) {
      warning(MESSAGES.NO_PERSIST_ALL)
      ignore = true
    }

    const snacks = state.snacks.map((item) => {
      if (!popped && (!item.persist || ignore)) {
        popped = true

        if (!item.entered) {
          return {
            ...item,
            requestClose: true,
          }
        }

        if (item.onClose) item.onClose(null, REASONS.MAXSNACK, item.snackbarId)
        if (this.props.onClose) this.props.onClose(null, REASONS.MAXSNACK, item.snackbarId)

        return {
          ...item,
          open: false,
        }
      }

      return {...item}
    })

    return {...state, snacks}
  }

  /**
   * Set the entered state of the snackbar with the given snackbarId.
   */
  private handleEnteredSnack: TransitionHandlerProps['onEntered'] = (node, isAppearing, snackbarId) => {
    if (!isDefined(snackbarId)) {
      throw new Error('handleEnteredSnack Cannot be called with undefined snackbarId')
    }

    this.setState(({snacks}) => ({
      snacks: snacks.map(item => (
        item.snackbarId === snackbarId ? {...item, entered: true} : {...item}
      )),
    }))
  }

  /**
   * Hide a snackbar after its timeout.
   */
  private handleCloseSnack: TransitionHandlerProps['onClose'] = (event, reason, snackbarId) => {
    // should not use createChainedFunction for onClose.
    // because this.closeSnackbar called this function
    if (this.props.onClose) {
      this.props.onClose(event, reason, snackbarId)
    }

    if (reason === REASONS.CLICKAWAY) return
    const shouldCloseAll = snackbarId === undefined

    this.setState(({snacks, queue}) => ({
      snacks: snacks.map((item) => {
        if (!shouldCloseAll && item.snackbarId !== snackbarId) {
          return {...item}
        }

        return item.entered
          ? {...item, open: false}
          : {...item, requestClose: true}
      }),
      queue: queue.filter(item => item.snackbarId !== snackbarId), // eslint-disable-line react/no-unused-state
    }))
  }

  /**
   * When we set open attribute of a snackbar to false (i.e. after we hide a snackbar),
   * it leaves the screen and immediately after leaving animation is done, this method
   * gets called. We remove the hidden snackbar from state and then display notifications
   * waiting in the queue (if any). If after this process the queue is not empty, the
   * oldest message is dismissed.
   */
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
  private handleExitedSnack: TransitionHandlerProps['onExited'] = (event, snackbarId1, snackbarId2) => {
    const snackbarId = snackbarId1 || snackbarId2
    if (!isDefined(snackbarId)) {
      throw new Error('handleExitedSnack Cannot be called with undefined snackbarId')
    }

    this.setState((state) => {
      const newState = this.processQueue({
        ...state,
        snacks: state.snacks.filter(item => item.snackbarId !== snackbarId),
      })

      if (newState.queue.length === 0) {
        return newState
      }

      return this.handleDismissOldest(newState)
    })
  }
}


export {SnackbarProvider}
export default SnackbarProvider
