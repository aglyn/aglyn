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

import type { ConsoleNavSection } from '@aglyn/aglyn'

export type CommerceConsoleSectionId =
  | 'catalog'
  | 'orders'
  | 'promotions'
  | 'reservations'
  | 'settings'
  | 'analytics'

/**
 * The commerce console's sections, in rail order (AGL-693).
 *
 * One list, read twice and never copied: `plugin.ts` registers it on the nav
 * item so the shell can route and gate each section, and the page switches its
 * body on the id the shell resolves back. A second copy is how a section comes
 * to be routable under one id and drawn under another.
 *
 * Ids appear in links people keep — treat them as persisted, and rename a
 * LABEL rather than an id.
 *
 * No `navTabId` on any of them: every section here ships with the surface, so
 * they inherit the Products nav item's gate. A section that ships later
 * declares its own, which ANDs with the parent's rather than replacing it.
 */
export const COMMERCE_CONSOLE_SECTIONS: readonly ConsoleNavSection[] = [
  { id: 'catalog', label: 'Catalog' },
  { id: 'orders', label: 'Orders' },
  { id: 'promotions', label: 'Promotions' },
  { id: 'reservations', label: 'Reservations' },
  { id: 'settings', label: 'Settings' },
  { id: 'analytics', label: 'Analytics' },
]

/*
 * Rail ORDER decides where `/products` lands: the shell redirects a bare hub
 * URL to the first section in this list the reader may open (AGL-693). There
 * is deliberately no separate default constant — a second place to say which
 * section is first is a second place for it to disagree with the rail.
 */
