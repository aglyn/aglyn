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

import { createEmotionCache } from '@aglyn/shared-ui-theme'
import { renderStylesToString } from '@emotion/server'
import { Portal } from '@mui/material'
import { paramCase } from 'change-case'
import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { renderToString } from 'react-dom/server'
import { useMergeRefs } from '../hooks/use-merge-refs'
import EmotionCacheProvider from './emotion-cache-provider'

export type MuiShadowRendererProps = {
  container?: Node
  ssr?: boolean
  children?: JSX.Children
}
export type MuiShadowRenderer = (props: MuiShadowRendererProps) => JSX.Node
export type CreateShadowRootOptions = {
  render: MuiShadowRenderer
}

export interface MuiShadowRootProps {
  mode?: 'open' | 'closed'
  delegatesFocus?: boolean
  styleSheets?: globalThis.CSSStyleSheet[]
  ssr?: boolean
  children?: JSX.Children
}

const tags = new Map()
const cacheMap = new WeakMap()
const ShadowDomContext = createContext<Element>(null)

export function useMuiShadowDomContext() {
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

export function withMuiShadowRoot(
  Tag: any | keyof JSX.IntrinsicElements,
  options: CreateShadowRootOptions,
) {
  const { render } = options

  const ShadowRoot = forwardRef<Element, MuiShadowRootProps>((props, ref) => {
    const {
      mode = 'open',
      delegatesFocus,
      styleSheets = [],
      ssr,
      children,
      ...rest
    } = props
    const local = useRef<Element>()
    const [container, setContainer] = useState(null)
    const key = `node_${mode}${delegatesFocus}`

    useEffect(() => {
      const node = local.current
      if (!node) return void 0
      try {
        let shadowRoot: ShadowRoot = null

        if (ssr) shadowRoot = node.shadowRoot
        else {
          shadowRoot = local.current.attachShadow({ mode, delegatesFocus })
          shadowRoot.adoptedStyleSheets = styleSheets
        }

        setContainer(shadowRoot)
      } catch (error) {
        handleError({ error, styleSheets, container })
      }
    }, [styleSheets, ssr, mode, delegatesFocus, container])

    return (
      <Tag key={key} ref={useMergeRefs(ref, local)} {...rest}>
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

  return ShadowRoot
}

export function createMuiShadowDomProxy(
  target: Partial<JSX.IntrinsicElementMap> = {},
  key = 'core',
  render: MuiShadowRenderer = ({ children }) => children,
) {
  return new Proxy(target, {
    get: function get(_, name) {
      const tag = paramCase(String(name), { delimiter: '-' })
      const id = `${key}-${tag}`

      if (!tags.has(id)) {
        tags.set(id, withMuiShadowRoot(tag, { render }))
      }
      return tags.get(id)
    },
  })
}

function getStyles(children) {
  return renderStylesToString(renderToString(<>{children}</>))
}

export const MuiShadowDomRenderer = (props: MuiShadowRendererProps) => {
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

export const MuiShadowDom = createMuiShadowDomProxy(
  {},
  'mui',
  MuiShadowDomRenderer,
)

export default MuiShadowDom
