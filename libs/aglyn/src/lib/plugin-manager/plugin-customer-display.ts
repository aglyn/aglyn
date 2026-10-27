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

/**
 * A PLUGIN'S SCREEN ON A PAIRED CUSTOMER DISPLAY (AGL-4042).
 *
 * A register can pair a screen that faces the customer (AGL-3608). That
 * screen belongs to the plugin that runs the register, and until now it
 * could show only that plugin's own prompts — a basket, a tip, a receipt
 * choice. Another plugin that needs the customer's own hands on a screen
 * (a form to fill in, a document to sign) had no way to ask for it.
 *
 * So the seam has two halves, and neither names the other plugin:
 *
 * 1. A **display host**: the page running a register with a connected
 *    display registers itself here ({@link registerCustomerDisplayHost}) while
 *    it can show something, and unregisters when it can't. Any plugin's
 *    console widget on that page asks {@link customerDisplayHost} and, when
 *    there is one, hands it a {@link CustomerDisplayScreen}.
 * 2. A **screen** is one of the asking plugin's own public console pages
 *    (`ConsolePublicPage`, served at `/kiosk/{pluginId}{path}` with no staff
 *    session), with a few short parameters — typically a grant the plugin's
 *    own server minted and will check. The display opens it, and the page
 *    sends the display back to where it came from
 *    ({@link customerDisplayReturnPath}) when the customer is done.
 *
 * The display opens only a page the plugin DECLARED public: the console's
 * public route refuses any other before a byte of the plugin loads. The
 * parameters are capped and plain, because they ride the display's state and
 * its address bar; they must never carry a customer's details.
 *
 * Client-only, React-free, and reached by its own subpath, never the barrel:
 * a published page has no use for it.
 */

/** What a plugin asks a paired display to show. */
export interface CustomerDisplayScreen {
  /** The plugin whose public page it is. */
  pluginId: string
  /** The page's path beneath `/kiosk/{pluginId}`, with its leading slash: `/display-sign`. */
  path: string
  /** Short plain values the page reads from its query string. Never a customer's details. */
  params: Record<string, string>
}

/** How long a screen a register put on its display stays worth opening. */
export const CUSTOMER_DISPLAY_SCREEN_TTL_MS = 30 * 60 * 1000

/** The query key a screen's page reads the display's own address from. */
export const CUSTOMER_DISPLAY_RETURN_PARAM = 'return'

const PLUGIN_ID = /^[a-z0-9][a-z0-9-]{0,63}$/
const PATH = /^(\/[a-z0-9][a-z0-9-]{0,63}){1,4}$/
const PARAM_KEY = /^[a-zA-Z][a-zA-Z0-9]{0,31}$/
const MAX_PARAMS = 8
const MAX_PARAM_LENGTH = 2000
/** A display's own address: a public console page, and nothing that leaves it. */
const RETURN_PATH = /^\/kiosk(\/[a-z0-9][a-z0-9-]{0,63}){1,5}$/

/**
 * A screen as a register may store it, or `null` for anything else: a plugin
 * id and a public page path in their own shapes, and at most eight short
 * string parameters with plain keys. The return address is never one of
 * them; the display adds its own.
 */
export function sanitizeCustomerDisplayScreen(raw: unknown): CustomerDisplayScreen | null {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const pluginId = String(input['pluginId'] ?? '')
  const path = String(input['path'] ?? '')
  if (!PLUGIN_ID.test(pluginId) || !PATH.test(path)) return null
  const rawParams = (input['params'] && typeof input['params'] === 'object' ? input['params'] : {}) as Record<
    string,
    unknown
  >
  const entries = Object.entries(rawParams)
  if (entries.length > MAX_PARAMS) return null
  const params: Record<string, string> = {}
  for (const [key, value] of entries) {
    if (!PARAM_KEY.test(key) || key === CUSTOMER_DISPLAY_RETURN_PARAM || typeof value !== 'string') return null
    if (value.length > MAX_PARAM_LENGTH) return null
    params[key] = value
  }
  return { pluginId, path, params }
}

/** Whether a path is a display's own address, which a screen may send it back to. */
export function isCustomerDisplayReturnPath(path: unknown): path is string {
  return typeof path === 'string' && RETURN_PATH.test(path)
}

/**
 * Where a display opens a screen: the plugin's public page with the screen's
 * parameters and, under {@link CUSTOMER_DISPLAY_RETURN_PARAM}, the display's
 * own address to come back to. `null` for a screen or a return address out
 * of shape.
 */
export function customerDisplayScreenHref(screen: CustomerDisplayScreen, returnTo: string): string | null {
  const clean = sanitizeCustomerDisplayScreen(screen)
  if (!clean || !isCustomerDisplayReturnPath(returnTo)) return null
  const query = new URLSearchParams({ ...clean.params, [CUSTOMER_DISPLAY_RETURN_PARAM]: returnTo })
  return `/kiosk/${clean.pluginId}${clean.path}?${query.toString()}`
}

/** The address a screen's page sends the display back to, from its query string, or `null`. */
export function customerDisplayReturnPath(search: string): string | null {
  const value = new URLSearchParams(search).get(CUSTOMER_DISPLAY_RETURN_PARAM)
  return isCustomerDisplayReturnPath(value) ? value : null
}

/** What the page running a register offers while it has a display to show things on. */
export interface CustomerDisplayHost {
  /** Puts a plugin's screen on the display; `false` when it could not. */
  show(screen: CustomerDisplayScreen): Promise<boolean>
}

interface HostRegistry {
  host: CustomerDisplayHost | null
  listeners: Set<() => void>
}

/**
 * One registry per JavaScript realm, on `globalThis` under `Symbol.for`
 * (AGL-3947), so two copies of this module in one bundle agree on whether a
 * display is there.
 */
const REGISTRY_KEY = Symbol.for('@aglyn/aglyn:customer-display-host')
const globalScope = globalThis as typeof globalThis & { [REGISTRY_KEY]?: HostRegistry }
const registry: HostRegistry =
  globalScope[REGISTRY_KEY] ?? (globalScope[REGISTRY_KEY] = { host: null, listeners: new Set() })

const notify = () => {
  for (const listener of [...registry.listeners]) listener()
}

/**
 * Offers a display host to every plugin on the page, replacing any other;
 * answers the function that withdraws it (and only it).
 */
export function registerCustomerDisplayHost(host: CustomerDisplayHost): () => void {
  registry.host = host
  notify()
  return () => {
    if (registry.host !== host) return
    registry.host = null
    notify()
  }
}

/** The display host on this page, or `null` when no register here has a display to show on. */
export function customerDisplayHost(): CustomerDisplayHost | null {
  return registry.host
}

/** Calls `listener` whenever a host arrives or leaves; answers the unsubscribe. */
export function subscribeCustomerDisplayHost(listener: () => void): () => void {
  registry.listeners.add(listener)
  return () => {
    registry.listeners.delete(listener)
  }
}
