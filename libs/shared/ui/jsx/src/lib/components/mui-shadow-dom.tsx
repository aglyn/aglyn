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

import { createLayeredEmotionCache } from '@aglyn/shared-ui-theme'
import { Portal } from '@mui/material'
import { kebabCase } from 'change-case'
import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
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
const ShadowDomContext = createContext<Node>(null)

export function useMuiShadowDomContext() {
  return useContext(ShadowDomContext)
}

function handleError({ error, styleSheets, container }: { error: any; styleSheets: CSSStyleSheet[]; container: any }) {
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
    const local = useRef<Element | null>(null)
    const [container, setContainer] = useState<ShadowRoot | null>(null)
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
              <Portal container={() => container as unknown as Element}>
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
      const tag = kebabCase(String(name))
      const id = `${key}-${tag}`

      if (!tags.has(id)) {
        tags.set(id, withMuiShadowRoot(tag, { render }))
      }
      return tags.get(id)
    },
  })
}

export const MuiShadowDomRenderer = (props: MuiShadowRendererProps) => {
  // AGL-1316: the `ssr` branch (renderToString + emotion style extraction) was
  // removed — it was dormant (no consumer passes `ssr`) and its static
  // `react-dom/server` import shipped the full server renderer in the shared
  // client chunk. Reintroduce via `await import('react-dom/server')` if ever needed.
  const { container, children } = props
  const cache = !cacheMap.has(container)
    ? (() => {
        if (cacheMap.has(container)) return cacheMap.get(container)
        // AGL-2486: LAYERED, exactly as the published document is. The
        // canvas renders site content through this cache; the tenant renders
        // the same content through `AppRouterCacheProvider`, whose
        // `enableCssLayer` wraps every rule in `@layer mui`. When this cache
        // was plain (measured: 183 unlayered `.msd-*` rules in the canvas
        // shadow root, against the tenant's 72 layer blocks and zero
        // unlayered `.mui-*`), any CSS that does NOT pass through emotion — a
        // Custom HTML `css` block, a realm plugin's stylesheet — beat every
        // component and `sx` rule on the published page regardless of
        // specificity, while merely competing on specificity here. That is
        // "what you see is not what you publish". See
        // `createLayeredEmotionCache` for the measurements and for why the
        // editor is the side that had to move.
        const cache = createLayeredEmotionCache({
          container,
          key: 'msd',
          prepend: true,
        })
        cacheMap.set(container, cache)
        return cache
      })()
    : cacheMap.get(container)

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
