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

import { ORG_PERMISSION_KEYS, type OrgPermission } from '@aglyn/aglyn'

/**
 * The shell's AUTHORIZATION gate for plugin surfaces — the sibling of
 * `extension-entitlement.ts`, answering the other question.
 *
 * `resolveExtensionEntitlement` decides what the ORGANIZATION bought.
 * Nothing decided who among its members may open the surface. A plugin
 * surface could gate itself on the `permissions` prop the route hands down,
 * and that is a prop: an extension that does not read it renders in full for
 * a reader with no standing, which is what the entitlement half of this
 * already learned. So the extension DECLARES what it requires and this
 * decides whether the requirement is met.
 *
 * THREE states, for the reason the entitlement resolver has three. The
 * console's permission map is the permissive admin map until the member
 * document lands, so "not yet known" and "granted" are the same value in it;
 * an unsettled read is `pending`, and neither the surface nor a refusal is
 * rendered from a guess about who is reading.
 */
export type ExtensionPermission = 'granted' | 'refused' | 'pending'

/** The subset of `ConsoleExtension` / `ConsoleNavItem` this reads. */
interface PermissionDeclaring {
  permission?: string
}

/**
 * Every permission the surface requires: the extension's, and the nav item's
 * when it names one of its own.
 *
 * BOTH, never the narrower alone. A nav item's key is an additional
 * requirement on one surface, not a replacement for the extension's — an
 * extension whose whole surface area is gated must not be openable through
 * the one nav item that happens to name a key its reader holds.
 */
export function requiredExtensionPermissions(
  extension: PermissionDeclaring | undefined,
  navItem: PermissionDeclaring | undefined,
): readonly string[] {
  const declared = [extension?.permission, navItem?.permission]
  return declared.filter(
    (key): key is string => typeof key === 'string' && key.trim() !== '',
  )
}

/** Where the shell can look a permission key up, once the read has settled. */
export interface PermissionAnswers {
  /** The granular dotted catalog — `useOrgPermissions().can`. */
  can: (permission: OrgPermission) => boolean
  /**
   * The resolved map handed to plugin pages: the legacy six plus every
   * plugin-declared key. The only place a key like `managePos` is answered.
   */
  permissions: Record<string, boolean | undefined> | undefined
  /** True ONLY when the member read answered — false while loading AND on failure. */
  loaded: boolean
}

/**
 * One declared key against the reader.
 *
 * The two key spaces are looked up SEPARATELY and in a fixed order, because
 * they are not interchangeable: the dotted catalog is what custom roles and
 * per-member overrides are stored in, and the camelCase map is what plugin
 * registration contributes to. Merging them is the trap `toLegacyPermissions`
 * documents — a dotted key fed to the camelCase map matches nothing and
 * silently answers "absent".
 *
 * A key in neither space is REFUSED. An unrecognized requirement is the shape
 * of a typo or of a plugin whose `registerPluginPermissions` never ran, and
 * both of those are surfaces nobody has decided may be opened. Answering
 * "granted" would make a misspelled gate indistinguishable from no gate.
 */
function holds(key: string, answers: PermissionAnswers): boolean {
  if ((ORG_PERMISSION_KEYS as readonly string[]).includes(key)) {
    return answers.can(key as OrgPermission) === true
  }
  const value = answers.permissions?.[key]
  return typeof value === 'boolean' ? value : false
}

/**
 * The verdict for a surface, from what it declared and who is reading.
 *
 * A surface that declares nothing is `granted` and is NOT held behind the
 * member read — the overwhelming majority of console surfaces are open to
 * every member of the workspace, and making them wait on a document they do
 * not need is a spinner in front of an answer that was never in doubt.
 *
 * Every declared key must hold. Requirements compose by AND, so adding one
 * can only ever refuse more readers.
 */
export function resolveExtensionPermission(
  required: readonly string[],
  answers: PermissionAnswers,
): ExtensionPermission {
  if (required.length === 0) return 'granted'
  if (answers.loaded !== true) return 'pending'
  return required.every((key) => holds(key, answers)) ? 'granted' : 'refused'
}

/**
 * What a refused reader is told.
 *
 * Names the surface and where the grant comes from, and says nothing about
 * which key: the permission ids are an internal vocabulary, and a member who
 * cannot change their own role is not helped by learning one. It does not
 * pretend the surface is missing either — the nav entry is still there, and
 * copy that denied the page existed would read as a broken console.
 */
export function refusedExtensionNotice(surfaceTitle: string): string {
  return (
    `You don't have permission to open ${surfaceTitle}. An organization ` +
    'owner or admin can grant it from Team.'
  )
}
