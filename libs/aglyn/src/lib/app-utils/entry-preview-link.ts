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
 * The two names the live-site preview of a collection entry is built from
 * (AGL-3205), and nothing else.
 *
 * DEPENDENCY-FREE ON PURPOSE. The tenant middleware reads the parameter name
 * to decide whether a request is a preview, and the middleware runs on the
 * edge: it deep-imports its pure helpers precisely so a bundle meant to answer
 * in a millisecond does not drag a barrel — `accept-negotiation` and the theme
 * utilities carry the same note. This module imports nothing at all, so it
 * costs the edge bundle two string constants.
 *
 * Four surfaces have to agree on these, in three different apps: the console
 * mints the URL, the tenant middleware routes on the parameter, the tenant
 * preview page reads it, and the screens authoring rules reserve the segment.
 * A literal in four places is a rename waiting to break one of them.
 */

/**
 * The query parameter a preview link carries.
 *
 * Namespaced with the brand so it cannot collide with a parameter a customer's
 * own page already reads, and `snake_case` to match the `aglyn_edit_hint`
 * cookie rather than the `data-aglyn-*` attribute family.
 */
export const ENTRY_PREVIEW_PARAM = 'aglyn_preview'

/**
 * The internal path segment the middleware rewrites a preview request to —
 * `/{host}/{scheme}/aglyn-preview/{the public path}`.
 *
 * Never seen by a reader: the address bar keeps the post's real URL. It exists
 * because the preview MUST be a different Next route from the catch-all, which
 * is ISR-cached per pathname and would otherwise serve an unpublished post to
 * the public for an hour.
 *
 * It is a reserved screen slug for the ordinary reason a segment ends up in
 * {@link RESERVED_SCREEN_ROUTE_SEGMENTS}: a static route folder wins over the
 * optional catch-all beside it, so a screen published at `/aglyn-preview/…`
 * would be answered by the preview route and never render. Brand-prefixed so
 * the slug it costs a customer is one nobody wants.
 */
export const ENTRY_PREVIEW_ROUTE_SEGMENT = 'aglyn-preview'
