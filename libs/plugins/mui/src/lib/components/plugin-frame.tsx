/**
 * @license
 * Copyright 2026 Aglyn LLC
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
'use client'

import * as Aglyn from '@aglyn/aglyn'
import * as PluginSdk from '@aglyn/aglyn'
import Box from '@mui/material/Box'
import {
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

/**
 * Host-side sandboxed plugin runtime (AGL-45), per AGL-43 §2. Renders an
 * installed executable plugin inside a cross-origin sandboxed iframe and
 * talks to it only through the capability-scoped postMessage bridge — the
 * plugin never runs in the console/tenant realm, so it has no ambient
 * access to host Firestore, auth, storage, or the DOM. Renders a safe
 * placeholder (never the plugin) whenever it can't run safely: no plugin
 * origin configured, the origin isn't cross-origin to this app, or the
 * version is revoked (kill switch).
 *
 * SANDBOX NOTE: `allow-scripts allow-same-origin` is correct HERE and only
 * here because `src` is a DEDICATED cross-origin (`pluginOrigin`). For a
 * cross-origin frame, `allow-same-origin` grants the frame ITS OWN
 * (plugin) origin's privileges — not the parent's — so it stays walled off
 * from the app while still being able to load its own bundle and honor the
 * plugin-origin CSP's `connect-src`. The combination is only unsafe for a
 * SAME-origin frame; `assertCrossOrigin` below refuses that case.
 */
export interface PluginFrameProps {
  /** Dedicated plugin origin, e.g. `https://plugins.aglyn.app`. */
  pluginOrigin?: string
  /** Host id, for scoping host-mediated fetch (AGL-191). */
  hostId?: string
  listingId: string
  version: string
  sha256: string
  /** Manifest capabilities (event allowlist, declared size). */
  capabilities?: Aglyn.PluginCapabilities
  /** Props to pass in; filtered to the manifest allowlist before sending. */
  pluginProps?: Record<string, unknown>
  /** True when the pinned version is revoked (from the revocations doc). */
  revoked?: boolean
  scheme?: 'light' | 'dark'
  title?: string
}

type FrameState = 'loading' | 'ready' | 'error'

/** The frame is only safe when its src origin differs from the app's. */
function assertCrossOrigin(pluginOrigin: string): boolean {
  if (typeof window === 'undefined') return true // SSR: render placeholder
  try {
    return new URL(pluginOrigin).origin !== window.location.origin
  } catch {
    return false
  }
}

interface PlaceholderProps {
  message: string
  height?: number
}

const Placeholder = forwardRef<HTMLDivElement, PlaceholderProps>(
  ({ message, height }, ref) => (
  <Box
    ref={ref}
    sx={{
      minHeight: height ?? 120,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      border: '1px dashed',
      borderColor: 'divider',
      borderRadius: 1,
      color: 'text.secondary',
      fontSize: 13,
      fontFamily: 'system-ui, sans-serif',
      p: 2,
      textAlign: 'center',
    }}
  >
    {message}
  </Box>
  ),
)
Placeholder.displayName = 'PluginFramePlaceholder'

const PluginFrame = forwardRef<HTMLIFrameElement, PluginFrameProps>(
  (props, ref) => {
    const {
      pluginOrigin,
      hostId,
      listingId,
      version,
      sha256,
      capabilities,
      pluginProps,
      revoked,
      scheme,
      title,
      ...rest
    } = props
    const frameRef = useRef<HTMLIFrameElement | null>(null)
    const [state, setState] = useState<FrameState>('loading')
    const [height, setHeight] = useState<number>(
      capabilities?.size?.height ?? 120,
    )

    const allowedEvents = capabilities?.events
    const allowedProps = capabilities?.props
    const filteredProps = useMemo(
      () => PluginSdk.filterPluginProps(pluginProps, allowedProps),
      [pluginProps, allowedProps],
    )
    // Stable dependency for the props-update effect.
    const filteredPropsKey = useMemo(
      () => JSON.stringify(filteredProps),
      [filteredProps],
    )

    const originUsable =
      Boolean(pluginOrigin) &&
      !revoked &&
      assertCrossOrigin(String(pluginOrigin))

    const src = useMemo(() => {
      if (!originUsable) return ''
      const url = new URL('/load', String(pluginOrigin))
      url.searchParams.set('listing', listingId)
      url.searchParams.set('v', version)
      url.searchParams.set('sha', sha256)
      return url.toString()
    }, [originUsable, pluginOrigin, listingId, version, sha256])

    // Bridge: validate every inbound message by origin + source + schema,
    // then honor resize / surface events / flag errors. Never eval or graft
    // anything from the frame — only sized output and named events.
    useEffect(() => {
      if (!originUsable) return
      const expectedOrigin = new URL(String(pluginOrigin)).origin
      const handleMessage = (event: MessageEvent) => {
        if (event.origin !== expectedOrigin) return
        if (event.source !== frameRef.current?.contentWindow) return
        const message = PluginSdk.parseGuestMessage(event.data, allowedEvents)
        if (!message) return
        switch (message.type) {
          case 'ready':
            setState('ready')
            frameRef.current?.contentWindow?.postMessage(
              {
                type: 'init',
                v: PluginSdk.PLUGIN_BRIDGE_VERSION,
                props: filteredProps,
                ...(scheme ? { scheme } : {}),
              },
              expectedOrigin,
            )
            break
          case 'resize':
            setHeight(Math.max(24, message.height))
            break
          case 'event':
            Aglyn.emitter?.emit?.(`plugin:${listingId}:${message.name}`, {
              listingId,
              name: message.name,
              payload: message.payload,
            })
            break
          case 'fetch-request': {
            // Host-mediated fetch (AGL-191): proxy through the host API,
            // which re-checks the manifest allowlist server-side. Reply on
            // the same id; a disallowed/failed call resolves ok:false.
            const requestId = message.id
            const respond = (payload: {
              ok: boolean
              status: number
              body?: string
              error?: string
            }) =>
              frameRef.current?.contentWindow?.postMessage(
                { type: 'fetch-response', v: PluginSdk.PLUGIN_BRIDGE_VERSION, id: requestId, ...payload },
                expectedOrigin,
              )
            if (!hostId) {
              respond({ ok: false, status: 0, error: 'No host context' })
              break
            }
            void fetch('/api/plugins/fetch', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                hostId,
                listingId,
                url: message.url,
                method: message.method,
                body: message.body,
              }),
            })
              .then((response) => response.json())
              .then((payload) =>
                respond({
                  ok: Boolean(payload?.ok),
                  status: Number(payload?.status ?? 0),
                  body: payload?.body,
                  error: payload?.error,
                }),
              )
              .catch(() =>
                respond({ ok: false, status: 0, error: 'Fetch failed' }),
              )
            break
          }
          case 'error':
            setState('error')
            break
        }
      }
      window.addEventListener('message', handleMessage)
      return () => window.removeEventListener('message', handleMessage)
      // filteredProps is re-sent by the effect below; init uses the latest.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [originUsable, pluginOrigin, hostId, listingId, allowedEvents, scheme, src])

    // Push prop updates to an already-ready frame.
    useEffect(() => {
      if (state !== 'ready' || !originUsable) return
      const expectedOrigin = new URL(String(pluginOrigin)).origin
      frameRef.current?.contentWindow?.postMessage(
        {
          type: 'props',
          v: PluginSdk.PLUGIN_BRIDGE_VERSION,
          props: filteredProps,
        },
        expectedOrigin,
      )
      // filteredPropsKey captures the serialized props identity.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filteredPropsKey, state, originUsable, pluginOrigin])

    if (revoked) {
      return (
        <Placeholder message="This plugin has been disabled by the platform." />
      )
    }
    if (!pluginOrigin) {
      return (
        <Placeholder message="Plugins are not enabled on this deployment." />
      )
    }
    if (!originUsable) {
      return (
        <Placeholder message="Plugin cannot be loaded safely here." />
      )
    }

    return (
      <Box sx={{ position: 'relative', width: '100%' }}>
        {state === 'error' ? (
          <Placeholder message="This plugin failed to load." height={height} />
        ) : (
          <Box
            component="iframe"
            ref={(node: HTMLIFrameElement | null) => {
              frameRef.current = node
              if (typeof ref === 'function') ref(node)
              else if (ref) ref.current = node
            }}
            src={src}
            title={title ?? 'Plugin'}
            // See SANDBOX NOTE — safe only because src is a cross-origin.
            sandbox="allow-scripts allow-same-origin"
            referrerPolicy="no-referrer"
            loading="lazy"
            onError={() => setState('error')}
            {...rest}
            sx={{
              width: '100%',
              height,
              border: 0,
              display: 'block',
              ...(state === 'loading' ? { visibility: 'hidden' } : {}),
            }}
          />
        )}
      </Box>
    )
  },
)
PluginFrame.displayName = 'AglynPluginFrame'

export { PluginFrame }
export default PluginFrame
