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
  useCallback, useMemo,
  useState,
} from 'react'
import { SelectionComponent } from '../components/selection.component'
import {
  buildOptions,
  DEFAULT_OPTIONS,
  SelectionContext,
  SelectionOptions,
} from './selection-context'


export interface SelectionContextProviderProps {
  defaultOptions?: SelectionOptions
  children?: ReactNode
  component: ElementType<{
    open: boolean
    options: SelectionOptions
    onClose: MouseEventHandler<unknown>
    onCancel: MouseEventHandler<unknown>
    onConfirm: MouseEventHandler<unknown>
  }>
}

function SelectionContextProviderRaw(props: SelectionContextProviderProps) {
  const {children, defaultOptions, component: Component} = props
  const [options, setOptions] = useState<SelectionOptions>({})
  const [resolveReject, setResolveReject] = useState(() => [])
  const { $id } = options

  const select = useCallback(
    (options: SelectionOptions) => {
      const opts = {...options}
      return new Promise((resolve, reject) => {
        setOptions(buildOptions(defaultOptions, opts))
        setResolveReject([resolve, reject])
      })
    },
    [defaultOptions],
  )

  const close = useCallback(() => {
    setResolveReject([])
    setOptions({})
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
      <SelectionContext.Provider value={{$id, select, close}}>
        {children}
      </SelectionContext.Provider>
    )
  }, [children, $id, select, close])

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
SelectionContextProviderRaw.displayName = 'SelectionContextProvider'
SelectionContextProviderRaw.defaultProps = {
  component: SelectionComponent,
  defaultOptions: {},
}

export const SelectionContextProvider = memo(SelectionContextProviderRaw)

export default SelectionContextProvider
