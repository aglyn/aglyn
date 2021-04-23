/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import React, {
  Children,
  Fragment,
  forwardRef,
  useCallback,
  useState,
  useMemo,
  useRef,
  cloneElement,
  isValidElement,
} from 'react'
import ReactFrameComponent, { FrameComponentProps } from 'react-frame-component'

import { jssPreset, StylesProvider, useTheme } from '@material-ui/core/styles'

import { create, Jss, JssOptions } from 'jss'
import rtl from 'jss-rtl'

import useCombinedRefs from '../hooks/use-combined-refs'

export type SandboxFrameDocument = HTMLIFrameElement['contentDocument']
export type SandboxFrameWindow = HTMLIFrameElement['contentWindow']
type State = {
  ready: boolean
  sandboxFrameDocument: SandboxFrameDocument
  sandboxFrameWindow: SandboxFrameWindow
  sheetsManager?: Map<any, any>
  jss?: Jss
}

/* eslint-disable-next-line */
export interface SandboxFrameProps extends Omit<FrameComponentProps, 'contentDidMount' | 'contentDidUpdate'> {
  onContentDidMount?: (state: State) => void
  onContentDidUpdate?: (state: State) => void
  jssPlugins?: JssOptions['plugins']
  baseStyles?: string
}

/**
 * @component
 */
export const SandboxFrame = forwardRef<HTMLIFrameElement, SandboxFrameProps>(function RefRenderFn(props, ref) {
  const theme = useTheme()
  const { children, title, onContentDidMount, onContentDidUpdate, jssPlugins, baseStyles, ...rest } = props
  // Current frame state
  const [state, setState]: any = useState<State>({
    ready: false,
    sandboxFrameDocument: null,
    sandboxFrameWindow: null,
  })
  // Reference for frame context
  const styleRef = useRef(null)
  const frameRef = useRef(null)
  const rootRef = useCombinedRefs(frameRef, ref)
  const head = useMemo(
    () => (
      <Fragment>
        <title>{title}</title>
        {/* JSS Insertion Point */}
        <style
          ref={styleRef}
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: baseStyles }}
          id={'sandbox-frame-jss'}
        />
      </Fragment>
    ),
    [title, baseStyles]
  )
  const handleContentDidMount = useCallback(() => {
    const instance = frameRef.current
    const styleInstance = styleRef.current
    if (instance) {
      setState((prev) => ({
        ...prev,
        ready: true,
        sandboxFrameDocument: instance.contentDocument,
        sandboxFrameWindow: instance.contentWindow,
        /**
         * Setup the stylesheets for JSS
         */
        sheetsManager: new Map(),
        jss: create({
          plugins: [...jssPreset().plugins, rtl(), ...jssPlugins],
          insertionPoint: styleInstance,
        }),
      }))
    }
    onContentDidMount && onContentDidMount(state)
  }, [onContentDidMount, state, jssPlugins])
  const handleContentDidUpdate = useCallback(() => {
    const instance = frameRef.current
    if (instance) {
      instance.contentDocument.body.dir = theme.direction
    }
    onContentDidUpdate && onContentDidUpdate(state)
  }, [onContentDidUpdate, theme.direction, state])
  const childElement = Children.only(children)
  console.debug('[RENDERING SANDBOX FRAME]', title, `STATE READY? ${state.ready}`)
  return (
    <ReactFrameComponent
      ref={rootRef}
      contentDidMount={handleContentDidMount}
      contentDidUpdate={handleContentDidUpdate}
      head={head}
      {...rest}
    >
      {state.ready ? (
        <StylesProvider jss={state.jss} sheetsManager={state.sheetsManager}>
          {isValidElement(childElement) ? cloneElement(childElement, state) : 'INVALID SANDBOX FRAME CHILD ELEMENT!'}
        </StylesProvider>
      ) : null}
    </ReactFrameComponent>
  )
})

SandboxFrame.displayName = 'SandboxFrame'
SandboxFrame.defaultProps = {
  // Global styles for frame document
  baseStyles: 'html, body, .frame-root, .frame-content { width: 100%; height: 100%; }',
}

export default SandboxFrame
