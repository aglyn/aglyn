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

import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'
import { sanitizeCustomerDisplayScreen, type CustomerDisplayScreen } from './plugin-customer-display'

/**
 * WHO A PAIRED CUSTOMER DISPLAY IS, for a plugin's server (AGL-4042).
 *
 * A screen's page on a paired display (`plugin-customer-display`) has no
 * staff session. It sends its own plugin's server the credential the display
 * was paired with, and that server asks here who the display is: the store
 * it is paired to, the screen it is showing now, and who put that screen
 * there. The pairing IS the authorization: staff paired the display to one
 * store, so what it shows is that store's to show, for as long as it shows
 * it. Nothing is minted per screen and nothing has to be opened or closed.
 *
 * The plugin that pairs displays registers the one verifier, from its
 * `consoleServerDeclarations`; the plugin asking never learns which plugin
 * that is, and core names neither. With no verifier registered, or one that
 * throws, every credential is refused: a display nobody can vouch for
 * signs nothing.
 */

/** A paired display, as its verifier vouches for it. */
export interface VerifiedCustomerDisplay {
  /** The store (site) the display is paired to. */
  hostId: string
  /** The workspace that owns that store. */
  orgId: string
  /** The plugin screen the display is showing now, or `null` for the register's own screens. */
  screen: CustomerDisplayScreen | null
  /** The staff member (uid) who put {@link screen} on the display, when it is showing one. */
  shownBy: string | null
}

export interface CustomerDisplayVerifier {
  /** The display a credential opens, or `null` for one that opens none. May throw. */
  verify(credential: string): Promise<VerifiedCustomerDisplay | null>
}

export const CUSTOMER_DISPLAY_VERIFIER = definePluginServiceContract<CustomerDisplayVerifier>(
  'core.customer-display.verifier',
  { multiple: false },
)

/**
 * Fills the slot. The owner is the loader's marker when a register fn is
 * running, else `options.pluginId`; a second plugin's verifier is refused
 * naming both.
 */
export function registerCustomerDisplayVerifier(
  verifier: CustomerDisplayVerifier,
  options?: { pluginId?: string },
): void {
  registerPluginService(CUSTOMER_DISPLAY_VERIFIER, verifier, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

const CREDENTIAL = /^[A-Za-z0-9_.~-]{16,512}$/
const ID = /^[A-Za-z0-9_-]{1,128}$/

/**
 * The display a credential opens, or `null`: a credential out of shape, no
 * verifier in this process, a verifier that refuses it or throws, or an
 * answer out of shape. A screen in the answer is passed through core's own
 * sanitizer, so a caller compares a screen in the shape it asked for.
 */
export async function verifyCustomerDisplay(credential: unknown): Promise<VerifiedCustomerDisplay | null> {
  if (typeof credential !== 'string' || !CREDENTIAL.test(credential)) return null
  const verifier = resolvePluginServices(CUSTOMER_DISPLAY_VERIFIER)[0]?.impl
  if (!verifier) return null
  let answer: VerifiedCustomerDisplay | null
  try {
    answer = await verifier.verify(credential)
  } catch (error) {
    console.error('[customer-display] the verifier failed', error)
    return null
  }
  if (!answer || !ID.test(String(answer.hostId ?? '')) || !ID.test(String(answer.orgId ?? ''))) return null
  const screen = answer.screen ? sanitizeCustomerDisplayScreen(answer.screen) : null
  const shownBy = screen && typeof answer.shownBy === 'string' && ID.test(answer.shownBy) ? answer.shownBy : null
  return { hostId: answer.hostId, orgId: answer.orgId, screen, shownBy }
}

/**
 * Whether a verified display is showing a plugin's screen: its plugin and
 * page, and every parameter given here with the same value. What a screen's
 * server asks before it acts for the display, and what its page asks to
 * follow the register: once the register shows something else, the answer
 * is `false`.
 */
export function customerDisplayShows(
  display: VerifiedCustomerDisplay | null,
  screen: { pluginId: string; path: string; params?: Record<string, string> },
): boolean {
  const showing = display?.screen
  if (!showing || showing.pluginId !== screen.pluginId || showing.path !== screen.path) return false
  return Object.entries(screen.params ?? {}).every(([key, value]) => showing.params[key] === value)
}
