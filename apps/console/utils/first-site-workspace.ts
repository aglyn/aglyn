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
import { generateOrgSlug, isValidOrgSlug } from '@aglyn/aglyn'
import { trackEventBeforeNavigation } from '@aglyn/aglyn/app-utils/analytics-events'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { firstTouchField } from './account-acquisition'

type TokenSource = Parameters<typeof authorizedFetch>[0]

/** The account fields a workspace is named from. */
export interface FirstSiteAccount {
  displayName?: string | null
  email?: string | null
}

/**
 * The name the workspace for a first site takes: the account's own name, else
 * the local part of its email, else "workspace". The rule the server applies
 * when a first site provisions the workspace itself (`ensureOrgForUser`), so
 * the workspace is named the same whichever door made it.
 */
export function firstSiteWorkspaceName(account: FirstSiteAccount | null | undefined): string {
  const base =
    account?.displayName?.trim() || account?.email?.split('@')[0]?.trim() || 'workspace'
  return base.slice(0, 80)
}

/** A second address for a name whose own was taken: its slug and a short suffix. */
export function firstSiteWorkspaceFallbackSlug(name: string, random: () => number = Math.random): string {
  const suffix = Math.floor(random() * 36 ** 4)
    .toString(36)
    .padStart(4, '0')
  const slug = `${(generateOrgSlug(name) || 'workspace').slice(0, 25)}-${suffix}`
  return isValidOrgSlug(slug) ? slug : `workspace-${suffix}`
}

export type FirstSiteWorkspaceOutcome = { slug: string } | { error: string }

/**
 * The workspace a first site needs, made before the site (AGL-3761).
 *
 * The empty console's "Create site" used to create the site and, as a side
 * effect, the workspace, and only then ask how the site should start, so
 * every start closed unanswered left an empty site behind. The start is asked
 * inside a workspace — its plan decides what it offers — so the workspace is
 * created first, here, through `POST /api/orgs/create`, and the site only once
 * the person has chosen how it starts. That is the same shape every email
 * sign-up already has: a workspace from the first verified session, and the
 * site when it is created.
 *
 * An address someone else holds is tried once more under a suffixed one, as
 * the server's own provisioning does; the route's hourly limit leaves no room
 * for more. Reports `org_created` once the workspace exists, awaited, because
 * the caller navigates next and a pending hit dies with the document
 * (AGL-2587).
 */
export async function createFirstSiteWorkspace(
  user: TokenSource,
  account: FirstSiteAccount | null | undefined,
): Promise<FirstSiteWorkspaceOutcome> {
  const name = firstSiteWorkspaceName(account)
  const attempt = async (slug?: string) => {
    const response = await authorizedFetch(user, '/api/orgs/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // The first touch rides along for the server's acquisition backstop:
      // this is the request a Google sign-up's workspace is born from.
      body: JSON.stringify({ name, ...(slug ? { slug } : {}), ...firstTouchField() }),
    })
    const payload = await response.json().catch(() => null)
    return { response, payload }
  }
  try {
    // A name with no usable address of its own (too short, reserved, no
    // letters the slug keeps) goes straight to the suffixed one.
    let { response, payload } = await attempt(
      isValidOrgSlug(generateOrgSlug(name)) ? undefined : firstSiteWorkspaceFallbackSlug(name),
    )
    if (response.status === 409) {
      ;({ response, payload } = await attempt(firstSiteWorkspaceFallbackSlug(name)))
    }
    const slug = typeof payload?.slug === 'string' ? payload.slug : null
    if (!response.ok || !slug) {
      return {
        error:
          typeof payload?.error === 'string'
            ? payload.error
            : 'Your workspace could not be set up. Try again.',
      }
    }
    // Activation (AGL-1561), counted where the workspace is created.
    await trackEventBeforeNavigation('org_created', {})
    return { slug }
  } catch (error) {
    console.error('first-site workspace create failed', error)
    return { error: 'Your workspace could not be set up. Try again.' }
  }
}
