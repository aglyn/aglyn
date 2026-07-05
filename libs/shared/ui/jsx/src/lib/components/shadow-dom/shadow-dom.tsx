/**
 * @license
 * Copyright 2023 Aglyn LLC
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

import { paramCase } from '@aglyn/shared-util-vendor'
import { createContext, forwardRef, useContext, useState } from 'react'
import { createPortal } from 'react-dom'
import { useEnsuredForwardedRef, useIsomorphicLayoutEffect } from 'react-use'

export const ShadowDomContext = createContext(null)

export function useShadowDomContext() {
  return useContext(ShadowDomContext)
}

export interface ShadowContentPortalProps {
  root: ShadowRoot
  children?: JSX.Children
}

function ShadowDomContentPortal(props: ShadowContentPortalProps) {
  const { root, children = null } = props
  return createPortal(children, root)
}

export interface BaseProps {
  mode?: 'open' | 'closed'
  delegatesFocus?: boolean
  styleSheets?: globalThis.CSSStyleSheet[]
  ssr?: boolean
  children?: JSX.Children
}

export type RenderProp = (props: {
  root: ShadowRoot
  ssr?: boolean
  children?: JSX.Children
}) => JSX.Children

export type FactoryOptions<P = any> = {
  tag: string
  render: RenderProp
}

export function shadowDomRootFactory<P = any>(options: FactoryOptions<P>) {
  const ShadowDomRoot = forwardRef<any, P & BaseProps>((props, ref) => {
    const {
      mode = 'open',
      delegatesFocus = false,
      styleSheets = [],
      ssr = false,
      children = null,
      ...rest
    } = props
    const node = useEnsuredForwardedRef<HTMLElement>(ref as any)
    const [root, setRoot] = useState<ShadowRoot | null>(null)
    const key = `node_${mode}${delegatesFocus}`
    const Tag = options.tag

    useIsomorphicLayoutEffect(() => {
      if (!node.current) return

      try {
        typeof ref === 'function' && ref(node.current)

        if (ssr) return setRoot(node.current.shadowRoot)

        const root = node.current.attachShadow({
          mode,
          delegatesFocus,
        })
        styleSheets.length > 0 && (root.adoptedStyleSheets = styleSheets)
        setRoot(root)
      } catch (error) {
        if ((error as Error)?.name !== 'NotSupportedError') throw error
        styleSheets.length > 0 && (root.adoptedStyleSheets = styleSheets)
      }
    }, [styleSheets, delegatesFocus, mode, ssr])

    return (
      <>
        <Tag key={key} ref={node} {...rest}>
          {(root || ssr) && (
            <ShadowDomContext.Provider value={root}>
              {ssr ? (
                // @ts-expect-error — declarative shadowroot attr is not in React types
                (<template shadowroot="open">
                  {options.render?.({ root, ssr, children })}
                </template>)
              ) : (
                <ShadowDomContentPortal root={root}>
                  {options.render?.({ root, ssr, children })}
                </ShadowDomContentPortal>
              )}
            </ShadowDomContext.Provider>
          )}
        </Tag>
      </>
    );
  })
  ShadowDomRoot.displayName = 'ShadowDomRoot'

  return ShadowDomRoot
}

const tags = new Map()

export function createShadowDomProxy(
  target: Record<string, ReturnType<typeof shadowDomRootFactory>> = {},
  id = 'sdp-',
  render: RenderProp = ({ children }) => children,
) {
  return new Proxy(target, {
    get: function get(_, name) {
      const tag = paramCase(name as string)
      const key = `${id}${tag}`

      if (!tags.has(key)) {
        tags.set(key, shadowDomRootFactory({ tag, render }))
      }

      return tags.get(key)
    },
  })
}

export const ShadowDom = createShadowDomProxy()

export default ShadowDom
