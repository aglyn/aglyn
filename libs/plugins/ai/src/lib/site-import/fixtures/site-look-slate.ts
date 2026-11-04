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
 * A home page drawn the way the 11/4 Keep my site evidence was (AGL-4152), in
 * plain markup of no builder's: a dark slate hero and a second slate band, a
 * near-black closing band, light cyan filled buttons set in capitals under
 * dark words, and a hero heading held to 12 em inside a 1200 px column. What
 * the reader keeps of it, and the theme Keep my site draws from that, is
 * held by `site-import-layout.spec.ts` and `ai-site-import-look.spec.ts`.
 */

export const SITE_LOOK_SLATE_URL = 'https://www.slate-studio.example/'

export const SITE_LOOK_SLATE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Slate Studio</title>
<meta name="description" content="Websites for every kind of business.">
<style>
body { margin: 0; background-color: #f5f5f5; color: #111111; font-family: Inter, sans-serif; font-size: 16px; }
.band { padding: 64px 24px; }
.slate { background-color: #2b2f36; color: #ffffff; }
.night { background-color: #1b1e23; color: #ffffff; }
.column { max-width: 1200px; margin: 0 auto; }
h1 { font-size: 64px; max-width: 12em; }
.cta { display: inline-block; padding: 12px 24px; border-radius: 4px; background-color: #00b0ff; color: #0b1b2b; text-transform: uppercase; }
</style>
</head>
<body>
<header><a href="/">Slate Studio</a><nav><a href="/about">About</a><a href="/contact">Contact</a></nav></header>
<main>
<section class="band slate"><div class="column"><h1>Websites for every kind of business</h1><p>Build, publish and grow from one place.</p><a class="cta" href="/start">Start free</a></div></section>
<section class="band"><div class="column"><h2>What you get</h2><p>Pages, a shop and bookings, in your own colors.</p><a class="cta" href="/start">See the plans</a></div></section>
<section class="band slate"><div class="column"><h2>How it works</h2><p>Bring your site in, keep its look, and publish.</p></div></section>
<section class="band night"><div class="column"><h2>Get started</h2><p>Your first site is on us.</p><a class="cta" href="/start">Get started</a></div></section>
</main>
<footer><p>Slate Studio</p></footer>
</body>
</html>
`
