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
 * Two process-global registries, last writer wins (AGL-2484).
 *
 * Both were documented as idempotent — "re-registration replaces the previous
 * handler", "idempotent per key" — which is the right behaviour for the same
 * plugin registering twice (hot reload, a second surface, a repeated init)
 * and the wrong behaviour for a DIFFERENT plugin arriving at the same name.
 *
 *   - `registerPluginApiRoute` keys on the path alone. Aglyn's own
 *     commission-taking handlers sit at `marketplace/checkout` and
 *     `commerce/checkout`, and the tenant dispatcher calls
 *     `ensureRemoteServerBundles()` AFTER the first-party loader — so the
 *     later registration is the remote one, and it wins.
 *   - `registerPluginPermissions` keys on `permission.key` alone, so a
 *     bundle can redeclare `managePos` with `defaults.viewer = true` and
 *     move a verdict that `pos-order.ts` enforces server-side.
 *
 * Reaching either needs `PLUGIN_REMOTE_SERVER=enabled` (off by default),
 * realm trust, and a valid signature, so this is defence in depth rather
 * than a live breach. It is also the cheap half of that stack: the registries
 * know who registered what and simply did not look.
 *
 * Every refusal is paired with the same-owner case, because a registry that
 * refuses everything would break every hot reload in the repo and pass every
 * "the intruder did not win" assertion here.
 */

import {
  listPluginApiRoutes,
  pluginIdForRegisteredApiPath,
  registerPluginApiRoute,
  resolvePluginApiRoute,
  unregisterPluginApiRoute,
} from './api-plugins'
import { setRegisteringPluginId } from './registering-plugin'
import {
  listPluginPermissions,
  registerPluginPermissions,
} from '../plugin-manager/plugin-permissions'

/** Registers the way the loader does: with the owner marker set. */
function registerAs(
  pluginId: string | undefined,
  path: string,
  handler: () => void,
) {
  setRegisteringPluginId(pluginId)
  try {
    registerPluginApiRoute(path, handler as never)
  } finally {
    setRegisteringPluginId(undefined)
  }
}

afterEach(() => {
  for (const path of listPluginApiRoutes()) unregisterPluginApiRoute(path)
  setRegisteringPluginId(undefined)
})

describe('an API path belongs to the plugin that claimed it (AGL-2484)', () => {
  it('refuses a second plugin the path, keeping the first handler', () => {
    const first = function incumbentHandler() {}
    const second = function intruderHandler() {}
    registerAs('commerce', 'commerce/checkout', first)
    registerAs('evil-bundle', 'commerce/checkout', second)
    expect(resolvePluginApiRoute('commerce/checkout')).toBe(first)
    // Ownership is what the per-request org gate reads. If the intruder took
    // that too, a disabled plugin's paths would answer for an enabled one.
    expect(pluginIdForRegisteredApiPath('commerce/checkout')).toBe('commerce')
  })

  it('refuses regardless of how the intruder spells the path', () => {
    const first = function incumbentHandler() {}
    const second = function intruderHandler() {}
    registerAs('marketplace', 'marketplace/checkout', first)
    registerAs('evil-bundle', '/marketplace/checkout/', second)
    expect(resolvePluginApiRoute('marketplace/checkout')).toBe(first)
  })

  it('CONTROL: the SAME plugin may re-register — hot reload must work', () => {
    const first = function incumbentHandler() {}
    const second = function intruderHandler() {}
    registerAs('commerce', 'commerce/checkout', first)
    registerAs('commerce', 'commerce/checkout', second)
    expect(resolvePluginApiRoute('commerce/checkout')).toBe(second)
    expect(pluginIdForRegisteredApiPath('commerce/checkout')).toBe('commerce')
  })

  it('CONTROL: releasing a path lets the next plugin claim it', () => {
    const first = function incumbentHandler() {}
    const second = function intruderHandler() {}
    registerAs('commerce', 'commerce/checkout', first)
    unregisterPluginApiRoute('commerce/checkout')
    registerAs('other', 'commerce/checkout', second)
    // Without this, the refusal would be permanent for the life of the
    // process and an unregister would silently stop working.
    expect(resolvePluginApiRoute('commerce/checkout')).toBe(second)
    expect(pluginIdForRegisteredApiPath('commerce/checkout')).toBe('other')
  })

  it('CONTROL: an unowned registration still replaces an unowned one', () => {
    // The pre-existing documented behaviour outside a loader context.
    const first = function incumbentHandler() {}
    const second = function intruderHandler() {}
    registerAs(undefined, 'plain/path', first)
    registerAs(undefined, 'plain/path', second)
    expect(resolvePluginApiRoute('plain/path')).toBe(second)
  })

  it('does not let an owned registration capture an unowned path', () => {
    // Anonymous is an identity here, not a wildcard: a route registered
    // outside a loader context is still not the remote bundle's to take.
    const first = function incumbentHandler() {}
    const second = function intruderHandler() {}
    registerAs(undefined, 'plain/path', first)
    registerAs('evil-bundle', 'plain/path', second)
    expect(resolvePluginApiRoute('plain/path')).toBe(first)
  })
})

const permission = (key: string, pluginId: string, viewer: boolean) => ({
  key,
  pluginId,
  label: key,
  defaults: { admin: true, editor: false, viewer },
})

/** The stored record for a key, or undefined. */
const stored = (key: string) =>
  listPluginPermissions().find((entry) => entry.key === key)

describe('a permission key belongs to the plugin that declared it (AGL-2484)', () => {
  it('refuses another plugin the key, keeping the original defaults', () => {
    registerPluginPermissions([permission('managePos', 'commerce', false)])
    registerPluginPermissions([permission('managePos', 'evil-bundle', true)])
    expect(stored('managePos')?.pluginId).toBe('commerce')
    // The field that matters: `pos-order.ts` enforces this verdict on the
    // server, so flipping it grants a viewer the register.
    expect(stored('managePos')?.defaults.viewer).toBe(false)
  })

  it('CONTROL: the declaring plugin may re-register and update its own', () => {
    registerPluginPermissions([permission('manageStock', 'commerce', false)])
    registerPluginPermissions([permission('manageStock', 'commerce', true)])
    expect(stored('manageStock')?.defaults.viewer).toBe(true)
  })

  it('CONTROL: a key nobody has claimed still registers', () => {
    registerPluginPermissions([permission('manageFresh', 'newcomer', true)])
    expect(stored('manageFresh')?.pluginId).toBe('newcomer')
  })

  it('rejects only the colliding key, not the rest of the batch', () => {
    registerPluginPermissions([permission('manageTaken', 'commerce', false)])
    registerPluginPermissions([
      permission('manageTaken', 'evil-bundle', true),
      permission('manageOwnKey', 'evil-bundle', true),
    ])
    expect(stored('manageTaken')?.pluginId).toBe('commerce')
    expect(stored('manageOwnKey')?.pluginId).toBe('evil-bundle')
  })
})
