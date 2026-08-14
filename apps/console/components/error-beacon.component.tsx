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
'use client'

import { installErrorBeacon } from '@aglyn/aglyn/app-utils/error-beacon'

/**
 * Mounts the first-party error beacon (AGL-1538). Renders nothing; the
 * install happens at MODULE scope, not in an effect, for the same reason the
 * firebase-app layout registers its seams there — an error thrown during
 * boot, before any effect has run, is precisely the kind this exists to
 * catch. The installer no-ops during SSR and on repeat evaluation.
 */
installErrorBeacon()

export default function ErrorBeacon(): null {
  return null
}
