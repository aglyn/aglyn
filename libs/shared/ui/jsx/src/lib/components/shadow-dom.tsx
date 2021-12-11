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

//TODO: FIX ALL TYPINGS AND REFACTOR OPTIONS/PROPS

import { _isFnT, _isStrT } from '@aglyn/shared-util-guards'
import { getDisplayName } from '@aglyn/shared-util-tools'
import { ChangeCase } from '@aglyn/shared-util-vendor'
import React, {
  forwardRef,
  ForwardRefExoticComponent,
  PropsWithoutRef,
  ReactNode,
  ReactPortal,
  RefAttributes,
  useEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'

import useCombinedRefs from '../hooks/use-combined-refs'


declare global {
  /** POLYFILL FOR adoptedStyleSheets */
  interface ShadowRoot {
    adoptedStyleSheets?: StyleSheetList
  }
}

export type ShadowDomContentProps<T extends ShadowRoot = ShadowRoot> = {
  shadowRoot: T
  children: ReactNode
  key?: null | string
}
export type ShadowDomRootRenderProps = {
  shadowRoot: ShadowRoot
  children?: ReactNode
}
export type ShadowDomRootFactoryOptions = {
  render?: (props: ShadowDomRootRenderProps) => ReactNode
}
export type ShadowDomRootProps = ShadowRootInit & {
  styleSheets?: string[]
  adoptedStyleSheets?: string[]
}
export type ShadowDomRootExoticComponent<T, P> = ForwardRefExoticComponent<PropsWithoutRef<ShadowDomRootProps> & RefAttributes<T>>

export function ShadowDomContentPortal<T extends ShadowRoot>(
  props: ShadowDomContentProps<T>,
): ReactPortal {
  const {children, shadowRoot, key} = props
  return createPortal(children, shadowRoot as unknown as Element, key)
}

export function createShadowDomRoot<T, P>(
  options: ShadowDomRootFactoryOptions,
  Component,
): ShadowDomRootExoticComponent<T, P> {
  const {render} = options
  const ShadowDomRoot = forwardRef<T, ShadowDomRootProps>(function RefRenderFn(props, ref) {
    const {mode, delegatesFocus, styleSheets, adoptedStyleSheets, children, ...rest} = props
    const localRef = useRef<T>(null)
    const elemRef = useCombinedRefs(localRef, ref)
    const [shadowRoot, setShadowRoot] = useState<ShadowRoot>(null)
    const key = `node_${mode}${delegatesFocus}`

    useEffect(() => {
      const instance = localRef.current as unknown as Element
      if (instance) {
        const root: unknown = instance.attachShadow({mode, delegatesFocus})
        if (styleSheets && styleSheets.length) {
          root['styleSheets'] = styleSheets
        }
        if (adoptedStyleSheets && adoptedStyleSheets.length) {
          root['adoptedStyleSheets'] = styleSheets
        }
        setShadowRoot(root as ShadowRoot)
      }
    }, [localRef, mode, delegatesFocus, styleSheets, adoptedStyleSheets])

    return (
      <Component key={key} ref={elemRef} {...(rest as unknown as P)}>
        {shadowRoot ? (
          <ShadowDomContentPortal shadowRoot={shadowRoot}>
            {_isFnT(render) ? render({shadowRoot, children}) : children}
          </ShadowDomContentPortal>
        ) : null}
      </Component>
    )
  })

  const name = getDisplayName(Component, null) ?? _isStrT(Component) ? Component : 'Component'
  ShadowDomRoot.displayName = `ShadowDomRoot(${name})`
  ShadowDomRoot.defaultProps = {
    mode: 'open',
    delegatesFocus: false,
    styleSheets: [],
  }

  return ShadowDomRoot
}

const components = new Map<string, ReturnType<typeof createShadowDomRoot>>()

export type CreateShadowDomFactoryOptions = {
  keyPrefix?: string
  render?: ShadowDomRootFactoryOptions['render']
}

export function createShadowDomProxy(target = {}, options?: CreateShadowDomFactoryOptions) {
  const {keyPrefix, render: _renderFn} = options ?? {}
  const render = _renderFn ?? (({children}: ShadowDomRootRenderProps) => children)

  return new Proxy(target, {
    get: (_, name: string) => {
      const component = ChangeCase.paramCase(name) ?? 'div'
      const key = `${keyPrefix ?? 'default'}-${name}`
      if (!components.has(key)) {
        const root = createShadowDomRoot({render}, component)
        components.set(key, root)
      }
      return components.get(key)
    },
  })
}

export const ShadowDom = createShadowDomProxy()

export default ShadowDom
