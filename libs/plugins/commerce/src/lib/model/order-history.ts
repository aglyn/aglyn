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
 * A site's order HISTORY, for another plugin (AGL-3614). The service is
 * commerce's contract with other plugins and lives in `../contracts`
 * (AGL-3980), which a reader imports as `@aglyn/plugins-commerce/contracts`;
 * it is re-exported here for commerce's own code, which registers the one
 * implementation from its console server declarations.
 */

export { ORDER_HISTORY_CONTRACT, ORDER_HISTORY_CONTRACT_ID } from '../contracts'
export type { OrderHistoryEntry, OrderHistoryPageRequest, OrderHistoryReader } from '../contracts'
