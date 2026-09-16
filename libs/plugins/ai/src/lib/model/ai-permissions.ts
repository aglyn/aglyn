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

import type { HostAccessRole } from '@aglyn/aglyn/foundation/definitions/organization.types'
import type { PluginOrgPermissionDeclaration } from '@aglyn/aglyn/plugin-manager/plugin-entitlements'

/**
 * The two AI keys (AGL-2927): `ai.use` for the assistants, `ai.generate` for
 * generation jobs and AI edits.
 */
export type AiPermission = 'ai.use' | 'ai.generate'

/** The AI keys, in the order the editors render them. */
export const AI_PERMISSION_KEYS: readonly AiPermission[] = ['ai.use', 'ai.generate']

export function isAiPermission(value: unknown): value is AiPermission {
  return value === 'ai.use' || value === 'ai.generate'
}

/** One verdict per AI key. */
export type AiPermissionVerdict = Record<AiPermission, boolean>

/**
 * The host roles that may change a site's content may also ask a model to
 * change it. A viewer who cannot edit has nothing for a generation to land
 * on, and would spend the workspace's credits producing it anyway.
 */
const CONTENT_ROLES: Readonly<Record<HostAccessRole, boolean>> = {
  admin: true,
  editor: true,
  author: true,
  viewer: false,
}

/**
 * The AI keys as this plugin declares them into the org permission catalog
 * (AGL-2927, AGL-2984): listed on the role editor, stored on custom roles and
 * per-member overrides, and decided per site for a collaborator.
 *
 * Both are enforced at the AI doors themselves — the chat and copy
 * assistant doors through `memberHasPermissionOnHost`, and every door built
 * on `aiGateLadder` through its `permission` option — so a role that unticks
 * one closes the door, not only the button.
 *
 * Owners, admins and editors hold both by default: editors work on content,
 * the AI doors included. A viewer holds neither, because read-only includes
 * asking the assistant nothing: a viewer spends none of the workspace's AI
 * credits. A site collaborator holds both on a site where their host role
 * may change content.
 */
export const AI_ORG_PERMISSIONS: readonly PluginOrgPermissionDeclaration[] = [
  {
    key: 'ai.use',
    label: 'Use AI assistance',
    description: 'Ask the assistant, rewrite copy with AI, and generate a section.',
    roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
    hostRoleDefaults: CONTENT_ROLES,
  },
  {
    key: 'ai.generate',
    label: 'Generate with AI',
    description:
      'Run AI generation jobs and AI edits: pages, components, emails, campaigns, products, CRM, insights, workflows.',
    roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
    hostRoleDefaults: CONTENT_ROLES,
  },
]

const HOST_ROLES: readonly HostAccessRole[] = ['admin', 'editor', 'author', 'viewer']

/** What each host role grants of the AI keys, before any per-site toggle. */
export const HOST_ROLE_AI_PERMISSIONS: Readonly<Record<HostAccessRole, AiPermissionVerdict>> =
  Object.fromEntries(
    HOST_ROLES.map((role) => [
      role,
      Object.fromEntries(
        AI_ORG_PERMISSIONS.map((permission) => [
          permission.key,
          permission.hostRoleDefaults?.[role] === true,
        ]),
      ) as AiPermissionVerdict,
    ]),
  ) as Record<HostAccessRole, AiPermissionVerdict>

/** The AI keys of a verdict map the shell resolved; an absent key is refused. */
export function aiPermissionsOf(
  granted: Readonly<Record<string, boolean>> | null | undefined,
): AiPermissionVerdict {
  return {
    'ai.use': granted?.['ai.use'] === true,
    'ai.generate': granted?.['ai.generate'] === true,
  }
}
