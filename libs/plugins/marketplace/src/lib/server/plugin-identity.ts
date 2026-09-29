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

import type { PluginContributions } from '@aglyn/aglyn/plugin-manager/plugin-contributions'

/**
 * `pluginIdentities/{identity}` — which listing owns a plugin identity
 * (AGL-3390). Server-only: no rule matches it, so no client can read or write
 * it.
 */
export const PLUGIN_IDENTITIES = 'pluginIdentities'

/**
 * A marketplace plugin's identity: `<publisher handle>.<manifest id>`.
 *
 * It is the `pluginId` its elements and presets carry, and the namespace of
 * its component ids (`<identity>.<role>`), so a site's stored nodes name it
 * for as long as the site keeps them. Neither half can contain a `.`, so the
 * identity always parses back.
 *
 * Minted once, at a listing's first publish that has none, and never changed
 * after: a publisher who renames their handle keeps the identity their
 * existing elements were saved under.
 */
export function pluginIdentityFor(handle: string, manifestId: string): string {
  return `${handle}.${manifestId}`
}

/** A role within a plugin's namespace: `scope`, `showWhen`, `save-button`. */
const COMPONENT_ROLE_PATTERN = /^[A-Za-z][A-Za-z0-9-]{0,63}$/

/**
 * Why a manifest's site components cannot publish under `identity`, or null.
 *
 * Every declared component id must sit in the plugin's own namespace. The
 * loaders refuse a bundle that registers outside it, so a declaration that
 * does is refused here, where its publisher can still fix it.
 */
export function componentNamespaceRefusal(
  identity: string,
  contributes: PluginContributions | null | undefined,
): string | null {
  const outside = (contributes?.site?.components ?? []).filter((componentId) => {
    if (!componentId.startsWith(`${identity}.`)) return true
    return !COMPONENT_ROLE_PATTERN.test(componentId.slice(identity.length + 1))
  })
  if (!outside.length) return null
  return (
    `Site component ids must be "${identity}.<role>" (a role is letters, ` +
    `digits and dashes): ${outside.join(', ')}`
  )
}

/**
 * Claims `identity` for `listingId`, once and for good.
 *
 * Resolves true when the identity is this listing's, whether it was just
 * claimed or already was. False when another listing holds it: a second
 * publisher can never mint an identity whose elements already sit on someone's
 * site, even after the first listing is deleted, because a claim is never
 * released.
 */
export async function claimPluginIdentity(
  firestore: FirebaseFirestore.Firestore,
  claim: { identity: string; listingId: string; profileId: string },
): Promise<boolean> {
  const ref = firestore.collection(PLUGIN_IDENTITIES).doc(claim.identity)
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    if (snapshot.exists) return snapshot.get('listingId') === claim.listingId
    transaction.create(ref, {
      listingId: claim.listingId,
      profileId: claim.profileId,
      claimedAt: new Date(),
    })
    return true
  })
}
