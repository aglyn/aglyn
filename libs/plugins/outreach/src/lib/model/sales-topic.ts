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
 * The stream an outbound sequence's mail is sent under: one person here
 * writing to another about working together.
 *
 * Declared in `plugins.config.json` (`subscriptionTopics`) with its name and
 * description; named here wherever a send or a gate asks about it, because a
 * mistyped id names a stream nobody has opted out of and the gate then
 * refuses nobody. A wire value — it keys every recorded opt-out and rides in
 * every signed unsubscribe link — so it is never renamed.
 */
export const SALES_TOPIC_ID = 'sales'
