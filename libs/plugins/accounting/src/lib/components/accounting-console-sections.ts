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

export type AccountingConsoleSectionId = 'connection' | 'activity'

/**
 * The Accounting page's sections, in rail order (AGL-3614). `plugin.ts`
 * registers the list on the org nav item, and the page switches its body on
 * the id the shell resolves back. Ids are persisted vocabulary: the OAuth
 * callback sends a member back to `/[orgSlug]/accounting/connection`, the
 * address registered nowhere but built from this id.
 */
export const ACCOUNTING_CONSOLE_SECTIONS: readonly ConsoleNavSection[] = [
  { id: 'connection', label: 'Connection' },
  { id: 'activity', label: 'Sync activity' },
]
