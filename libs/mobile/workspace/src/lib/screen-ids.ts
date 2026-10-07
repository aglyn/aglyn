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

/** The owner every workspace registration carries: the platform, not a plugin. */
export const WORKSPACE_PLUGIN_ID = 'workspace'

/** The workspace's sites, with their publish status (the Sites tab). */
export const WORKSPACE_SITES_SCREEN = 'workspace.sites'
/** One site: status, address, the Besigner, the live site. */
export const WORKSPACE_SITE_SCREEN = 'workspace.site'
/** The picked site's or the workspace's media library. */
export const WORKSPACE_MEDIA_SCREEN = 'workspace.media'
/** One asset in a library. */
export const WORKSPACE_MEDIA_ITEM_SCREEN = 'workspace.mediaItem'
/** The workspace's members and pending invites. */
export const WORKSPACE_TEAM_SCREEN = 'workspace.team'
/** One member: role, site access, removal. */
export const WORKSPACE_MEMBER_SCREEN = 'workspace.member'
