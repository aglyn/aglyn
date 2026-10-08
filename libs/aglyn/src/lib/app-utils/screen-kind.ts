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
 * `kind` of a besigner email document (AGL-395): a screen authored on the
 * Emails page and sent by a campaign, never served at a URL.
 *
 * A leaf of its own so a pure model (the email design documents, which the
 * native apps' contracts read) can name it without `screen-route`, which
 * reaches the foundation barrel.
 */
export const SCREEN_KIND_EMAIL = 'email'
