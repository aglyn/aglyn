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

export type MarketingConsoleSectionId = 'overview' | 'overlays' | 'experiments'

/**
 * The marketing console's sections, in rail order (AGL-2501).
 *
 * One list, read twice and never copied: `plugin.ts` registers it on the nav
 * item so the shell can route and gate each section, and the page switches its
 * body on the id the shell resolves back.
 *
 * Ids are the `?tab=` ids this page already deep-linked by, kept deliberately
 * so a bookmark that named a tab names the same section as a route. `experiments`
 * therefore keeps its id while its LABEL reads "A/B testing".
 *
 * No `navTabId` on any of them: they inherit the Marketing nav item's gate.
 * The per-card ENTITLEMENT checks are unchanged and still live in the cards —
 * overlays and A/B are distinct plan flags, and a plan is not a release flag.
 */
export const MARKETING_CONSOLE_SECTIONS: readonly ConsoleNavSection[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'overlays', label: 'Overlays' },
  { id: 'experiments', label: 'A/B testing' },
]

/*
 * Rail ORDER decides where `/marketing` lands: the shell redirects a bare hub
 * URL to the first section in this list the reader may open (AGL-2501). There
 * is deliberately no separate default constant — a second place to say which
 * section is first is a second place for it to disagree with the rail.
 */
