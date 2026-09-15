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
 * HOW A PROVIDER IS TOLD TO FORGET A GRANT AN ERASURE DESTROYS (AGL-2978).
 *
 * An org erasure deletes the platform's stored copy of every OAuth grant the
 * organization holds — `outreachMailboxCredentials` today — by a static sweep
 * that runs whether or not any plugin is loaded, because a credential's
 * lifetime cannot depend on which bundles an erasing process happened to
 * load. Deleting the copy leaves the grant itself alive at the provider,
 * though: listed in the person's account as an app with access, until they
 * remove it by hand.
 *
 * Revoking it needs the plugin that holds it — the provider's endpoint, and
 * the key that opens the sealed token — and this library may not import a
 * plugin, nor hold a credential the tenant runtime could reach. So the plugin
 * REGISTERS a revoker here from its server half, and the erasure asks for one
 * before it deletes. A process that loaded no such plugin finds none, and the
 * erasure deletes exactly as it always has; revocation is added on top of the
 * guarantee, never in place of it.
 *
 * A revoker is best-effort by contract: it answers an outcome rather than
 * throwing, and the erasure proceeds whatever it answers. An erasure has a
 * legal clock on it, and a provider outage does not get to stop that clock.
 */

/** What became of one grant at its provider. */
export type ProviderGrantRevocation =
  /** The provider confirmed the grant is revoked. */
  | 'revoked'
  /** The provider said the grant was already dead. */
  | 'already-invalid'
  /** Left alone on purpose: something outside this erasure still uses it. */
  | 'kept'
  /** The provider could not be told — unreachable, or the token unreadable. */
  | 'failed'

/** One stored credential, as the erasure read it. */
export interface ProviderGrantCredential {
  id: string
  data: Record<string, unknown>
}

export type ProviderGrantRevoker = (
  credential: ProviderGrantCredential,
  context: { erasingOrgId: string },
) => Promise<ProviderGrantRevocation>

const revokers = new Map<string, ProviderGrantRevoker>()

/**
 * Registers the revoker for the credentials in one top-level collection.
 * A later registration for the same collection replaces the earlier one, as
 * a hot reload or a repeated init needs.
 */
export function registerProviderGrantRevoker(collection: string, revoke: ProviderGrantRevoker): void {
  revokers.set(collection, revoke)
}

/** The revoker for a collection, or `undefined` when this process holds none. */
export function providerGrantRevokerFor(collection: string): ProviderGrantRevoker | undefined {
  return revokers.get(collection)
}

/** Test seam: forgets a registration. */
export function unregisterProviderGrantRevoker(collection: string): void {
  revokers.delete(collection)
}

/** Tallies of revocation outcomes for an erasure's audit row. */
export interface ProviderGrantRevocationTally {
  revoked: number
  alreadyInvalid: number
  kept: number
  failed: number
  /** Credentials no revoker was registered for in the erasing process. */
  unrevoked: number
}

/**
 * Runs the registered revoker over credentials, one at a time, never throwing.
 * With no revoker registered, every credential is counted `unrevoked`.
 */
export async function revokeProviderGrants(
  collection: string,
  credentials: readonly ProviderGrantCredential[],
  context: { erasingOrgId: string },
): Promise<ProviderGrantRevocationTally> {
  const tally: ProviderGrantRevocationTally = {
    revoked: 0,
    alreadyInvalid: 0,
    kept: 0,
    failed: 0,
    unrevoked: 0,
  }
  const revoke = providerGrantRevokerFor(collection)
  for (const credential of credentials) {
    if (!revoke) {
      tally.unrevoked += 1
      continue
    }
    let outcome: ProviderGrantRevocation
    try {
      outcome = await revoke(credential, context)
    } catch (error) {
      console.error(`[erase] revoking a ${collection} grant threw`, error)
      outcome = 'failed'
    }
    if (outcome === 'revoked') tally.revoked += 1
    else if (outcome === 'already-invalid') tally.alreadyInvalid += 1
    else if (outcome === 'kept') tally.kept += 1
    else tally.failed += 1
  }
  return tally
}
