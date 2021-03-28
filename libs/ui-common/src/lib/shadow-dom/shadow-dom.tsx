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
} from 'react'
import { createPortal } from 'react-dom'

import { decamelize } from 'humps'

import useCombinedRefs from '../hooks/use-combined-refs'

declare global {
  /** POLYFILL FOR adoptedStyleSheets */
  interface ShadowRoot {
    adoptedStyleSheets?: StyleSheetList
  }
}

export type ShadowDomContentProps = {
  shadowRoot: ShadowRoot
  children: ReactNode
}

export function ShadowDomContentPortal(props: ShadowDomContentProps) {
  const { shadowRoot, children } = props
  return createPortal(children, shadowRoot as unknown as Element)
}

export type RenderProps = {
  shadowRoot: ShadowRoot
  children: ReactChild
}
export type ShadowDomRootFactoryParams = {
  component: string
  renderFn?: (props: RenderProps) => JSX.Element
}
export type ShadowDomRootProps = ShadowRootInit & {
  styleSheets?: string[]
  adoptedStyleSheets?: string[]
  children: ReactChild
}


function createShadowDomRoot<T>(params: ShadowDomRootFactoryParams): ForwardRefExoticComponent<PropsWithoutRef<ShadowDomRootProps> & RefAttributes<T>> {
  const { component, renderFn } = params
  const Component = component as any
  const ShadowDomRoot = forwardRef<T, ShadowDomRootProps>(
    function RefRenderFn(props, ref) {
      const { mode, delegatesFocus, styleSheets, adoptedStyleSheets, children, ...rest } = props
      const localRef = useRef<T>(null)
      const elemRef = useCombinedRefs(localRef, ref)
      const [shadowRoot, setShadowRoot] = useState<ShadowRoot>(null)
      const key = `node_${mode}${delegatesFocus}`

      useEffect(() => {
        const instance = localRef.current as unknown as Element
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
        <Component key={key} ref={elemRef} {...rest}>
          {shadowRoot ? (
            <ShadowDomContentPortal shadowRoot={shadowRoot}>
              {renderFn ? renderFn({shadowRoot, children}) : children}
            </ShadowDomContentPortal>
          ) : null}
        </Component>
      )
    }
  )

  ShadowDomRoot.displayName = 'ShadowDomRoot'
  ShadowDomRoot.defaultProps = {
    mode: 'open',
    delegatesFocus: false,
    styleSheets: [],
  }

  return ShadowDomRoot
}

const components = new Map()

export type Options = {
  keyPrefix?: string
  renderFn?: ShadowDomRootFactoryParams['renderFn']
}

export function createShadowDomProxy(target = {}, options?: Options) {
  const {keyPrefix, renderFn: _renderFn} = options ?? {}
  const renderFn: any = _renderFn ?? (({children}) => children)

  return new Proxy(target, {
    get: (_, name: string) => {
      const component = decamelize(name, { separator: '-' }) ?? 'div'
      const key = `${keyPrefix ?? 'default'}-${component}`
      if (!components.has(key)) {
        components.set(key, createShadowDomRoot({ component, renderFn }))
      }
      return components.get(key)
    },
  })
}

export const ShadowDom = createShadowDomProxy()

export default ShadowDom
