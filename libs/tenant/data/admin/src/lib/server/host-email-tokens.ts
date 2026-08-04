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

import {
  hostTokenMerge,
  type HostTokenSource,
} from '@aglyn/aglyn/app-utils/host-tokens'
import {
  renderHostEmail,
  type RenderedHostEmail,
} from '@aglyn/shared-util-email'
import { firebaseAdmin } from './firebase-admin'

/**
 * `renderHostEmail` with `host.*` tokens resolved (AGL-1022).
 *
 * The whole point of host variables is that a publisher's email template can
 * say "write to {{host.supportEmail}}" and have the installing site fill it in.
 * That only happens if something resolves the tokens at SEND time, and the
 * email library cannot: `@aglyn/shared-util-email` is `scope:shared` and may
 * only depend on `scope:shared`, while the token registry is aglyn-scoped.
 *
 * So the join happens here, in the one lib that already sits above both. Three
 * alternatives were weighed and this is the one that cannot fail quietly:
 *
 * * A registration hook inside the email library would mean a provider that is
 *   never registered resolves every token to nothing, silently, on a path whose
 *   output has already been sent to a customer. This repo has shipped a
 *   flawless security control with zero callers before; that is the shape.
 * * Threading the map through all eighteen call sites puts the burden on
 *   whoever adds the nineteenth, and they will not know.
 * * Moving the registry into a `scope:shared` lib is the cleanest end state and
 *   the right thing if a second shared consumer ever appears — but the only
 *   candidate today is `shared/util/tools`, which is generic helpers, and
 *   domain logic does not belong there.
 *
 * Costs one host read per send. Emails are not a hot path, and the read buys
 * the guarantee that a template's branding is right by construction.
 */
export async function renderHostEmailWithTokens(
  firestore: FirebaseFirestore.Firestore,
  hostId: string,
  templateKey: string,
  merge: Record<string, string> = {},
  options: { origin?: string } = {},
): Promise<RenderedHostEmail | null> {
  let host: HostTokenSource | null = null
  try {
    const snapshot = await firestore.collection('hosts').doc(hostId).get()
    host = snapshot.exists ? (snapshot.data() as HostTokenSource) : null
  } catch {
    // A failed read must not stop the send. Every token then resolves to its
    // empty behaviour, which is the same outcome as a site that set nothing —
    // an email with a gap where the address would be, rather than no email.
    host = null
  }
  return renderHostEmail(
    firestore as never,
    hostId,
    templateKey,
    // Host tokens first: an explicit caller value WINS. A sender passing
    // `host.businessName` is naming a specific thing on purpose (a white-label
    // send, a preview with sample data), and this is not the place to overrule
    // it.
    { ...hostTokenMerge(host), ...merge },
    options,
  )
}

export default renderHostEmailWithTokens
