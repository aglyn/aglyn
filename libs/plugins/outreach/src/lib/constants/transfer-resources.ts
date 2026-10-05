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

import type { MatchKeySpec } from '@aglyn/aglyn/data-transfer'

/**
 * What the console's boot and the console registrar name the do-not-contact
 * transfer resource by, kept apart from the resource itself
 * (`transfer/do-not-contact-transfer.ts`) so registering it loads nothing.
 */

/** The resource key, as `plugins.config.json` declares it. */
export const OUTREACH_DO_NOT_CONTACT_TRANSFER_KEY = 'outreach.do-not-contact'

/** What the hub and the wizard call it. */
export const OUTREACH_DO_NOT_CONTACT_TRANSFER_LABEL = 'Do-not-contact list'

/**
 * The keys a row finds its entry by, read synchronously at registration: the
 * Aglyn ID (`id`, the core's `TRANSFER_ID_FIELD`), then the entry itself —
 * an address or a domain, which the resource's `lookup` resolves to the
 * document it names.
 */
export const OUTREACH_DNC_MATCH_KEYS: readonly MatchKeySpec[] = [
  { fieldId: 'id', normalizer: 'aglynId' },
  { fieldId: 'entry', normalizer: 'caseless' },
]
