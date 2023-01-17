/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import {
  decode as msgpackDecode,
  type DecodeOptions,
  encode as msgpackEncode,
  type EncodeOptions,
} from '@msgpack/msgpack'
import type { SplitUndefined } from '@msgpack/msgpack/src/context'
import { FEATURE_FLAG } from './constants'

export function encode<ContextType = undefined>(
  value: unknown,
  options?: EncodeOptions<SplitUndefined<ContextType>>,
): Uint8Array {
  return msgpackEncode(value, options)
}
export function decode<ContextType = undefined>(
  buffer: ArrayLike<number> | BufferSource,
  options?: DecodeOptions<SplitUndefined<ContextType>>,
): unknown {
  return msgpackDecode(buffer, options)
}

export function _isFeatureExplicitlyDisabled(val: FEATURE_FLAG) {
  return Boolean(val === FEATURE_FLAG.DISABLED)
}
export function _isFeatureExplicitlyEnabled(val: FEATURE_FLAG) {
  return Boolean(val === FEATURE_FLAG.ENABLED)
}
export function _isFeatureDisabledDefault(val: FEATURE_FLAG) {
  return val === (val | FEATURE_FLAG.DISABLED_DEFAULT)
}
export function _isFeatureEnabledDefault(val: FEATURE_FLAG) {
  return val === (val | FEATURE_FLAG.ENABLED_DEFAULT)
}
export function _isFeatureUnknown(val: FEATURE_FLAG) {
  return val === FEATURE_FLAG.UNKNOWN || val === undefined || val === null
}
export function isFeatureDefaulted(val: FEATURE_FLAG) {
  return Boolean(val & FEATURE_FLAG.DEFAULT) || _isFeatureUnknown(val)
}
export function isFeatureDisabled(val: FEATURE_FLAG) {
  return Boolean(val & FEATURE_FLAG.DISABLED_DEFAULT)
}
export function isFeatureEnabled(val: FEATURE_FLAG) {
  return Boolean(val & FEATURE_FLAG.ENABLED_DEFAULT) || _isFeatureUnknown(val)
}
