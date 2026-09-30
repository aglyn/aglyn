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

import type {
  SystemEmailDefaultBlock,
  SystemEmailMergeToken,
} from './system-email-catalog'
import { PLUGIN_TENANT_EMAILS } from './tenant-emails.generated'

/**
 * How a site owner controls a tenant email's copy (AGL-769/770):
 *
 * `besigner` — designable here, per site, in the email besigner. The send
 *   site resolves the designed template and falls back to built-in copy.
 * `external` — already authored in another part of the console (a marketing
 *   campaign, a workflow), so the reference links there instead of offering a
 *   second editor.
 * `fixed` — fixed copy inside the plugin, not customizable yet. Listed for
 *   visibility; becomes `besigner` once its send site is wired.
 */
export type TenantEmailControl = 'besigner' | 'external' | 'fixed'

export interface TenantEmailEntry {
  /** Stable key — the `hosts/{hostId}/emailTemplates` document id. */
  key: string
  name: string
  description: string
  /** Plugin that owns the send (matches org.enabledPlugins). */
  pluginId: string
  plugin: string
  control: TenantEmailControl
  /** `external`: where the copy is authored, shown as the link/label. */
  authoredIn?: string
  /** `besigner`: subject used when no template is published. */
  defaultSubject?: string
  /** `besigner`: tokens the send site supplies. */
  mergeTokens?: readonly SystemEmailMergeToken[]
  /** `besigner`: starting content the editor seeds and the default renders. */
  defaultBody?: readonly SystemEmailDefaultBlock[]
  /**
   * The footer's "why am I getting this" line (AGL-3370), under the built-in
   * copy and under every text-only send of this kind, in the site's header
   * and footer. Names the site by `{{host.businessName}}`, which every site
   * email resolves; never the platform, which the reader has not heard of.
   */
  footerReason?: string
  /**
   * Entitlement flag the SEND is gated on, when one is (AGL-2081).
   *
   * `enabledPlugins` decides whether a template appears at all; this is the
   * narrower question of whether the send behind an appearing template can
   * actually happen. `abandoned-cart` is the case that named it: the template
   * has always been listed and designable on every plan, while
   * `process-abandoned.ts` refuses to send it without `abandonedCart` — so
   * the Emails page showed a template that could never send, and read
   * exactly like one that could.
   *
   * A plain string rather than `keyof OrgFeatureFlags` to keep this lib off
   * the billing lib's dependency edge; the console resolves it through
   * `checkEntitlement`, and a spec asserts every value here is a real flag.
   */
  requiresFeature?: string
}

/**
 * The transactional emails a SITE sends to its own end-users (AGL-769/770).
 *
 * Distinct from the platform system emails (mail Aglyn sends about the
 * account). These are tenant-owned: a site sends them to its customers. Flat
 * list keyed for the host-scoped template store and the `renderHostEmail`
 * resolver; the console UI groups by `pluginId`. Code-defined and fixed — the
 * set is whatever the plugins actually send.
 *
 * Each plugin declares its own entries (its `tenantEmails` entry in
 * plugins.config.json) and the manifest generator compiles them here, in
 * config order (AGL-3080). Compiled rather than registered, because the send
 * path reads this list without loading any plugin: a registry it had not
 * filled would find no entry and send the text card instead of the site's
 * designed email, with nothing failing.
 */
export const TENANT_EMAILS: readonly TenantEmailEntry[] = PLUGIN_TENANT_EMAILS

/** Firestore subcollection under a host holding its designed templates. */
export const TENANT_EMAIL_COLLECTION = 'emailTemplates'

export function getTenantEmail(key: string): TenantEmailEntry | undefined {
  return TENANT_EMAILS.find((entry) => entry.key === key)
}

/** True when a site owner can design this email in the besigner. */
export function isTenantEmailEditable(entry: TenantEmailEntry): boolean {
  return entry.control === 'besigner'
}
