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

import {
  ElementType,
  Fragment,
  memo,
  MouseEventHandler,
  ReactNode,
  useCallback,
  useMemo,
  useState,
} from 'react'
import { useDebouncedCallback } from 'use-debounce'
import { HoverComponent } from '../components/hover.component'
import { buildOptions, DEFAULT_OPTIONS, HoverContext, HoverOptions } from './hover-context'
import { SelectionOptions } from './selection-context'


export interface HoverContextProviderProps {
  defaultOptions?: HoverOptions
  children?: ReactNode
  component: ElementType<{
    open: boolean
    options: HoverOptions
    onClose: MouseEventHandler<unknown>
    onCancel: MouseEventHandler<unknown>
    onConfirm: MouseEventHandler<unknown>
  }>
}

function HoverContextProviderRaw(props: HoverContextProviderProps) {
  const {children, defaultOptions, component: Component} = props
  const [options, setOptions] = useState({...DEFAULT_OPTIONS, ...defaultOptions})
  const [resolveReject, setResolveReject] = useState(() => [])

  const debounceHover = useDebouncedCallback(
    (opts: SelectionOptions) => {
      return new Promise((resolve, reject) => {
        setOptions(buildOptions(defaultOptions, opts || {}))
        setResolveReject([resolve, reject])
      })
    },
    200,
  )
  const debounceClose = useDebouncedCallback(
    () => setResolveReject([]),
    200
  )

  const hover = useCallback((opts: HoverOptions) => {
    return debounceHover(opts)
  }, [defaultOptions])

  const close = useCallback(() => {
    debounceClose()
  }, [])

  const cancel = useCallback(() => {
    const [, reject] = resolveReject
    reject()
    close()
  }, [resolveReject])

  const confirm = useCallback(() => {
    const [resolve] = resolveReject
    resolve()
    close()
  }, [resolveReject])

  const child = useMemo(() => {
    return (
      <HoverContext.Provider value={{hover, close}}>
        {children}
      </HoverContext.Provider>
    )
  }, [children, hover, close])

  return (
    <Fragment>
      {child}
      <Component
        open={resolveReject.length === 2}
        options={options}
        onClose={close}
        onCancel={cancel}
        onConfirm={confirm}
      />
    </Fragment>
  )
}

HoverContextProviderRaw.displayName = 'HoverContextProvider'
HoverContextProviderRaw.defaultProps = {
  component: HoverComponent,
  defaultOptions: {},
}

export const HoverContextProvider = memo(HoverContextProviderRaw)
export default HoverContextProvider
