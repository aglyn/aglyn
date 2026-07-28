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
 * What a publisher states about their own bundle before it enters the queue
 * (AGL-969).
 *
 * Deliberately NOT the staff checklist. Those items are judgements *about*
 * the publisher — "publisher is identifiable and contactable" is worthless
 * as self-attestation, because the answer is always yes. Every item here is
 * something only the publisher can know and a reviewer would otherwise have
 * to guess at or chase by email: whether the repo really holds this code,
 * whether they have the right to publish it, whether each declared host is
 * actually reached.
 *
 * Two things come out of this. Most review round-trips are questions the
 * publisher could have answered at submit time, so the queue moves faster.
 * And a false attestation is a timestamped statement by a named publisher
 * against specific bytes, which makes takedown a documented consequence
 * rather than a judgement call.
 *
 * This module is shared on purpose: the publish API is the enforcement
 * point, the upload dialog renders the same list, and the review page shows
 * staff what was claimed. Three copies of these strings would drift, and a
 * drifted attestation is one nobody can be held to.
 */
export interface PublisherAttestationItem {
  id: string
  /** First person — the publisher is the one saying it. */
  label: string
  /** What they are actually committing to, shown under the item. */
  detail: string
  /**
   * Only asked when the listing already exists. A first submission has no
   * "since the last version", and asking anyway teaches publishers that
   * some of these boxes are noise.
   */
  updateOnly?: boolean
}

export const PUBLISHER_ATTESTATION: readonly PublisherAttestationItem[] = [
  {
    id: 'repository',
    label: 'The repository URL is public and contains the source for this bundle',
    detail:
      'A reviewer opens it first. A repo that 404s, is private, or holds something unrelated is the cheapest reason a submission gets sent back.',
  },
  {
    id: 'license',
    label: 'A license is included and I have the right to publish this code',
    detail:
      'Missing or incompatible licensing is a legal problem for every workspace that installs it, not only for us.',
  },
  {
    id: 'data-disclosure',
    label:
      'The README documents what data this plugin reads, stores or sends, and where it goes',
    detail:
      'Anything the plugin does with member or page data belongs in the README before it is installed, not in a support thread afterwards.',
  },
  {
    id: 'network-hosts',
    label:
      'Every declared network host is required — I have removed the ones I do not use',
    detail:
      'Declared hosts become this plugin’s CSP connect-src. An allowlist wider than the plugin needs is the single most common thing review sends back, and it widens the blast radius if the bundle is ever compromised.',
  },
  {
    id: 'tested',
    label: 'I have tested this version on a site I control',
    detail:
      'These exact bytes, not an earlier build. Static review cannot tell a reviewer what your plugin does at runtime.',
  },
  {
    id: 'changelog',
    label: 'The changelog describes what changed since the last version',
    detail:
      'An update is where something slips through — the first version gets read closely, the fourth rarely does. Saying what moved is what makes reviewing a diff possible.',
    updateOnly: true,
  },
]

/** A stored attestation: who said it, when, and against which bytes. */
export interface AttestationEntry {
  by?: string
  at?: unknown
  sha256?: string
}

/**
 * The ids a submission must carry.
 *
 * `isUpdate` is decided server-side from whether a listing already exists,
 * never from a client flag — otherwise "this is my first version" becomes a
 * way to skip an item.
 */
export function requiredAttestationIds(isUpdate: boolean): string[] {
  return PUBLISHER_ATTESTATION.filter(
    (item) => isUpdate || !item.updateOnly,
  ).map((item) => item.id)
}

/**
 * Which required attestations a submission is missing, given the ids the
 * publisher ticked.
 */
export function missingAttestations(
  ticked: readonly string[] | null | undefined,
  isUpdate: boolean,
): string[] {
  const given = new Set(ticked ?? [])
  return requiredAttestationIds(isUpdate).filter((id) => !given.has(id))
}

/** Human labels for a set of ids, for an error a publisher can act on. */
export function attestationLabels(ids: readonly string[]): string[] {
  return ids
    .map((id) => PUBLISHER_ATTESTATION.find((item) => item.id === id)?.label)
    .filter((label): label is string => Boolean(label))
}

/**
 * Which stored attestations count for a given bundle.
 *
 * Keyed to sha256 exactly like the staff checklist (AGL-963) and the
 * verifier verdict (AGL-962): an attestation is a statement about specific
 * bytes, so a republish under the same version string re-asks. Carrying
 * ticks across a rebuild would let a publisher attest to code they then
 * replaced.
 */
export function attestationsForBytes(
  attestation: Record<string, AttestationEntry> | null | undefined,
  sha256: string,
): string[] {
  if (!sha256) return []
  return Object.entries(attestation ?? {})
    .filter(([, entry]) => entry?.sha256 === sha256)
    .map(([id]) => id)
}
