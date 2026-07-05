/**
 * @license
 * Copyright 2021 Aglyn LLC
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



export type NumeronymOpts = {
  kind?: NumeronymKind
  short?: boolean
}

export enum NumeronymKind {
  n19s = 'NumericalContractions' /* first letter + len between(+ last letter) */,
  A9bs = 'AlphanumericAbbreviationS' /* AlphaN. = A9, Abbr. = bs */,
  A2S = 'AlphanumericAcronymS' /* (2) A's and (1) S (e.g. W3 or W3C) */,
}

/**
 * Create a numeronym string from the provided string of characters
 *
 * e.g.
 * ```typescript
 * const intl = 'Internationalization'
 * numeronym(intl, {kind: NumeronymKind.n19s})
 * // result: I18n
 * ```
 *
 * @export
 * @param {string} str
 * @param {NumeronymOpts} [opt]
 * @returns
 */
export function numeronym(str: string, opt?: NumeronymOpts) {
  const {kind, short} = opt ?? {}
  const builder = {
    [NumeronymKind.n19s]: () => {
      const v = String(str)
      const ln = v.length
      if (ln < 2) {
        return v
      }
      if (ln < 3 || short) {
        return `${v[0]}${ln - 1}`
      }
      return `${v[0]}${ln - 2}${v[ln - 1]}`
    },
  }

  return (builder as Record<string, () => string>)[kind ?? NumeronymKind.n19s]()
}
