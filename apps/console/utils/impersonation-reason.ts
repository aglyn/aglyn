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
 * The reason a staff member gives for signing in as a customer (AGL-2125).
 *
 * One module for the route that enforces it, the console dialog that asks for
 * it, and the staff apps (AGL-3667), whose "Sign in as this customer" prompt
 * reads the minimum from here through `generate-native-staff-constants`, so the
 * three cannot drift apart.
 */

/**
 * Long enough to be a sentence fragment, short enough not to obstruct. Chosen
 * against the shortest genuinely useful reasons staff actually write
 * ("ticket 481", "repro billing"), both of which clear it.
 */
export const IMPERSONATION_MIN_REASON_LENGTH = 8

/** Bounds the stored row; an audit entry is evidence, not a scratchpad. */
export const IMPERSONATION_MAX_REASON_LENGTH = 500
