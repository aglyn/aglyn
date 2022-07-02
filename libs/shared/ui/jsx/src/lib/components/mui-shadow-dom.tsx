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

import { createEmotionCache } from '@aglyn/shared-ui-theme'
import { renderStylesToString } from '@emotion/server'
import { Portal } from '@mui/material'
import { paramCase } from 'change-case'
import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useState,
} from 'react'
import { renderToString } from 'react-dom/server'
import { useRefForked } from '../hooks/use-ref-forked'
import EmotionCacheProvider from './emotion-cache-provider'

export type ShadowRendererProps = {
  container?: Node
  ssr?: boolean
  children?: JSX.Children
}
export type ShadowRenderer = (props: ShadowRendererProps) => JSX.Node
export type CreateShadowRootOptions = {
  render: ShadowRenderer
}

export interface ShadowRootProps {
  mode?: 'open' | 'closed'
  delegatesFocus?: boolean
  styleSheets?: globalThis.CSSStyleSheet[]
  ssr?: boolean
  children?: JSX.Children
}

const tags = new Map()
const cacheMap = new WeakMap()
const ShadowDomContext = createContext<Element>(null)

export function useShadowDomContext() {
  return useContext(ShadowDomContext)
}

function handleError({ error, styleSheets, container }) {
  switch (error.name) {
    case 'NotSupportedError':
      styleSheets.length > 0 && (container.adoptedStyleSheets = styleSheets)
      break
    default:
      throw error
  }
}

export function withShadowRoot(
  Tag: any | keyof JSX.IntrinsicElements,
  options: CreateShadowRootOptions,
) {
  const { render } = options

  const ShadowRoot = forwardRef<Element, ShadowRootProps>((props, ref) => {
    const { mode, delegatesFocus, styleSheets, ssr, children, ...rest } = props
    const [_ref, local] = useRefForked(ref)
    const [container, setContainer] = useState(null)
    const key = `node_${mode}${delegatesFocus}`

    useEffect(() => {
      if (local.current) {
        try {
          if (ssr) {
            const root = local.current.shadowRoot
            setContainer(root)
            return
          }

          const root = local.current.attachShadow({
            mode,
            delegatesFocus,
          })

          if (styleSheets.length > 0) {
            container.adoptedStyleSheets = styleSheets
          }
          setContainer(root)
        } catch (error) {
          handleError({ error, styleSheets, container })
        }
      }
    }, [ref, local, styleSheets, ssr, mode, delegatesFocus, container])

    return (
      <Tag key={key} ref={_ref} {...rest}>
        {(container || ssr) && (
          <ShadowDomContext.Provider value={container}>
            {ssr ? (
              <template {...({ shadowroot: 'open' } as any)}>
                {render({
                  container,
                  ssr,
                  children,
                })}
              </template>
            ) : (
              <Portal container={() => container}>
                {render({
                  container,
                  ssr,
                  children,
                })}
              </Portal>
            )}
          </ShadowDomContext.Provider>
        )}
      </Tag>
    )
  })
  ShadowRoot.displayName = 'ShadowRoot'
  ShadowRoot.defaultProps = {
    mode: 'open',
    delegatesFocus: false,
    styleSheets: [],
    ssr: false,
    children: null,
  }

  return ShadowRoot
}

export function createShadowDomProxy(
  target: Partial<JSX.IntrinsicElementMap> = {},
  key = 'core',
  render: ShadowRenderer = ({ children }) => children,
) {
  return new Proxy(target, {
    get: function get(_, name) {
      const tag = paramCase(String(name), { delimiter: '-' })
      const id = `${key}-${tag}`

      if (!tags.has(id)) {
        tags.set(id, withShadowRoot(tag, { render }))
      }
      return tags.get(id)
    },
  })
}

function getStyles(children) {
  return renderStylesToString(renderToString(<>{children}</>))
}

export const MuiShadowDomRenderer = (props: ShadowRendererProps) => {
  const { ssr, container, children } = props
  const cache = !cacheMap.has(container)
    ? (() => {
        if (cacheMap.has(container)) return cacheMap.get(container)
        const cache = createEmotionCache({
          container,
          key: 'msd',
          prepend: true,
        })
        cacheMap.set(container, cache)
        return cache
      })()
    : cacheMap.get(container)

  if (ssr) {
    return (
      <>
        <style type="text/css">{getStyles(children)}</style>
        {children}
      </>
    )
  }

  return (
    <EmotionCacheProvider emotionCache={cache}>
      <>{children}</>
    </EmotionCacheProvider>
  )
}

const MuiShadowDom = createShadowDomProxy({}, 'mui', MuiShadowDomRenderer)

export { MuiShadowDom }
export default MuiShadowDom
