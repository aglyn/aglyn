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

// `createResourceUid()` for scripts under `tools/`, which cannot import the
// TypeScript one (AGL-3079).
//
// The platform names every console resource with
// `libs/aglyn/src/lib/app-utils/create-resource-uid.ts`:
//
//     createUid(RESOURCE_ID_LENGTH)   // createUid is nanoid; RESOURCE_ID_LENGTH is 10
//
// A `.mjs` under `tools/` has no build step and cannot resolve
// `@aglyn/shared-util-vendor` from source, so it cannot call that function. The
// result, until now, was that every tools script naming a document reached for
// `collection.doc()` and took a row in `id-minting-allowlist.json` — a list
// that may only shrink. There are several such rows today, including
// `place-demo-plugin-node.mjs: screenRef.collection('versions').doc()`, which is
// the very same operation as `pour-page.mjs`.
//
// So this is the same id, minted the same way, in the one form a tools script
// can actually call — and it gives those allowlist rows somewhere to go.
//
// ⚠️ It is a SECOND statement of the platform's id shape, which is a thing that
// can drift. It is deliberately one line over two named constants so a drift is
// obvious, and `resource-uid.test.mjs` pins both against the TypeScript source
// that owns them: change `RESOURCE_ID_LENGTH` or swap `createUid` off nanoid and
// that test fails here.

import { nanoid } from 'nanoid'

/** `RESOURCE_ID_LENGTH` in `libs/aglyn/src/lib/foundation/constants/app.ts`. */
export const RESOURCE_ID_LENGTH = 10

/** The id every console resource carries. Mirrors `createResourceUid()`. */
export function createResourceUid() {
  return nanoid(RESOURCE_ID_LENGTH)
}
