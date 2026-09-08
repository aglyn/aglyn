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
 * Deep merge that only FILLS IN what the target is missing: an existing
 * property on the target is never overwritten, however deep it sits. That is
 * the opposite polarity to `objectDeepMerge`, where the later operand wins.
 *
 * Kept out of the `@aglyn/shared-util-vendor` index deliberately (AGL-2682):
 * `mout` is a second package on top of the one `object-deep-merge` already
 * carries, and re-exporting it from the index put it in front of every file
 * that takes anything at all from that index — which on the tenant is every
 * published customer page. Import it by subpath.
 */
export { default as objectDeepMergeFillIn } from 'mout/object/deepFillIn'
