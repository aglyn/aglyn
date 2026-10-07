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
  getMobileScreen,
  registerMobileDeepLink,
  registerMobileQuickAction,
  registerMobileScreen,
  registerMobileTab,
} from '@aglyn/mobile-plugin-host'
import {
  WORKSPACE_MEDIA_ITEM_SCREEN,
  WORKSPACE_MEDIA_SCREEN,
  WORKSPACE_MEMBER_SCREEN,
  WORKSPACE_PLUGIN_ID,
  WORKSPACE_SITE_SCREEN,
  WORKSPACE_SITES_SCREEN,
  WORKSPACE_TEAM_SCREEN,
} from './lib/screen-ids'

export * from './lib/screen-ids'

/*==========================================
 * THE PLATFORM'S OWN SCREENS (AGL-3622).
 *
 * Sites, the media library, and team and users are core features, not a
 * plugin's, so the app shell registers them once at startup, before any
 * plugin loads, through the same registrars a plugin uses. Each screen's
 * code loads on first open.
 *
 * Deep links answer the console's own pages natively: the Sites list
 * (`/{org}/hosts`, which a member-added notification links to), the media
 * library (`/{org}/media` and
 * `/{org}/hosts/{site}/media`), and the team (`/{org}/team`, its Members
 * tab, and a member's page `/{org}/team/{uid}`). Invite notifications link
 * to `/{org}/team`.
 *
 * A site's own dashboard (`/{org}/hosts/{site}`) is NOT answered here: once
 * the shell strips the site prefix it is `/`, the same path as the org home
 * and as bare `/`, which an invitee's notification carries for the
 * console's workspace chooser (accept or decline). Claiming `/` would take
 * that link away from the console, so it still opens there.
 *=========================================*/

/** Registers the workspace screens. Safe to call again (fast refresh): a second call does nothing. */
export function registerWorkspaceMobile(): void {
  if (getMobileScreen(WORKSPACE_SITES_SCREEN)?.pluginId === WORKSPACE_PLUGIN_ID) return
  const pluginId = WORKSPACE_PLUGIN_ID

  registerMobileScreen({ pluginId, id: WORKSPACE_SITES_SCREEN, title: 'Sites', load: () => import('./lib/sites/sites-screen') })
  registerMobileScreen({ pluginId, id: WORKSPACE_SITE_SCREEN, title: 'Site', load: () => import('./lib/sites/site-screen') })
  registerMobileScreen({
    pluginId,
    id: WORKSPACE_MEDIA_SCREEN,
    title: 'Media library',
    load: () => import('./lib/media/media-screen'),
  })
  registerMobileScreen({
    pluginId,
    id: WORKSPACE_MEDIA_ITEM_SCREEN,
    title: 'File',
    load: () => import('./lib/media/media-item-screen'),
  })
  registerMobileScreen({ pluginId, id: WORKSPACE_TEAM_SCREEN, title: 'Team', load: () => import('./lib/team/team-screen') })
  registerMobileScreen({
    pluginId,
    id: WORKSPACE_MEMBER_SCREEN,
    title: 'Member',
    load: () => import('./lib/team/member-screen'),
  })

  registerMobileTab({
    pluginId,
    id: 'workspace.sites-tab',
    title: 'Sites',
    icon: 'globe-outline',
    screen: WORKSPACE_SITES_SCREEN,
    order: 10,
  })

  registerMobileQuickAction({
    pluginId,
    id: 'workspace.media-open',
    title: 'Media library',
    icon: 'images-outline',
    order: 20,
    screen: WORKSPACE_MEDIA_SCREEN,
  })
  registerMobileQuickAction({
    pluginId,
    id: 'workspace.team-open',
    title: 'Team',
    icon: 'people-outline',
    order: 30,
    screen: WORKSPACE_TEAM_SCREEN,
  })

  const links: Array<[id: string, path: string, screen: string]> = [
    ['workspace.sites-page', '/hosts', WORKSPACE_SITES_SCREEN],
    ['workspace.media-page', '/media', WORKSPACE_MEDIA_SCREEN],
    ['workspace.team-page', '/team', WORKSPACE_TEAM_SCREEN],
    ['workspace.team-members-page', '/team/members', WORKSPACE_TEAM_SCREEN],
    ['workspace.member-page', '/team/:uid', WORKSPACE_MEMBER_SCREEN],
  ]
  for (const [id, path, screen] of links) registerMobileDeepLink({ pluginId, id, path, screen })
}
