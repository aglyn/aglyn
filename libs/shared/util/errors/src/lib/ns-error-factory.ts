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

import {_isArr} from '@aglyn/shared-util-guards'
import {NsError} from './ns-error'
import {replaceTemplate} from './tools'
import type {ErrorPayload, ErrorTagMessages, ErrorTagPayloads, EventFlag} from './types'


/**
 * Standardized App Errors
 *
 * Usage:
 * ```typescript
 *   // Typescript string literals for type-safe codes
 *   type Err =
 *     'unknown' |
 *     'object-not-found'
 *     ;
 *
 *   // Closure enum for type-safe error codes
 *   // at-enum {string}
 *   var Err = {
 *     UNKNOWN: 'unknown',
 *     OBJECT_NOT_FOUND: 'object-not-found',
 *   }
 *
 *   let : Map<Err, string> = {
 *     'generic-error': "Unknown error",
 *     'file-not-found': "Could not find file: {$file}",
 *   };
 *
 *   // Type-safe function - must pass a valid error code as param.
 *   let error = new ErrorFactory<Err>('scope', 'Service', templates);
 *
 *   ...
 *   throw error.create(Err.GENERIC);
 *   ...
 *   throw error.create(Err.FILE_NOT_FOUND, {'file': fileName});
 *   ...
 *   // Service: Could not file file: foo.txt (scope/file-not-found).
 *
 *   catch (e) {
 *     assert(e.message === "Could not find file: foo.txt.");
 *     if (e.code === 'scope/file-not-found') {
 *       console.log("Could not read file: " + e['file']);
 *     }
 *   }
 * ```
 * @see inspired by:
 *   https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error#Custom_Error_Types
 */
export class NsErrorFactory<T extends string = EventFlag, U extends ErrorTagPayloads = ErrorTagPayloads> {

  constructor(
    private readonly scope: string,
    private readonly namespace: string,
    private readonly templates: ErrorTagMessages<T>,
    private readonly nsDelimiter: string = '/',
    private readonly scopeDelimiter: string = ':',
    private readonly defaultMessage: string = 'Error',
  ) {
    this.create = this.create.bind(this)
  }

  protected makeShortCode<K extends T>(flag: K): string {
    return [this.namespace, flag].join(this.nsDelimiter)
  }
  protected makeFullCode(shortCode: string): string {
    return [this.scope, shortCode].join(this.scopeDelimiter)
  }
  protected makeShortMessage<K extends T>(flag: K, payload?: ErrorPayload): string {
    const template = this.templates[flag]
    return template ? replaceTemplate(template, payload) : this.defaultMessage
  }
  protected makeFullMessage(shortCode: string, shortMessage: string): string {
    // Scope - Error message (namespace/flag).
    return `[${this.scope}] - ${shortMessage} (${shortCode}).`
  }

  /**
   * Build a new throwable
   * @example
   * ```
   * let age: string | number = 101
   * const errorFactory = new NsErrorFactory('domain', 'my-lib', {
   *   ['bad-string']: "Provided an invalid string '{$str}'"
   * })
   * if (typeof age !== 'string') {
   *   throw errorFactory.create('bad-string', {str: age})
   *   // Out = domain - Provided an invalid string '101' (my-lib/bad-string)
   *   // Full Code = domain::my-lib/bad-string
   * }
   * ```
   *
   * @param flag - error event identifier
   * @param payload - payload data to set template variable values
   * @returns NsError
   */
  create<K extends T>(flag: K, ...payload: K extends keyof U ? [U[K]] : []): NsError {
    const data: ErrorPayload = (_isArr(payload) && payload[0]) || {},
      shortCode = this.makeShortCode(flag),
      fullCode = this.makeFullCode(shortCode),
      shortMessage = this.makeShortMessage(flag, data),
      fullMessage = this.makeFullMessage(fullCode, shortMessage)

    return new NsError(fullCode, fullMessage, data)
  }

  childFactory<T extends string, U extends ErrorTagPayloads<T>>(
    childNamespace: string,
    templates?: ErrorTagMessages<T>,
  ) {
    return new NsErrorFactory<T, U>(
      this.scope,
      [this.namespace, childNamespace].join(this.nsDelimiter),
      (templates || this.templates) as ErrorTagMessages<T>,
      this.nsDelimiter,
      this.scopeDelimiter,
      this.defaultMessage,
    )
  }
}
