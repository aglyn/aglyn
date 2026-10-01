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

import type { InstalledFrom } from '../app-utils/artifact-provenance'
import { getRegisteringPluginId } from '../app-utils/registering-plugin'
import { PLUGIN_ARTIFACT_TYPES_DECLARED } from './first-party-plugins.generated'
import { runPluginDeclarationsRepair } from './plugin-declarations-repair'

/**
 * AN INSTALLABLE ARTIFACT TYPE ANOTHER PLUGIN KEEPS (AGL-3080).
 *
 * Installed content is the platform's concept (`artifact-provenance.ts`): a
 * workspace can take a component, a theme or a dataset's schema from a
 * publisher rather than author it. The plugin that sells, installs and
 * updates those copies is one plugin; the plugin whose storage a copy lands
 * in may be another. A dataset schema is published from a dataset and
 * installs as a new one, and datasets are the data plugin's. The installer
 * may not read or write another plugin's storage, and neither plugin may
 * import the other, so this is the contract between them, and core names
 * neither.
 *
 * The owner answers four questions, and the installer keeps everything else:
 * who may act, the listing, its takedown and privacy gates, the purchase, the
 * publisher's preconditions, the provenance stamp and its base snapshot, and
 * the per-version tally.
 *
 * 1. {@link PluginArtifactOwner.snapshot}: publishing. Reads the source the
 *    publisher named in their own workspace and reduces it to what may travel.
 *    The installer stores what comes back as the version's content.
 * 2. {@link PluginArtifactOwner.admits}: before an install reads its listing,
 *    whether this workspace may hold one at all (its plan).
 * 3. {@link PluginArtifactOwner.prepare}: installing. Checks the published
 *    content can land here, makes it this workspace's, and writes NOTHING. The
 *    installer records provenance over the prepared content, then calls
 *    `commit` to write the copy with that stamp.
 * 4. {@link PluginArtifactOwner.locate}: updating. Finds the copy a listing
 *    installed, and hands back what the three-way merge diffs together with
 *    the one write that applies its result.
 *
 * ## Declared, then registered, and an absent owner refuses
 *
 * The owner DECLARES each type in `plugins.config.json` (`artifactTypes`),
 * compiled into core, and registers its answers from a declarations entry
 * (`consoleServerDeclarations`: an install runs on the console's server). A
 * registry alone would read a failed boot as "nobody keeps this type". The
 * three cases stay apart:
 *
 * - nothing declares the type: {@link resolveArtifactTypeOwner} answers
 *   `null`, and the installer refuses the listing as unavailable here;
 * - declared and registered: the owner answers;
 * - declared and NOT registered: the app's declarations step runs again, and
 *   if the owner is still missing this THROWS
 *   {@link ArtifactTypeOwnerUnavailableError}.
 *
 * Every one of those is decided before the installer writes anything, so an
 * install with no owner refuses whole and never lands half: no copy, no
 * provenance, no tally.
 *
 * Server-only, and reached by its own subpath, never through a barrel.
 */

/** A compiled declaration: the artifact type, and the plugin that keeps its copies. */
export interface ArtifactTypeDeclaration {
  pluginId: string
  type: string
}

/** A refusal, answered as the route's status and `{ error }` body. */
export interface ArtifactRefusal {
  ok: false
  status: number
  error: string
}

/** The workspace a copy is installed into. */
export interface ArtifactWorkspace {
  /** The organization the copy lands in. */
  orgId: string
  /** Its organization document: the plan, add-ons and default sharing a copy is held to. */
  org: Readonly<Record<string, unknown>>
}

/** The listing a copy is installed from, as the listing stores it. */
export interface ArtifactListingFacts {
  listingId: string
  displayName?: unknown
  description?: unknown
  /** The version on offer: the listing's `latestVersion`. */
  version?: unknown
}

/**
 * Where a copy came from, written onto it by its owner. The installer makes
 * both: the owner stores them and never composes either.
 */
export interface ArtifactInstallStamp {
  /** The provenance every installed copy carries (AGL-1015). */
  installedFrom: InstalledFrom
  /** The installer's own word for the copy's origin, with the listing and version. */
  source: {
    type: string
    listingId: string
    version: unknown
  }
}

/** Publishing: the source a publisher named, in their own workspace. */
export interface ArtifactSnapshotRequest {
  /** The publishing organization, whose source is read. */
  orgId: string
  /** The id of the source the publisher named. */
  sourceId: string
}

/** What a published version of the type carries. */
export interface ArtifactSnapshot {
  ok: true
  /** The content every install of this version receives. */
  content: unknown
  /** Facts about the content the listing carries beside it, written as they are. */
  facts?: Readonly<Record<string, string | number | boolean>>
}

/** Installing: one published version, into one workspace. */
export interface ArtifactInstallRequest extends ArtifactWorkspace {
  listing: ArtifactListingFacts
  /** The version's content as published (`versions/{v}.{type}`), unvalidated. */
  published: unknown
}

/** What an install landed, reported beside the installer's own fields. */
export interface ArtifactInstalled {
  ok: true
  report: Readonly<Record<string, unknown>>
}

/** An install the owner has checked and not yet written. */
export interface PreparedArtifactInstall {
  ok: true
  /**
   * The content exactly as the copy will hold it: what the installer records
   * as the base snapshot, so an update diffs this workspace's copy against
   * what really arrived rather than what the publisher sent.
   */
  content: unknown
  /**
   * Writes the copy with the installer's stamp. It may still refuse (a cap
   * that a concurrent install reached first), and a refusal writes nothing.
   */
  commit(stamp: ArtifactInstallStamp): Promise<ArtifactInstalled | ArtifactRefusal>
}

/** Updating: the copy a listing installed, asked from one site. */
export interface ArtifactLocateRequest {
  /** The site's organization, or `null` for a site with none. */
  orgId: string | null
  /** The site the update was asked from. */
  hostId: string
  listingId: string
  /** The version on offer, as published, unvalidated. */
  published: unknown
}

/**
 * What taking an update does beyond its content: shown on the preview, and,
 * when `destructive`, applied only once the caller has confirmed it.
 */
export interface ArtifactUpdateImpact {
  /** Fields added to the update's preview as they are. */
  preview: Readonly<Record<string, unknown>>
  /** The update reinterprets something the copy already holds. */
  destructive: boolean
  /** The sentence an unconfirmed destructive merge is refused with. */
  refusal: string
}

/** The installed copy, in the shape its base snapshot holds. */
export interface InstalledArtifactCopy {
  ok: true
  /** The copy as it is now. */
  current: unknown
  /** The version on offer, made this workspace's exactly as an install would. */
  incoming: unknown
  /** The version the copy was installed at, or `null` when it does not say. */
  installedVersion: string | null
  /** The hash of the base snapshot it was installed with, or `null`. */
  baseSha: string | null
  impact?: ArtifactUpdateImpact
  /** Writes the merged content onto the copy, with the update's stamp. */
  apply(update: { content: unknown; stamp: ArtifactInstallStamp }): Promise<void>
}

/** A plugin's answers for an installable artifact type it keeps. */
export interface PluginArtifactOwner {
  snapshot(request: ArtifactSnapshotRequest): Promise<ArtifactSnapshot | ArtifactRefusal>
  admits(workspace: ArtifactWorkspace): Promise<ArtifactRefusal | null>
  prepare(request: ArtifactInstallRequest): Promise<PreparedArtifactInstall | ArtifactRefusal>
  locate(request: ArtifactLocateRequest): Promise<InstalledArtifactCopy | ArtifactRefusal>
}

/** Every declared type, in config order. */
export function listDeclaredArtifactTypes(): readonly ArtifactTypeDeclaration[] {
  return PLUGIN_ARTIFACT_TYPES_DECLARED
}

/** The plugin declared as keeping `type`, or `null` when none is. */
export function declaredArtifactTypeOwner(type: string): ArtifactTypeDeclaration | null {
  return listDeclaredArtifactTypes().find((declared) => declared.type === type) ?? null
}

interface Registered {
  pluginId: string
  owner: PluginArtifactOwner
}

/**
 * One table per process, on `globalThis` (AGL-3412): the owner registers from
 * the app's boot, which Next compiles apart from the routes that read.
 */
const OWNERS_KEY = Symbol.for('@aglyn/aglyn:plugin-artifact-types')

const globalScope = globalThis as typeof globalThis & {
  [OWNERS_KEY]?: Map<string, Registered>
}

const owners: Map<string, Registered> =
  globalScope[OWNERS_KEY] ?? (globalScope[OWNERS_KEY] = new Map())

/**
 * Registers a plugin's answers for a type it declared. The owner is the plugin
 * whose register fn is running, or the `pluginId` passed from a boot
 * declaration. Refused: no owner, a type nobody declared (no installer would
 * ever ask for it), and a type another plugin declared. The same plugin
 * registering again replaces its answers. Returns the unregister.
 */
export function registerArtifactTypeOwner(
  type: string,
  owner: PluginArtifactOwner,
  options?: { pluginId?: string },
): () => void {
  const name = type.trim()
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  if (!pluginId) {
    throw new Error(
      `artifact type "${name}" registered with no owner: pass { pluginId } ` +
        'when registering outside a plugin register fn',
    )
  }
  const declared = declaredArtifactTypeOwner(name)
  if (!declared) {
    throw new Error(
      `artifact type "${name}" is not declared in plugins.config.json ` +
        '(artifactTypes), so no installer would ever ask for it',
    )
  }
  if (declared.pluginId !== pluginId) {
    throw new Error(
      `artifact type "${name}" is declared by "${declared.pluginId}"; refused "${pluginId}"`,
    )
  }
  const entry: Registered = { pluginId, owner }
  owners.set(name, entry)
  return () => {
    if (owners.get(name) === entry) owners.delete(name)
  }
}

/** The registered owner of `type` with its plugin, or `null`. */
export function artifactTypeOwner(type: string): Registered | null {
  return owners.get(type) ?? null
}

/** Only for specs: forgets every registered owner. */
export function resetArtifactTypeOwnersForTests(): void {
  owners.clear()
}

/**
 * The declared owner's registration was not found, even after the app's
 * declarations step ran again.
 */
export class ArtifactTypeOwnerUnavailableError extends Error {
  constructor(readonly declared: ArtifactTypeDeclaration) {
    super(
      `artifact type "${declared.type}" is declared by "${declared.pluginId}" but ` +
        'no owner is registered in this process: its declarations did not run. ' +
        'Refusing to treat it as a type nobody keeps.',
    )
    this.name = 'ArtifactTypeOwnerUnavailableError'
  }
}

/**
 * The owner of `type`: `null` when no plugin declares it, the registered
 * answers when one does, and a THROWN {@link ArtifactTypeOwnerUnavailableError}
 * when the declared owner is still missing after the app's declarations step
 * ran once more.
 */
export async function resolveArtifactTypeOwner(
  type: string,
): Promise<PluginArtifactOwner | null> {
  const declared = declaredArtifactTypeOwner(type)
  if (!declared) return null
  let registered = artifactTypeOwner(type)
  if (!registered) {
    try {
      await runPluginDeclarationsRepair()
    } catch (error) {
      console.error('[plugin-artifact-types] the declarations repair failed', error)
    }
    registered = artifactTypeOwner(type)
  }
  if (!registered) throw new ArtifactTypeOwnerUnavailableError(declared)
  return registered.owner
}
