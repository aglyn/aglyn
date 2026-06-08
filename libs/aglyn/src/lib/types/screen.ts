/**
 * @license
 * Copyright 2023 Aglyn LLC
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

import type { ITimestamp } from '@aglyn/shared-util-timestamp'
import type { NodeId, NodeSchema } from '../types/nodes'
import { AglynDocument } from './shared'
import {
  type AglynAccessRule,
  type HostMediaUid,
  HostScreenStatus,
  HostScreenVisibility,
  type HostUid,
  type TenantUid,
  type UserUid,
} from './workspace'

export type ScreenUid = string
export type ScreenSlug = string
export type VersionUid = string
export type LayoutUid = string

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
