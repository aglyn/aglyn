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

/*
 * Jest's node environment, with the host's typed array constructors
 * (AGL-3656).
 *
 * Jest runs a spec in its own realm, so a Node `Buffer` (made by the host)
 * is not an `instanceof Uint8Array` of the spec's realm. wawoff2's
 * Emscripten binding asks exactly that before it will compress a font, and
 * refuses a `Buffer` that every real Node process accepts. Sharing the
 * host's constructors makes the spec's realm agree with production.
 */
const { TestEnvironment } = require('jest-environment-node')

class SharedTypedArraysEnvironment extends TestEnvironment {
  constructor(config, context) {
    super(config, context)
    this.global.Uint8Array = Uint8Array
    this.global.ArrayBuffer = ArrayBuffer
  }
}

module.exports = SharedTypedArraysEnvironment
