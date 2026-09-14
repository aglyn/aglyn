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

/**
 * The activity writer for a whole-resource copy (AGL-2936).
 *
 * One row per copy in the site's feed and one in the workspace's, both
 * carrying the `<kind>.duplicated` code from the shared catalog so the feed
 * translates it once and a filter on "duplicated" finds every kind's copies
 * together. The row's target is the COPY — that is the document a reader
 * wants to open from the feed — and the original is named in the free text
 * beside it, because the target shape carries one id and the copy's is the
 * one every deep link needs.
 *
 * A kind the activity unions have no member for files under `content`, the
 * same classification the create routes give it: a persisted type no
 * presenter branches on would render as an unlinked row.
 */

import {
  DUPLICATE_ACTIVITY_ACTIONS,
  type DuplicableResourceKind,
} from '@aglyn/aglyn/app-utils/duplicate-resource'
import {
  logHostActivity,
  logOrgActivity,
  type HostActivityTarget,
  type OrgActivityTarget,
} from './organizations'

/** The target type each kind's row is filed under, in both feeds. */
const TARGET_TYPE: Record<
  DuplicableResourceKind,
  Extract<OrgActivityTarget['type'], HostActivityTarget['type']>
> = {
  screen: 'screen',
  emailDesign: 'screen',
  component: 'component',
  layout: 'layout',
  template: 'template',
  workflow: 'workflow',
  form: 'content',
  emailTemplate: 'content',
  campaign: 'content',
}

export interface ResourceDuplicatedActor {
  uid: string
  email?: string | null
}

export interface ResourceDuplicated {
  orgId: string
  /** Absent for a workspace-level resource, which has no site feed. */
  hostId?: string | null
  source: { id: string; name: string }
  target: { id: string; name: string; versionId?: string | null }
}

/** `<name> · from <source name>`, the only free text the row carries. */
export function duplicatedTargetName(copy: ResourceDuplicated): string {
  const target = copy.target.name.trim()
  const source = copy.source.name.trim()
  return source ? `${target} · from ${source}` : target
}

/** `<kind>.duplicated` — a whole copy of a resource was made. */
export async function logResourceDuplicated(
  kind: DuplicableResourceKind,
  actor: ResourceDuplicatedActor,
  copy: ResourceDuplicated,
): Promise<void> {
  const action = DUPLICATE_ACTIVITY_ACTIONS[kind]
  const target = {
    type: TARGET_TYPE[kind],
    id: copy.target.id,
    name: duplicatedTargetName(copy),
    ...(copy.target.versionId ? { versionId: copy.target.versionId } : {}),
  }
  const person = { uid: actor.uid, email: actor.email ?? null }
  if (copy.hostId) await logHostActivity(copy.hostId, person, action, target)
  await logOrgActivity(copy.orgId, person, action, target)
}
