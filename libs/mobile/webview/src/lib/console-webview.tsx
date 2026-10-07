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

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { BackHandler, Linking, Platform } from 'react-native'
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview'
import {
  bridgeInjectionScript,
  bridgeReplyScript,
  createBridgeNonce,
  isTrustedUrl,
  parseBridgeMessage,
  type BridgeReply,
  type BridgeRejection,
} from './bridge-protocol'

/*==========================================
 * THE AUTHENTICATED CONSOLE WEBVIEW (AGL-3618, AGL-3620).
 *
 * Renders one console page. The app signs the WebView in BEFORE mounting
 * this (`mintConsoleSession` in `@aglyn/mobile-core`), so this component
 * holds no credential; it only keeps the WebView on trusted origins and runs
 * the bridge:
 *
 * - A navigation to any other origin opens in the system browser and never
 *   loads inside the WebView, so the injected bridge exists only on console
 *   pages, and a link in a page can never become a page that holds it.
 * - Bridge calls go through `parseBridgeMessage` (origin, nonce, method
 *   allowlist) and the handler's own validation; replies are delivered only
 *   while the WebView is still on a trusted origin.
 * - Android's back button walks the WebView history before leaving the
 *   screen.
 *=========================================*/

export type BridgeHandler = (params: Record<string, unknown>) => Promise<unknown>

export interface ConsoleWebViewHandle {
  reload(): void
  goBack(): boolean
}

export interface ConsoleWebViewProps {
  url: string
  trustedOrigins: readonly string[]
  /** The global the page sees, e.g. `AglynPosBridge`. Omit for no bridge. */
  bridgeName?: string
  /** One handler per allowed method; the method list IS these keys. */
  handlers?: Record<string, BridgeHandler>
  /** Read-only facts exposed as `window[bridgeName].info`. */
  bridgeInfo?: Record<string, string | number | boolean>
  onRejectedMessage?: (reason: BridgeRejection) => void
  onLoadError?: (message: string) => void
  onNavigation?: (url: string) => void
  /** The trusted page asked to leave (sign-in page): the app signs in again. */
  onSignedOut?: () => void
  /** The page's title, for the native header; only a trusted page's is reported. */
  onTitleChange?: (title: string) => void
  /** The app theme's ground, so the WebView never flashes white in dark mode. */
  backgroundColor?: string
  testID?: string
}

/** A console page that means "this WebView has no session". */
export function isSignedOutUrl(url: string): boolean {
  return /^https?:\/\/[^/]+\/(signin|login|auth\/handoff\/start)(?:[/?#]|$)/i.test(url)
}

export const ConsoleWebView = forwardRef<ConsoleWebViewHandle, ConsoleWebViewProps>(
  function ConsoleWebView(props, ref) {
    const webview = useRef<WebView>(null)
    const currentUrl = useRef(props.url)
    const [canGoBack, setCanGoBack] = useState(false)
    // One nonce per mount: the injected script carries it, and the WebView
    // re-runs that script on every page load within this mount.
    const nonce = useMemo(() => createBridgeNonce(), [])
    const methods = useMemo(() => Object.keys(props.handlers ?? {}), [props.handlers])
    const injected = useMemo(
      () =>
        props.bridgeName && methods.length
          ? bridgeInjectionScript({
              globalName: props.bridgeName,
              nonce,
              methods,
              trustedOrigins: props.trustedOrigins,
              info: props.bridgeInfo,
            })
          : 'true;',
      [props.bridgeName, methods, nonce, props.trustedOrigins, props.bridgeInfo],
    )

    useImperativeHandle(ref, () => ({
      reload: () => webview.current?.reload(),
      goBack: () => {
        if (!canGoBack) return false
        webview.current?.goBack()
        return true
      },
    }))

    useEffect(() => {
      if (Platform.OS !== 'android') return
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (!canGoBack) return false
        webview.current?.goBack()
        return true
      })
      return () => subscription.remove()
    }, [canGoBack])

    const reply = useCallback(
      (message: BridgeReply) => {
        if (!props.bridgeName) return
        // The page may have navigated while the native side worked; an answer
        // goes only to a page on a trusted origin, never to whatever loaded.
        if (!isTrustedUrl(currentUrl.current, props.trustedOrigins)) return
        webview.current?.injectJavaScript(bridgeReplyScript(props.bridgeName, message))
      },
      [props.bridgeName, props.trustedOrigins],
    )

    const onMessage = useCallback(
      (event: WebViewMessageEvent) => {
        const parsed = parseBridgeMessage({
          data: event.nativeEvent.data,
          sourceUrl: event.nativeEvent.url,
          trustedOrigins: props.trustedOrigins,
          nonce,
          methods,
        })
        if (parsed.ok === false) {
          props.onRejectedMessage?.(parsed.reason)
          // A call that named its id gets a refusal rather than a promise
          // that never settles; an untrusted or forged one gets nothing.
          if (parsed.id && parsed.reason !== 'bad-nonce') {
            reply({ id: parsed.id, ok: false, error: 'The app does not support that.' })
          }
          return
        }
        const handler = props.handlers?.[parsed.request.method]
        if (!handler) return
        handler(parsed.request.params)
          .then((result) => reply({ id: parsed.request.id, ok: true, result: result ?? null }))
          .catch((error: unknown) =>
            reply({
              id: parsed.request.id,
              ok: false,
              error: error instanceof Error ? error.message : 'The app could not do that.',
            }),
          )
      },
      [methods, nonce, props, reply],
    )

    const onShouldStartLoadWithRequest = useCallback(
      (request: { url: string; isTopFrame?: boolean; navigationType?: string }) => {
        if (request.url.startsWith('about:') || request.url.startsWith('blob:')) return true
        if (isTrustedUrl(request.url, props.trustedOrigins)) return true
        // Subframes (an embedded map, a payment iframe) load in place; the
        // bridge script is main-frame only and never runs inside them. Only
        // https ones: a `javascript:` or `file:` frame is refused.
        if (request.isTopFrame === false) return /^https:/i.test(request.url)
        if (/^(https?|mailto|tel|sms):/i.test(request.url)) {
          Linking.openURL(request.url).catch(() => undefined)
        }
        return false
      },
      [props.trustedOrigins],
    )

    const onNavigationStateChange = useCallback(
      (state: WebViewNavigation) => {
        currentUrl.current = state.url
        setCanGoBack(state.canGoBack)
        props.onNavigation?.(state.url)
        const trusted = isTrustedUrl(state.url, props.trustedOrigins)
        if (trusted && state.title) props.onTitleChange?.(state.title)
        if (trusted && isSignedOutUrl(state.url)) {
          props.onSignedOut?.()
        }
      },
      [props],
    )

    return (
      <WebView
        ref={webview}
        testID={props.testID}
        source={{ uri: props.url }}
        style={props.backgroundColor ? { backgroundColor: props.backgroundColor } : undefined}
        originWhitelist={['https://*', 'http://localhost*', 'http://127.0.0.1*', 'http://10.0.2.2*']}
        injectedJavaScriptBeforeContentLoaded={injected}
        injectedJavaScriptForMainFrameOnly
        injectedJavaScriptBeforeContentLoadedForMainFrameOnly
        onMessage={onMessage}
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
        onNavigationStateChange={onNavigationStateChange}
        onError={(event) => props.onLoadError?.(event.nativeEvent.description || 'The page did not load.')}
        onHttpError={(event) => {
          if (event.nativeEvent.statusCode >= 500) {
            props.onLoadError?.('This page could not load. Pull to retry.')
          }
        }}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled={false}
        javaScriptCanOpenWindowsAutomatically={false}
        setSupportMultipleWindows={false}
        allowsBackForwardNavigationGestures
        pullToRefreshEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction
        allowFileAccess={false}
        allowingReadAccessToURL={undefined}
        webviewDebuggingEnabled={__DEV__}
        startInLoadingState
      />
    )
  },
)
