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

// A product film, placed the way aglyn.com's pages play it (AGL-3998).
//
// Every aglyn.com page that plays one of the product films does it through
// the "Marketing film band" reusable component: a `video` element whose
// `src` is the film on Wistia, whose `poster` is the film's poster frame in
// the org's media library, and whose title, description, date and duration
// feed the page's `VideoObject`. Each page's instance carries those values.
//
// A script that wants a film somewhere the band does not fit, such as one
// side of a deep-dive row, places a plain `video` node instead. This reads
// the node it should be from the live site rather than restating it: the
// band's own `video` node, with each `{{prop.x}}` binding filled from an
// instance on a page that already plays the film. So a placement can never
// disagree with the pages that play the same film, and a script that asks
// for a film no page plays refuses rather than guessing its address.

import { decode } from '@msgpack/msgpack'

/** "Marketing film band" on the aglyn.com host. */
export const FILM_BAND_COMPONENT = 'v4lEHGF7vh'

/** A whole `{{prop.name}}` binding, and nothing around it. */
const BINDING = /^\{\{prop\.([A-Za-z0-9_]+)\}\}$/

/**
 * `nodes` is stored as a plain map or as msgpack bytes. `byteOffset` and
 * `byteLength` always, because firebase-admin hands back pooled Buffers.
 */
const decodeNodes = (raw) =>
  Buffer.isBuffer(raw) ? decode(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)) : raw

/**
 * The props a `video` node plays a film with: the band's `video` node, each
 * binding read from one instance's values.
 *
 * @param {Record<string, any>} bandNodes the component document's node map
 * @param {Record<string, unknown>} propValues one instance's `propValues`
 * @returns {{ props: Record<string, unknown> } | { problem: string }}
 */
export function filmVideoProps(bandNodes, propValues) {
  const videos = Object.values(bandNodes ?? {}).filter((node) => node?.componentId === 'video')
  if (videos.length !== 1) return { problem: `the film band holds ${videos.length} video nodes, not one` }
  const props = {}
  for (const [key, value] of Object.entries(videos[0].props ?? {})) {
    const bound = typeof value === 'string' ? BINDING.exec(value) : null
    if (!bound) {
      props[key] = value
      continue
    }
    const filled = propValues?.[bound[1]]
    if (filled === undefined || filled === null || filled === '') {
      return { problem: `the instance leaves "${bound[1]}" empty, which the band's video "${key}" reads` }
    }
    props[key] = filled
  }
  return { props }
}

/**
 * The film whose poster is `poster`, as the live page `screenId` plays it.
 *
 * @param {object} options
 * @param {import('firebase-admin/firestore').Firestore} options.firestore
 * @param {string} options.hostId
 * @param {string} options.screenId a live page that plays the film in the band
 * @param {string} options.poster the poster frame's media reference
 * @returns {Promise<{ props: Record<string, unknown>, instanceId: string, versionId: string } | { problem: string }>}
 */
export async function readFilmVideo({ firestore, hostId, screenId, poster }) {
  const hostRef = firestore.collection('hosts').doc(hostId)
  const [screenSnap, bandSnap] = await Promise.all([
    hostRef.collection('screens').doc(screenId).get(),
    hostRef.collection('components').doc(FILM_BAND_COMPONENT).get(),
  ])
  const versionId = screenSnap.get('versionId')
  if (!screenSnap.exists || screenSnap.get('deletedAt') || !versionId) {
    return { problem: `screen ${screenId} is missing, deleted or unpublished` }
  }
  if (!bandSnap.exists || bandSnap.get('deletedAt')) {
    return { problem: `the film band ${FILM_BAND_COMPONENT} is missing or deleted` }
  }
  const versionSnap = await hostRef.collection('screens').doc(screenId).collection('versions').doc(versionId).get()
  const instances = Object.values(decodeNodes(versionSnap.get('nodes')) ?? {}).filter(
    (node) =>
      node?.componentId === 'reusableInstance' &&
      node.props?.refId === FILM_BAND_COMPONENT &&
      node.props?.propValues?.posterImage === poster,
  )
  if (instances.length !== 1) {
    return { problem: `screen ${screenId} plays ${instances.length} film bands with the poster ${poster}, not one` }
  }
  const film = filmVideoProps(decodeNodes(bandSnap.get('nodes')), instances[0].props.propValues)
  if ('problem' in film) return { problem: `screen ${screenId}: ${film.problem}` }
  if (film.props.poster !== poster) return { problem: `the band's video does not take its poster from posterImage` }
  return { props: film.props, instanceId: instances[0].$id, versionId }
}
