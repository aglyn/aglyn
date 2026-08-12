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

import { encode } from '@msgpack/msgpack'

/** Firestore's hard per-document ceiling. */
export const FIRESTORE_DOC_LIMIT_BYTES = 1_048_576

/**
 * Refuse above this. Deliberately below the real limit: the encoded node
 * map is not the only thing in the document, and a save that squeaks under
 * 1 MiB today fails on the next small edit — which is a worse experience
 * than being told early.
 */
export const NODE_MAP_MAX_BYTES = 900_000

/** Start warning here, while there is still room to act. */
export const NODE_MAP_WARN_BYTES = 700_000

export interface NodeMapSize {
  bytes: number
  /** Over the refuse threshold. */
  tooLarge: boolean
  /** Past the warn threshold but still saveable. */
  nearLimit: boolean
  /** Node ids by encoded size, largest first — the ones worth looking at. */
  largest: Array<{ id: string; bytes: number }>
}

/**
 * Measure a node map the way it will actually be stored (AGL-678).
 *
 * Screen and layout versions are msgpack-encoded into a single `Bytes`
 * field, and nothing checked the result against Firestore's 1 MiB document
 * limit — so a large enough screen simply stopped saving, with a generic
 * write rejection, no indication that size was the problem, and no way to
 * find the offending content except by deleting things and retrying.
 *
 * Measures with the same encoder used at rest rather than `JSON.stringify`,
 * because msgpack is materially denser and a JSON estimate would refuse
 * documents that would have saved fine.
 *
 * Also reports the biggest individual nodes. In practice the cause is one
 * inlined image data URI rather than a thousand ordinary nodes, and naming
 * it turns "your page is too big" into something actionable.
 */
export function measureNodeMap(
  nodes: Record<string, unknown> | undefined | null,
): NodeMapSize {
  if (!nodes) {
    return { bytes: 0, tooLarge: false, nearLimit: false, largest: [] }
  }
  let bytes = 0
  try {
    bytes = encode(nodes).length
  } catch {
    // Unencodable content is a different failure; let the write surface it
    // rather than blocking the save on a measurement we could not take.
    return { bytes: 0, tooLarge: false, nearLimit: false, largest: [] }
  }

  const largest: Array<{ id: string; bytes: number }> = []
  for (const [id, node] of Object.entries(nodes)) {
    try {
      largest.push({ id, bytes: encode(node).length })
    } catch {
      // Skip nodes we cannot size; the total above is what gates the save.
    }
  }
  largest.sort((a, b) => b.bytes - a.bytes)

  return {
    bytes,
    tooLarge: bytes > NODE_MAP_MAX_BYTES,
    nearLimit: bytes > NODE_MAP_WARN_BYTES && bytes <= NODE_MAP_MAX_BYTES,
    largest: largest.slice(0, 3),
  }
}

/**
 * Encoded size of a node map, and nothing else (AGL-1402).
 *
 * Same unit as {@link measureNodeMap} — msgpack bytes, the form the map is
 * actually stored in — so a total built out of this is directly comparable to
 * the per-document {@link NODE_MAP_MAX_BYTES} ceiling.
 *
 * Split out because the monthly usage rollup measures thousands of documents
 * and wants one number per document. `measureNodeMap` re-encodes every node
 * individually to build `largest`, which roughly doubles the work for a
 * diagnostic that only the save path reads.
 *
 * Returns 0 for absent AND for unencodable, matching `measureNodeMap`: a
 * measurement we could not take must not become a number somebody trusts.
 */
export function nodeMapBytes(
  nodes: Record<string, unknown> | undefined | null,
): number {
  if (!nodes) return 0
  try {
    return encode(nodes).length
  } catch {
    return 0
  }
}

/** Human-readable size, for messages that a person has to act on. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_048_576).toFixed(1)} MB`
  if (bytes >= 1_000) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} bytes`
}

export default measureNodeMap
