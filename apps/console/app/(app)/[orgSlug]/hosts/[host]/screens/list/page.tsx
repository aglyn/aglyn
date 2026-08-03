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
 * `…/screens/list` is the old home of the screen list; it now lives at the
 * bare `…/screens`, matching components and layouts.
 *
 * THIS IS AN ALIAS, NOT A REDIRECT, AND THAT IS DELIBERATE.
 *
 * The bare `…/screens` used to answer `permanentRedirect()` — a **308** — to
 * this path, and browsers cache 308s on disk, indefinitely. Any browser that
 * visited the bare path before this change still holds "screens → screens/
 * list". Had this file redirected back, that user would get:
 *
 *     /screens  --(cached 308)-->  /screens/list  --(new 308)-->  /screens
 *
 * an ERR_TOO_MANY_REDIRECTS loop that no amount of reloading clears, on the
 * URL we just made canonical. Serving the page here instead breaks the cycle:
 * the stale 308 lands on a real page, and everyone else goes straight to the
 * bare path.
 *
 * The title comes from `../layout.tsx`, which wraps this segment too.
 *
 * Safe to delete once the cached 308s have aged out — there is no link left
 * in the app pointing here.
 */
export { default } from '../page'
