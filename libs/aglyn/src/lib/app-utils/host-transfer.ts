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

/*
 * What moving a site to another organization would do (AGL-3381), as the
 * staff console's confirmation reads it. Planned and performed by
 * `transferHost` in `@aglyn/tenant-data-admin/server/transfer-host`; the
 * shape lives here so the dialog can read it without reaching a server module.
 */

/** Why a transfer cannot go ahead, in words a staffer can act on. */
export interface HostTransferHold {
  code:
    | 'no-site'
    | 'no-destination'
    | 'same-organization'
    | 'consent-group'
    | 'site-limit'
    | 'sending-domain'
    | 'in-flight'
  message: string
}

/** Everything a transfer would do, and everything it would not. */
export interface HostTransferPlan {
  hostId: string
  siteName: string | null
  fromOrgId: string | null
  fromOrgName: string | null
  toOrgId: string
  toOrgName: string | null
  /** Refusals. The transfer runs only when this is empty. */
  holds: HostTransferHold[]
  /** What is true after the transfer that a staffer should say out loud. */
  warnings: string[]
  facts: {
    /** Media in the old organization's library scoped to this site. */
    mediaStaying: number
    /** Plugin documents the site owns that stay as the old organization's history. */
    ownedDocumentsStaying: Array<{ collection: string; count: number }>
    /** Old members whose only reach into the site was a per-site grant. */
    collaboratorsLosingAccess: number
    /** The dedicated sending domain that moves with the site, if any. */
    sendingDomain: string | null
    /** Plugins the site runs now that the destination does not enable. */
    pluginsLost: string[]
    /** The destination's sites against its limit. */
    siteLimit: { used: number; limit: number; allowed: boolean }
  }
}

