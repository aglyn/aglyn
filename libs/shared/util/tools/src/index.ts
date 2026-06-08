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

export * from './lib/str'
export * from './lib/apply-mixins'
export * from './lib/copy'
export * from './lib/copy-shallow'
export * from './lib/create-chained-function'
export * from './lib/crud'
export * from './lib/css'
export * from './lib/falsy'
export * from './lib/get-display-name'
export * from './lib/get-property'
export * from './lib/get-static-field'
export * from './lib/gravatar-url-from-email'
export * from './lib/interop-default'
export * from './lib/length'
export * from './lib/no-side-effects'
export * from './lib/noop'
export * from './lib/normalized'
export * from './lib/numeronym'
export * from './lib/trim'
export * from './lib/truthy'

// ARRAY

export * from './lib/array/array-copy-deep'
export * from './lib/array/array-copy-shallow'
export * from './lib/array/array-from'
export * from './lib/array/array-from-length'
export * from './lib/array/array-move-at-index'
export * from './lib/array/array-of-entries-to-object'
export * from './lib/array/array-overrides'
export * from './lib/array/array-push-at-index'
export * from './lib/array/array-remove-at-index'
export * from './lib/array/array-remove-item'
export * from './lib/array/array-safe'
export * from './lib/array/array-sort-by'
export * from './lib/array/array-sort-by-deep-property'
export * from './lib/array/array-update'
export * from './lib/array/array-update-at-index'

// BITWISE

export * from './lib/bitwise/bitwise-has-all-attributes'
export * from './lib/bitwise/bitwise-has-attribute'
export * from './lib/bitwise/bitwise-has-only-attributes'

// GUARDS

export * from './lib/guards'

// NUMBER

export * from './lib/number/to-num'
export * from './lib/number/number-to-hexadecimal'
export * from './lib/number/number-from-hexadecimal'

// OBJECT

export * from './lib/object/object-clone'
export * from './lib/object/object-clone-deep'
export * from './lib/object/object-delete-property'
export * from './lib/object/object-get-deep-property'
export * from './lib/object/object-get-keys-and-symbol-properties'
export * from './lib/object/object-remap'
export * from './lib/object/object-safe'
export * from './lib/object/object-set-deep-property'
export * from './lib/object/object-update'

// OPERATOR

export * from './lib/operator'

// SERIALIZE

export * from './lib/serialize/base64-isomorphic-decode'
export * from './lib/serialize/base64-isomorphic-encode'
export * from './lib/serialize/php-serial-deserialize-from-byte-stream'
export * from './lib/serialize/php-serial-is-serialized-byte-stream'
export * from './lib/serialize/php-serial-serialize-to-byte-stream'
export * from './lib/serialize/json-deserialize'
export * from './lib/serialize/json-serialize'
