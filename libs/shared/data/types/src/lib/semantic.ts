/**
 * @license
 * Copyright 2023 Aglyn LLC
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

export namespace Version {
  // Example:
  // 1.0.0-alpha
  // ^ 1.0.0-alpha.1
  // ^ 1.0.0-alpha.beta
  // ^ 1.0.0-beta
  // ^ 1.0.0-beta.2
  // ^ 1.0.0-beta.11
  // ^ 1.0.0-rc.1
  // ^ 1.0.0.

  export type NiD = string | number
  export type PreName = 'canary' | 'alpha' | 'beta' | 'rc'

  export type Major<N extends NiD = 0> = `${N}`
  export type Minor<N extends NiD = 0> = `.${N}`
  export type Patch<N extends NiD = 0> = `.${N}`

  export type Pre<
    PRN extends OrUndef<PreName> = undefined,
    PRV extends OrUndef<NiD> = 0,
  > = Conditional<
    PRN,
    PreName,
    Conditional<PRV, NiD, `-${PRN}.${PRV}`, `-${PRN}`>
  >
  export type Build<N extends OrUndef<NiD> = undefined> = Conditional<N, NiD, `+${N}`>

  export type Semantic<
    MAJ extends NiD = 0,
    MIN extends NiD = 0,
    PAT extends NiD = 0,
    PRN extends OrUndef<PreName> = undefined,
    PRV extends OrUndef<NiD> = undefined,
    BLD extends OrUndef<NiD> = undefined,
  > = `${Major<MAJ>}${Minor<MIN>}${Patch<PAT>}${Pre<PRN, PRV>}${Build<BLD>}`
}
