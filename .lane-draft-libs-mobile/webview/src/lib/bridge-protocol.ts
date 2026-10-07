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

/*==========================================
 * THE CONSOLE WEBVIEW BRIDGE PROTOCOL (AGL-3618).
 *
 * A console page running inside a native app's WebView may ask the app to do
 * something only the app can (take a card on Tap to Pay, read a Bluetooth
 * reader). The page sees one global object with a FIXED list of async
 * methods; each call becomes one JSON message to the app, and the app answers
 * by id. Nothing else crosses.
 *
 * Three checks stand between a message and a native action, and every one is
 * here, pure, so a spec can drive it:
 *
 * 1. ORIGIN. The WebView reports the URL of the document that posted. A
 *    message from any origin outside the trusted list is dropped, so a page
 *    the WebView was navigated to (a link, a redirect) can never reach the
 *    app, even though the injected script runs on it.
 * 2. NONCE. The script is injected with a random per-load nonce, and the app
 *    drops a message that does not carry it. A frame or script that never
 *    saw the injected source cannot forge a call.
 * 3. METHOD ALLOWLIST. A method not on the bridge's list is refused, and the
 *    params must be a plain object. What a method then accepts is the
 *    handler's own validation.
 *
 * Replies go back only after the same origin check on the WebView's CURRENT
 * URL, so an answer (a payment result) is never handed to a page that
 * navigated away mid-call.
 *=========================================*/

/** One call from the page. */
export interface BridgeRequest {
  id: string
  method: string
  params: Record<string, unknown>
}

/** The answer to one call. */
export type BridgeReply =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: string }

/** Why a message was dropped, for the app's own log. */
export type BridgeRejection =
  | 'untrusted-origin'
  | 'malformed'
  | 'bad-nonce'
  | 'unknown-method'

export type ParsedBridgeMessage =
  | { ok: true; request: BridgeRequest }
  | { ok: false; reason: BridgeRejection; id?: string }

/** The origin of a URL, or null for anything that is not http(s). */
export function originOf(url: string | null | undefined): string | null {
  if (typeof url !== 'string' || !url) return null
  const match = /^(https?):\/\/([^/?#]+)/i.exec(url.trim())
  if (!match) return null
  const scheme = match[1].toLowerCase()
  const authority = match[2].toLowerCase()
  // Credentials in the authority (`https://evil@trusted.com`) are refused
  // outright rather than parsed: they exist to confuse exactly this check.
  if (authority.includes('@')) return null
  const [host, port] = authority.split(':')
  if (!host) return null
  const defaultPort = scheme === 'https' ? '443' : '80'
  return port && port !== defaultPort ? `${scheme}://${host}:${port}` : `${scheme}://${host}`
}

/**
 * Whether `url` is on one of the trusted origins. Exact origin match only: no
 * suffix or wildcard, because `*.example.com` would admit every site a
 * customer publishes under the same parent domain.
 */
export function isTrustedUrl(url: string | null | undefined, trustedOrigins: readonly string[]): boolean {
  const origin = originOf(url)
  if (!origin) return false
  return trustedOrigins.some((trusted) => originOf(trusted) === origin)
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const METHOD_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,63}$/

/** The largest message the app reads; a bigger one is not a bridge call. */
export const MAX_BRIDGE_MESSAGE_BYTES = 16 * 1024

/**
 * Reads one `postMessage` payload. `sourceUrl` is what the WebView reports
 * for the posting document, never anything the message says about itself.
 */
export function parseBridgeMessage(input: {
  data: string
  sourceUrl: string | null | undefined
  trustedOrigins: readonly string[]
  nonce: string
  methods: readonly string[]
}): ParsedBridgeMessage {
  if (!isTrustedUrl(input.sourceUrl, input.trustedOrigins)) {
    return { ok: false, reason: 'untrusted-origin' }
  }
  if (typeof input.data !== 'string' || input.data.length > MAX_BRIDGE_MESSAGE_BYTES) {
    return { ok: false, reason: 'malformed' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(input.data)
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (!isPlainObject(parsed) || parsed['aglynBridge'] !== 1) {
    return { ok: false, reason: 'malformed' }
  }
  const id = parsed['id']
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return { ok: false, reason: 'malformed' }
  if (typeof parsed['nonce'] !== 'string' || !input.nonce || parsed['nonce'] !== input.nonce) {
    return { ok: false, reason: 'bad-nonce' }
  }
  const method = parsed['method']
  if (typeof method !== 'string' || !METHOD_PATTERN.test(method)) {
    return { ok: false, reason: 'malformed', id }
  }
  if (!input.methods.includes(method)) return { ok: false, reason: 'unknown-method', id }
  const params = parsed['params'] ?? {}
  if (!isPlainObject(params)) return { ok: false, reason: 'malformed', id }
  return { ok: true, request: { id, method, params } }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A nonce for one page load. `random` is injectable for specs. */
export function createBridgeNonce(random: () => number = Math.random): string {
  let nonce = ''
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  for (let index = 0; index < 32; index += 1) {
    nonce += alphabet[Math.floor(random() * alphabet.length) % alphabet.length]
  }
  return nonce
}

/** The JavaScript the app runs to deliver one reply into the page. */
export function bridgeReplyScript(globalName: string, reply: BridgeReply): string {
  // JSON is valid JavaScript, and a JSON-encoded string cannot close the
  // call it sits in. `\u2028`/`\u2029` are escaped for older engines that
  // read them as line terminators inside a string literal.
  const payload = JSON.stringify(reply).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  return `(function(){var b=window[${JSON.stringify(globalName)}];if(b&&b.__reply){b.__reply(${payload});}})();true;`
}

/**
 * The script injected before the page's own scripts: defines
 * `window[globalName]` with one promise-returning function per method, and
 * nothing else. The object is frozen and non-writable, so page code can call
 * it but not replace it with something that leaks the nonce elsewhere.
 */
export function bridgeInjectionScript(input: {
  globalName: string
  nonce: string
  methods: readonly string[]
  /** The script defines nothing on a document from any other origin. */
  trustedOrigins: readonly string[]
  /** Read-only facts the page may need before calling (e.g. a platform). */
  info?: Record<string, string | number | boolean>
}): string {
  for (const method of input.methods) {
    if (!METHOD_PATTERN.test(method)) throw new Error(`Invalid bridge method name: ${method}`)
  }
  const name = JSON.stringify(input.globalName)
  const nonce = JSON.stringify(input.nonce)
  const methods = JSON.stringify(input.methods)
  const info = JSON.stringify(input.info ?? {})
  const trusted = JSON.stringify(
    input.trustedOrigins.map((origin) => originOf(origin)).filter(Boolean),
  )
  return `(function(){
if (window[${name}] || !window.ReactNativeWebView) return;
if (${trusted}.indexOf(window.location.origin) < 0) return;
var pending = {};
var counter = 0;
function call(method, params) {
  return new Promise(function (resolve, reject) {
    counter += 1;
    var id = 'c' + counter + '_' + Date.now().toString(36);
    pending[id] = { resolve: resolve, reject: reject };
    window.ReactNativeWebView.postMessage(JSON.stringify({
      aglynBridge: 1, nonce: ${nonce}, id: id, method: method,
      params: params && typeof params === 'object' ? params : {}
    }));
  });
}
var bridge = { info: Object.freeze(${info}) };
${methods}.forEach(function (method) {
  bridge[method] = function (params) { return call(method, params); };
});
Object.defineProperty(bridge, '__reply', {
  value: function (reply) {
    var entry = reply && pending[reply.id];
    if (!entry) return;
    delete pending[reply.id];
    if (reply.ok) entry.resolve(reply.result);
    else entry.reject(new Error(String(reply.error || 'The app could not do that.')));
  }
});
Object.defineProperty(window, ${name}, { value: Object.freeze(bridge), writable: false, configurable: false });
try { window.dispatchEvent(new Event(${JSON.stringify(`${input.globalName}:ready`)})); } catch (e) {}
})();true;`
}
