/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

//TODO: FIX ALL TYPINGS AND REFACTOR OPTIONS/PROPS

import React, {
  forwardRef,
  ForwardRefExoticComponent,
  PropsWithoutRef,
  ReactNode,
  RefAttributes,
  useEffect,
  ReactChild,
  useRef,
  useState,
  ElementType,
  ReactPortal,
  ReactElement,
} from 'react'
import { createPortal } from 'react-dom'

import useCombinedRefs from '../../hooks/use-combined-refs'
import { _isStr, _isFn, getDisplayName, ChangeCase } from '@aglyn/shared/util/helpers'

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
export type ShadowDomRootExoticComponent<T, P> = ForwardRefExoticComponent<
  PropsWithoutRef<ShadowDomRootProps> & RefAttributes<T>
>

export function ShadowDomContentPortal<T extends ShadowRoot>(props: ShadowDomContentProps<T>): ReactPortal {
  const { children, shadowRoot, key } = props
  return createPortal(children, (shadowRoot as unknown) as Element, key)
}

export function createShadowDomRoot<T, P>(
  options: ShadowDomRootFactoryOptions,
  Component
): ShadowDomRootExoticComponent<T, P> {
  const { render } = options
  const ShadowDomRoot = forwardRef<T, ShadowDomRootProps>(function RefRenderFn(props, ref) {
    const { mode, delegatesFocus, styleSheets, adoptedStyleSheets, children, ...rest } = props
    const localRef = useRef<T>(null)
    const elemRef = useCombinedRefs(localRef, ref)
    const [shadowRoot, setShadowRoot] = useState<ShadowRoot>(null)
    const key = `node_${mode}${delegatesFocus}`

    useEffect(() => {
      const instance = (localRef.current as unknown) as Element
      if (instance) {
        const root: unknown = instance.attachShadow({ mode, delegatesFocus })
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
      <Component key={key} ref={elemRef} {...((rest as unknown) as P)}>
        {shadowRoot ? (
          <ShadowDomContentPortal shadowRoot={shadowRoot}>
            {_isFn(render) ? render({ shadowRoot, children }) : children}
          </ShadowDomContentPortal>
        ) : null}
      </Component>
    )
  })

  const name = getDisplayName(Component, null) ?? _isStr(Component) ? Component : 'Component'
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
  const { keyPrefix, render: _renderFn } = options ?? {}
  const render = _renderFn ?? (({ children }: ShadowDomRootRenderProps) => children)

  return new Proxy(target, {
    get: (_, name: string) => {
      const component = ChangeCase.paramCase(name) ?? 'div'
      const key = `${keyPrefix ?? 'default'}-${name}`
      if (!components.has(key)) {
        const root = createShadowDomRoot({ render }, component)
        components.set(key, root)
      }
      return components.get(key)
    },
  })
}

export const ShadowDom = createShadowDomProxy()

export default ShadowDom
