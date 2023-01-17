/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import type { HttpStatusCode } from '@aglyn/shared-data-enums'
import type { ITimestamp } from '@aglyn/shared-util-timestamp'
import type { NodeId, NodeSchema } from './canvas-manager'

export enum HostScreenStatus {
  UNPUBLISHED = 0x1 << 0x1,
  PUBLISHED = 0x1 << 0x2,
  SCHEDULED_TO_PUBLISH_UNPUBLISHED = UNPUBLISHED | (0x1 << 0x3),
  SCHEDULED_TO_UNPUBLISH_PUBLISHED = PUBLISHED | (0x1 << 0x4),
  SCHEDULED_TO_UPDATE_PUBLISHED = PUBLISHED | (0x1 << 0x5),
  SCHEDULED_TO_REVERT_UPDATE_PUBLISHED = PUBLISHED | (0x1 << 0x6),
}

export enum HostScreenVisibility {
  PUBLIC = 0x1 << 0x1,
  UNLISTED = PUBLIC | (0x1 << 0x2),
  PRIVATE = 0x1 << 0x3,
  PASSWORD = PRIVATE | (0x1 << 0x4),
  AUTHENTICATED = PRIVATE | (0x1 << 0x5),
  AUTHORIZED = AUTHENTICATED | (0x1 << 0x6),
}

export enum HostViewType {
  SCREEN = 0x1,
  LAYOUT = 0x2,
}

export enum HostViewFormat {
  NORMALIZED = 0x1,
  DENORMALIZED = 0x2,
}

export enum ActivityAccess {
  NONE,
  READ = 0x1 << 0x1,
  WRITE = 0x1 << 0x2,
  READ_WRITE = READ | WRITE,
  SUPER = READ_WRITE | (0x1 << 0x3),
}

export enum HostEntityType {
  ORGANIZATION = 0x1,
  PERSON = 0x2,
}

export enum HostRedirectParams {
  IGNORE,
  FORWARD = 0x1,
  MATCH = 0x2,
}

export type UserUid = string
export type RoleUid = string
export type PermissionUid = string
export type TenantUid = string
export type ProjectUid = string
export type ProjectNumber = number
export type HostUid = string
export type HostPath = string
export type HostMediaUid = string
export type RedirectUid = string
export type ScreenUid = string
export type ScreenSlug = string
export type VersionUid = string
export type LayoutUid = string

export interface AglynDocument {
  [field: string]: any
}

export interface AglynUser extends AglynDocument {
  $id: UserUid
  roleId?: RoleUid
  admin?: boolean
  email?: string
  tenants?: Record<TenantUid, true>
}

export interface AglynAuthRole extends AglynDocument {
  $id: RoleUid
  displayName?: string
  description?: string
  permissions?: Record<PermissionUid, true>
  users?: Record<UserUid, true>
}

export interface AglynRolePermission extends AglynDocument {
  $id: PermissionUid
  displayName?: string
  description?: string
  roles?: Record<RoleUid, true>
}

export interface AglynAccessRule extends AglynDocument {
  roles?: Record<RoleUid, ActivityAccess>
  permissions?: Record<PermissionUid, ActivityAccess>
  users?: Record<UserUid, ActivityAccess>
}

/** Hosted in master catalog */
export interface AglynTenant extends AglynDocument {
  $id: TenantUid
  ownerId?: UserUid
  displayName?: string
  description?: string
  hosts?: Record<HostUid, true>
  users?: Record<UserUid, true>
}

/** Hosted in tenants' host project */
export interface AglynHost extends AglynDocument {
  $id: HostUid
  tenantId?: TenantUid
  subdomain?: string
  cname?: string
  displayName?: string
  seo?: {
    title?: string
    description?: string
    separator?: string
    favicon?: string
    image?: HostMediaUid
    entity?: {
      type?: HostEntityType
      name?: string
      logo?: string
    }
  }
  screens?: Record<ScreenUid, ScreenSlug>

  // CONCEPT: Redirect screens
  redirects?: Record<RedirectUid, true>

  // CONCEPT: Enterprise - Siloed projects
  projectId?: ProjectUid
  projectNumber?: ProjectNumber
}

/** Hosted in tenants' host project */
export interface AglynScreen extends AglynDocument {
  $id: ScreenUid
  tenantId?: TenantUid
  hostId?: HostUid
  parentId?: ScreenUid
  slug?: ScreenSlug
  versionId?: VersionUid
  status?: HostScreenStatus
  createdAt?: ITimestamp
  updatedAt?: ITimestamp
  deletedAt?: ITimestamp
  displayName?: string
  description?: string
  seo?: {
    title?: string
    description?: string
    breadcrumb?: string
    image?: HostMediaUid
  }

  // CONCEPT: Scheduling
  schedule?: {
    startAt?: ITimestamp
    endAt?: ITimestamp
    next?: VersionUid
    previous?: VersionUid
  }

  // CONCEPT: Contextual visibility
  visibility?: HostScreenVisibility | AglynAccessRule

  // CONCEPT: Attribute editors
  owner?: UserUid
  contributors?: {
    [P in string & UserUid]: true
  }

  // CONCEPT: Shared layouts
  layoutId?: LayoutUid
}

/** Hosted in tenants' host project */
export interface AglynScreenVersion extends AglynDocument {
  $id: VersionUid
  tenantId?: TenantUid
  hostId?: HostUid
  screenId?: ScreenUid
  createdAt?: ITimestamp
  updatedAt?: ITimestamp
  nodes?: Record<NodeId, NodeSchema>
}

/** CONCEPT: Shared layouts. Hosted in tenants' host project */
export interface AglynLayout {
  $id: LayoutUid
  tenantId?: TenantUid
  hostId?: HostUid
  layoutId?: LayoutUid
  versionId?: VersionUid
  versions?: Array<VersionUid>
  displayName?: string
  description?: string
  contributors?: Array<UserUid>
  createdAt?: ITimestamp
  updatedAt?: ITimestamp
}

/** CONCEPT: Shared layouts. Hosted in tenants' host project */
export interface AglynLayoutVersion extends AglynScreenVersion {
  $id: LayoutUid
  layoutId?: LayoutUid
  hostId?: HostUid
}

/** CONCEPT: Host redirects. Hosted in tenants' host project */
export interface AglynRedirect extends AglynDocument {
  $id: RedirectUid
  hostId?: HostUid
  sourcePath?: HostPath
  sourceScreen?: ScreenUid
  destinationPath?: HostPath
  destinationScreen?: ScreenUid
  statusCode?: HttpStatusCode
  params?: HostRedirectParams
  flags?: {
    regex?: true
    ignoreSlash?: true
    ignoreCase?: true
  }
  hits?: number
  lastAccess?: ITimestamp
  description?: string
}
