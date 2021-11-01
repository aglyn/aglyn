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

import { ElementType, Fragment, memo, ReactNode, useCallback, useMemo, useState } from 'react'
import { useDebouncedCallback } from 'use-debounce'
import { HoverComponent, HoverComponentProps } from '../components/hover.component'
import { buildOptions, DEFAULT_OPTIONS, HoverContext, HoverOptions } from './hover-context'


export interface HoverContextProviderProps {
  defaultOptions?: Partial<HoverOptions>
  children?: ReactNode
  component: ElementType<HoverComponentProps>
}

type ResolveReject<T = any> = [] | [
  resolve: (value: T | PromiseLike<T>) => void,
  reject: (reason?: any) => void
]

function HoverContextProviderRaw(props: HoverContextProviderProps) {
  const {children, defaultOptions, component: Component} = props
  const [selectedOptions, setSelectedOptions] = useState<HoverOptions>({...DEFAULT_OPTIONS, ...defaultOptions})
  const [selectedResolveReject, setSelectedResolveReject] = useState<ResolveReject>(() => [])
  const [hoveredOptions, setHoveredOptions] = useState<HoverOptions>({...DEFAULT_OPTIONS, ...defaultOptions})
  const [hoveredResolveReject, setHoveredResolveReject] = useState<ResolveReject>(() => [])

  const handleHover = useDebouncedCallback((opts: HoverOptions) => {
    setHoveredOptions(buildOptions(defaultOptions, opts || {}))
    return new Promise((resolve, reject) => {
      setHoveredResolveReject([resolve, reject])
    })
  }, 200)

  const handleSelect = (opts: HoverOptions) => {
    setSelectedOptions(buildOptions(defaultOptions, opts || {}))
    return new Promise((resolve, reject) => {
      setSelectedResolveReject([resolve, reject])
    })
  }

  const handleUnhover = useDebouncedCallback(() => {
    return setHoveredResolveReject([])
  }, 200)

  const handleDeselect = () => {
    return setSelectedResolveReject([])
  }

  const hoverOpen = useCallback((opts: HoverOptions) => {
    return handleHover(opts)
  }, [])

  const hoverSelect = useCallback((event?: Element, opts?: HoverOptions) => {
    return handleSelect(opts)
  }, [])

  const hoverClose = useCallback((event?: Element) => {
    handleUnhover()
  }, [])

  const hoverDeselect = useCallback((event?: Element) => {
    handleDeselect()
  }, [])

  const child = useMemo(() => {
    return (
      <HoverContext.Provider value={{hoverOpen, hoverSelect, hoverClose, hoverDeselect}}>
        {children}
      </HoverContext.Provider>
    )
  }, [children, hoverOpen, hoverSelect, hoverClose, hoverDeselect])

  const childSelected = useMemo(() => {
    return (
      <Component
        open={selectedResolveReject.length === 2}
        options={selectedOptions}
        onClose={hoverDeselect}
        variant={'selected'}
      />
    )
  }, [selectedResolveReject, selectedOptions, hoverDeselect])

  const childHovered = useMemo(() => {
    return (
      <Component
        open={hoveredResolveReject.length === 2}
        options={hoveredOptions}
        onClose={hoverClose}
        variant={'hovered'}
      />
    )
  }, [hoveredResolveReject, hoveredOptions, hoverClose])


  return (
    <Fragment>
      {child}
      {childSelected}
      {childHovered}
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
