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

import {type Conditional, type TimestampSeconds} from '@aglyn/shared-data-types'
import {
  type ActivityAccess,
  type HostRedirectParams,
  type HostRedirectStatusCode,
  type HostScreenStatus,
  type HostScreenVisibility,
  type HostViewFormat,
  type HostViewType,
} from '../constants/tenancy'
import {type AglynElementsById, type AglynElementsList} from './aglyn-elements.types'


export type UserUid = string
export type RoleUid = string
export type PermissionUid = string
export type TenantUid = string
export type HostUid = string
export type ScreenUid = string
export type VersionUid = string
export type ViewPartUid = string
export type HostPath = string
export type HostMediaUid = string

export interface AglynUser {
  $id: UserUid
  roleId?: RoleUid
  admin?: boolean
  email?: string
  tenants?: Record<TenantUid, true>
}

export interface AglynUserRole {
  $id: RoleUid
  displayName?: string
  description?: string
  permissions?: Record<PermissionUid, true>
  users?: Record<UserUid, true>
}

export interface AglynRolePermission {
  $id: PermissionUid
  displayName?: string
  description?: string
  roles?: Record<RoleUid, true>
}

export interface AglynActivityAccess {
  roles?: Record<RoleUid, ActivityAccess>
  permissions?: Record<PermissionUid, ActivityAccess>
  users?: Record<UserUid, ActivityAccess>
}

export interface AglynTenant {
  $id: TenantUid
  ownerId?: UserUid
  displayName?: string
  description?: string
  users?: Record<UserUid, true>
  hosts?: Record<HostUid, true>
}

export interface AglynTenantHost {
  $id: HostUid
  tenantId?: TenantUid
  cname?: string
  pathsFile?: string
  organization?: {
    type?: 'organization' | 'person'
    name?: string
    logo?: string
  }
  displayName?: string
  separator?: string
  title?: string
  description?: string
  image?: string
  favicon?: string
  screens?: Record<ScreenUid, true>
}

export interface AglynHostPaths {
  tenantId?: TenantUid
  hostId?: HostUid
  paths?: Record<HostPath, ScreenUid>
  redirects?: Record<HostPath, AglynHostRedirect>
}

export type AglynHostRedirect = {
  source?: HostPath
  destination?: HostPath
  statusCode?: HostRedirectStatusCode
  params?: HostRedirectParams
  flags?: {
    regex?: true
    ignoreSlash?: true
    ignoreCase?: true
  }
  description?: string
  hits?: number
  lastAccess?: TimestampSeconds
}

export interface AglynHostScreen {
  $id: ScreenUid
  parentId?: ScreenUid
  tenantId?: TenantUid
  hostId?: HostUid
  ownerId?: UserUid
  slug?: string
  versionId?: VersionUid
  versions?: Record<VersionUid, true>
  status?: HostScreenStatus
  visibility?: HostScreenVisibility
  access?: AglynActivityAccess
  contributors?: Record<UserUid, true>
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

export interface AglynHostViewPart<T extends HostViewFormat = HostViewFormat.NORMALIZED> {
  $id: ViewPartUid
  tenantId?: TenantUid
  hostId?: HostUid
  layout?: ViewPartUid
  type?: HostViewType
  contributors?: Record<UserUid, true>
  createdAt?: TimestampSeconds
  updatedAt?: TimestampSeconds
  notes?: string
  title?: string
  description?: string
  breadcrumb?: string
  image?: HostMediaUid
  format?: T
  elements?: Conditional<T, HostViewFormat.NORMALIZED, AglynElementsList, AglynElementsById>
}
