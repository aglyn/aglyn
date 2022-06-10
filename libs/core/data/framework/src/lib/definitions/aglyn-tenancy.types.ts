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

import type {HttpStatusCode} from '@aglyn/shared-data-enums'
import type {Conditional, TimestampSeconds} from '@aglyn/shared-data-types'
import type {
  ActivityAccess,
  HostEntityType,
  HostRedirectParams,
  HostScreenStatus,
  HostScreenVisibility,
  HostViewFormat,
} from '../constants/tenancy'
import type {
  AglynElementsDenormalized,
  AglynElementsList,
  AglynElementsNormalized,
} from './aglyn-elements.types'


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

export interface AglynUserRole extends AglynDocument {
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
  users?: Record<UserUid, true>
  hosts?: Record<HostUid, true>
}

/** Hosted in master catalog */
export interface AglynTenantHost extends AglynDocument {
  $id: HostUid
  tenantId?: TenantUid
  projectId?: ProjectUid
  projectNumber?: ProjectNumber
  cname?: string
  displayName?: string
  description?: string
}

/** Hosted in tenants' host project */
export interface AglynTenantHostEntry extends AglynDocument {
  $id: HostUid
  screens?: Record<ScreenUid, true>
  redirects?: Record<RedirectUid, true>
  displayName?: string
  title?: string
  description?: string
  separator?: string
  image?: string
  favicon?: string
  entity?: {
    type?: HostEntityType
    name?: string
    logo?: string
  }
}

/** Hosted in tenants' host project */
export interface AglynTenantHostRedirect extends AglynDocument {
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
  lastAccess?: TimestampSeconds
  description?: string
}

/** Hosted in tenants' host project */
export interface AglynTenantHostScreen extends AglynDocument {
  $id: ScreenUid
  parentId?: ScreenUid
  hostId?: HostUid
  ownerId?: UserUid
  layoutId?: LayoutUid
  slug?: string
  version?: VersionUid
  versions?: Array<VersionUid>
  status?: HostScreenStatus
  visibility?: HostScreenVisibility
  access?: AglynAccessRule
  contributors?: Array<UserUid>
  createdAt?: TimestampSeconds
  updatedAt?: TimestampSeconds
  deletedAt?: TimestampSeconds
  schedule?: {
    startAt?: TimestampSeconds
    endAt?: TimestampSeconds
    next?: VersionUid
    previous?: VersionUid
  }
  displayName?: string
  description?: string
}

/** Hosted in tenants' host project */
export interface AglynTenantHostLayout {
  $id: LayoutUid
  hostId?: HostUid
  layoutId?: LayoutUid
  versionId?: VersionUid
  versions?: Array<VersionUid>
  displayName?: string
  description?: string
  contributors?: Array<UserUid>
  createdAt?: TimestampSeconds
  updatedAt?: TimestampSeconds
}

/** Hosted in tenants' host project */
export interface AglynTenantHostScreenVersion<T extends HostViewFormat = HostViewFormat.NORMALIZED> extends AglynDocument {
  $id: VersionUid
  hostId?: HostUid
  screenId?: ScreenUid
  contributors?: Array<UserUid>
  createdAt?: TimestampSeconds
  updatedAt?: TimestampSeconds
  title?: string
  description?: string
  breadcrumb?: string
  image?: HostMediaUid
  format?: T
  elements?: Conditional<T, HostViewFormat.NORMALIZED, AglynElementsList, AglynElementsDenormalized>
}

/** Hosted in tenants' host project */
export interface AglynTenantHostLayoutVersion<T extends HostViewFormat = HostViewFormat.NORMALIZED> extends AglynDocument {
  $id: VersionUid
  hostId?: HostUid
  contributors?: Array<UserUid>
  createdAt?: TimestampSeconds
  updatedAt?: TimestampSeconds
  format?: T
  elements?: Conditional<T, HostViewFormat.NORMALIZED, AglynElementsNormalized, AglynElementsDenormalized>
}
