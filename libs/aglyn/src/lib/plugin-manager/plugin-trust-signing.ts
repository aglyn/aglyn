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
 * WHO HOLDS THE PLATFORM'S TRUST KEY (AGL-3080).
 *
 * Realm trust is the strongest grant in the platform: it drops a marketplace
 * bundle into the app realm, where neither the sandbox iframe nor the
 * manifest CSP stands between it and user data. A grant is an Ed25519
 * signature, made with `PLUGIN_TRUST_PRIVATE_KEY`, over the reviewed
 * version's sha256 — and every loader verifies it before a byte executes.
 *
 * ## Why this is a seam rather than a move
 *
 * The queue around it is the MARKETPLACE's: `marketplaceListings` is its
 * collection, "a version must have passed review" is its rule, and the
 * fields the grant writes are its documents. All of that belongs with the
 * plugin, the way the review queue and the report queue already do.
 *
 * The KEY does not. It is deployed to the console and nowhere else — never
 * to a tenant runtime — and this package is published to npm, where a
 * self-hoster generates their own pair. A plugin that read the key directly
 * would put the platform's signing authority inside a package anyone can
 * install, to no benefit: the plugin has nothing to do with it beyond
 * wanting one string signed.
 *
 * So the shell signs, and the marketplace decides what is worth signing.
 * The sibling of `core.site-cache`, and the same direction: the shell
 * offering a capability down.
 *
 * ## ⛔ AN ABSENT SIGNER REFUSES. IT DOES NOT GRANT.
 *
 * This is the opposite failure direction from every other contract here, and
 * it is the one that matters. `core.site-cache` answers `complete: false`
 * and the caller carries on, because a stale cache is survivable. An
 * unsigned realm grant is not survivable: the loaders fail closed on a
 * missing signature, so a "grant" without one produces a version that is
 * marked trusted and cannot load — or, far worse if a loader is ever
 * lenient, one that loads unverified.
 *
 * {@link signPluginTrust} therefore never returns a bare string. It answers
 * `{ signed: false, reason }` when nothing is registered, when the
 * deployment has no key, or when signing throws, and the caller MUST refuse
 * the grant on it rather than writing a partial one.
 */

import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginService,
} from './plugin-services'

export interface PluginTrustSignature {
  /** Base64 Ed25519 signature over the sha256 hex. Absent unless `signed`. */
  signature?: string
  /**
   * Whether a signature was produced. FALSE when nothing is registered, the
   * deployment holds no key, or signing failed — and a caller must refuse
   * the grant, never write one without a signature.
   */
  signed: boolean
  /** Why not, in the operator's terms, when `signed` is false. */
  reason?: string
}

export interface PluginTrustSigner {
  /** Signs a version's sha256 hex with the platform's Ed25519 key. */
  sign(sha256: string): Promise<PluginTrustSignature>
}

/**
 * One implementation: the app that holds the key. A second would be a second
 * signing authority, and the loaders verify against ONE public key.
 */
export const PLUGIN_TRUST_SIGNER =
  definePluginServiceContract<PluginTrustSigner>('core.plugin-trust-signer', {
    multiple: false,
  })

/** Installs the app's signer. Called once, at server boot. */
export function registerPluginTrustSigner(
  signer: PluginTrustSigner,
  options?: { pluginId?: string },
): void {
  if (typeof signer?.sign !== 'function') {
    throw new Error('a plugin trust signer needs a sign function')
  }
  registerPluginService(PLUGIN_TRUST_SIGNER, signer, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

/** Whether this deployment can sign at all — for a surface that says so. */
export function hasPluginTrustSigner(): boolean {
  return Boolean(resolvePluginService(PLUGIN_TRUST_SIGNER))
}

/**
 * Signs `sha256`, or says why it could not.
 *
 * NEVER THROWS, and never answers a signature it did not make. Read
 * `signed` before reading `signature`; see the module docblock for why a
 * caller must refuse rather than continue.
 */
export async function signPluginTrust(
  sha256: string,
): Promise<PluginTrustSignature> {
  const digest = sha256?.trim()
  if (!digest) {
    return { signed: false, reason: 'No version hash to sign.' }
  }
  const signer = resolvePluginService(PLUGIN_TRUST_SIGNER)
  if (!signer) {
    console.error(
      '[trust-signer] no implementation is installed, so realm trust cannot ' +
        'be granted. The app registers this at boot.',
    )
    return {
      signed: false,
      reason: 'Trust signing is not available on this deployment.',
    }
  }
  try {
    const result = await signer.sign(digest)
    // A signer that answered `signed` with nothing to show is a bug in the
    // signer, and granting on it would write the trust flag with no
    // signature — the one state the loaders cannot distinguish from tampering.
    if (result.signed && !result.signature) {
      return {
        signed: false,
        reason: 'Trust signing returned no signature.',
      }
    }
    return result
  } catch (error) {
    console.error('[trust-signer] signing failed', error)
    return { signed: false, reason: 'Trust signing failed.' }
  }
}
