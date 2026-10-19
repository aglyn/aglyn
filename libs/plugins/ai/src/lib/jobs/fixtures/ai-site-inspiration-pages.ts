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

import type { AiReferencePage } from '../ai-theme-brand-inputs'

/**
 * Three recorded home pages for Sites I like (AGL-3975), each with the one
 * stylesheet it links, as `readReferencePage` returns them: a minimal
 * photography portfolio, a busy restaurant that takes reservations and shows
 * its menu, and a software landing page with pricing. Written for the specs
 * in the shapes such sites are built in (semantic sections, an AOS scroll
 * library, utility classes), with sentences, names, picture files and alt
 * texts of their own, which the specs hold out of every prompt and output.
 * The businesses are invented.
 */
export interface AiSiteInspirationRecording {
  url: string
  page: AiReferencePage
  /** The words, names and picture addresses of the page that must never reach a prompt. */
  never: readonly string[]
}

const PORTFOLIO_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Lumen &amp; Grain Photography</title>
  <link rel="stylesheet" href="/assets/site.css">
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500&display=swap" rel="stylesheet">
</head>
<body>
  <header class="site-header">
    <nav class="nav-left"><a href="/work">Work</a><a href="/journal">Journal</a></nav>
    <a class="logo" href="/"><img src="/img/lumen-grain-wordmark.svg" alt="Lumen and Grain wordmark"></a>
    <nav class="nav-right"><a href="/about">About</a><a href="/prints">Prints</a><a href="/contact">Contact</a></nav>
  </header>
  <main>
    <section class="hero">
      <h1>Light that lingers on every frame since 2009.</h1>
      <p>Quiet portraits and coastal landscapes by Mara Ellison, shot on medium format film.</p>
      <a class="btn btn-ghost" href="/work">See the work</a>
    </section>
    <section class="gallery">
      <h2>Selected work</h2>
      <img src="/img/fog-over-pacifica.jpg" alt="Fog rolling over the Pacifica cliffs">
      <img src="/img/harbor-at-dusk.jpg" alt="The harbor at dusk">
      <img src="/img/kelp-study-04.jpg" alt="Kelp study number four">
      <img src="/img/portrait-of-june.jpg" alt="Portrait of June by the window">
      <img src="/img/salt-flats.jpg" alt="Salt flats at noon">
      <img src="/img/winter-orchard.jpg" alt="The winter orchard">
    </section>
    <section class="about">
      <h2>About Mara</h2>
      <p>Mara Ellison has photographed the northern California coast for fifteen years, printing every image by hand in her Bolinas darkroom.</p>
    </section>
    <section class="contact">
      <h2>Commission a session</h2>
      <form action="/contact" method="post">
        <input type="text" name="name">
        <input type="email" name="email">
        <textarea name="message"></textarea>
        <button class="btn" type="submit">Send</button>
      </form>
    </section>
  </main>
  <footer><p>All photographs copyright Mara Ellison.</p></footer>
</body>
</html>`

const PORTFOLIO_CSS = `
body { background-color: #ffffff; color: #1c1c1c; font-family: 'Inter', sans-serif; }
h1, h2 { font-family: 'Cormorant Garamond', serif; font-weight: 500; }
.site-header { display: flex; justify-content: center; gap: 48px; padding: 32px 0; }
section { padding: 128px 24px; }
.btn { border: 1px solid #1c1c1c; background: transparent; border-radius: 0; color: #1c1c1c; }
a { color: #8a6d3b; }
.gallery img { width: 100%; }
`

const RESTAURANT_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Osteria Fiamma | Wood-fired Italian in Portland</title>
  <meta name="theme-color" content="#b23a1d">
  <link rel="stylesheet" href="https://osteriafiamma.example/styles/main.css">
  <script src="https://unpkg.com/aos@2.3.4/dist/aos.js"></script>
</head>
<body>
  <header class="site-header">
    <a class="brand" href="/"><img src="/images/fiamma-logo.png" alt="Osteria Fiamma flame logo"></a>
    <nav><a href="/menu">Menu</a><a href="/events">Events</a><a href="/gallery">Gallery</a><a href="/visit">Visit</a></nav>
    <a class="btn btn-primary" href="https://www.opentable.com/r/osteria-fiamma-portland">Reserve a table</a>
  </header>
  <main>
    <section class="hero" data-aos="fade-right">
      <h1>Fire, flour and Nonna Rosa's Sunday sugo.</h1>
      <p>Chef Dario Bellini cooks over Oregon white oak every night from five o'clock.</p>
      <a class="btn btn-primary" href="https://www.opentable.com/r/osteria-fiamma-portland">Book a table</a>
    </section>
    <section class="food-menu" data-aos="fade-left">
      <h2>Our Menu</h2>
      <div class="menu-card"><h3>Starters</h3><p>Burrata with charred peaches $16</p><p>Arancini al tartufo $14</p></div>
      <div class="menu-card"><h3>Mains</h3><p>Pappardelle with wild boar ragu $29</p><p>Whole roasted branzino $34</p></div>
      <div class="menu-card"><h3>Desserts</h3><p>Olive oil cake with blood orange $11</p></div>
    </section>
    <section class="reservations" data-aos="fade-right">
      <h2>Reservations</h2>
      <p>Tables for two to ten, booked up to sixty days ahead.</p>
      <a href="https://www.opentable.com/r/osteria-fiamma-portland">Find a time on OpenTable</a>
    </section>
    <section class="testimonials" data-aos="fade-left">
      <h2>What our guests say</h2>
      <blockquote>The best cacio e pepe outside of Rome, and the staff remembered my daughter's birthday.</blockquote>
      <blockquote>Every visit to Fiamma feels like a dinner party at a friend's farmhouse.</blockquote>
    </section>
    <section class="events" data-aos="fade-right">
      <h2>Upcoming events</h2>
      <article><time datetime="2026-11-02">Nov 2</time><h3>Barolo tasting night</h3></article>
      <article><time datetime="2026-11-16">Nov 16</time><h3>Truffle dinner with Alba growers</h3></article>
      <article><time datetime="2026-12-07">Dec 7</time><h3>Feast of the seven fishes</h3></article>
    </section>
    <section class="gallery" data-aos="fade-left">
      <h2>Inside Fiamma</h2>
      <img src="/images/dining-room.jpg" alt="The candlelit dining room">
      <img src="/images/oven.jpg" alt="Our wood oven">
      <img src="/images/pasta-bench.jpg" alt="Fresh pasta on the bench">
      <img src="/images/patio.jpg" alt="The garden patio">
    </section>
    <section class="newsletter" data-aos="fade-right">
      <h2>Join our newsletter</h2>
      <form action="https://osteriafiamma.us21.list-manage.com/subscribe/post" method="post">
        <input type="email" name="EMAIL">
        <button class="btn btn-primary" type="submit">Subscribe</button>
      </form>
    </section>
    <section class="visit" data-aos="fade-left">
      <h2>Visit us</h2>
      <p>2214 SE Division Street, Portland. Open Tuesday to Sunday.</p>
      <a href="tel:+15035550199">503 555 0199</a>
    </section>
  </main>
  <footer><p>Osteria Fiamma, a family restaurant since 1998.</p></footer>
</body>
</html>`

const RESTAURANT_CSS = `
:root { --fiamma-red: #b23a1d; }
body { background-color: #fbf6ec; color: #2b1d14; font-family: 'Lato', sans-serif; }
h1, h2 { font-family: 'Oswald', sans-serif; letter-spacing: 0.02em; }
.site-header { display: flex; justify-content: space-between; align-items: center; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12); }
section { padding: 56px 32px; }
.btn { border-radius: 4px; text-transform: uppercase; background-color: #b23a1d; color: #ffffff; }
.btn-primary { background-color: #b23a1d; }
.menu-card { background: #ffffff; border-radius: 8px; box-shadow: 0 4px 16px rgba(43, 29, 20, 0.12); }
.events article { border-left: 3px solid #b23a1d; }
a { color: #b23a1d; }
h3 { color: #2f5d3a; }
.badge { background: #2f5d3a; color: #ffffff; }
`

const SAAS_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Flowline: invoices that chase themselves</title>
  <link rel="stylesheet" href="/_next/static/css/app.css">
  <link rel="alternate" type="application/rss+xml" href="/blog/rss.xml">
</head>
<body>
  <header class="navbar">
    <a class="logo" href="/"><img src="/brand/flowline-mark.svg" alt="Flowline logo"></a>
    <nav><a href="/product">Product</a><a href="/pricing">Pricing</a><a href="/blog">Blog</a><a href="/login">Sign in</a></nav>
    <a class="button button-primary" href="/signup">Start free</a>
  </header>
  <main>
    <section class="hero" data-aos="fade-up">
      <h1>Invoices that chase themselves, so your team never has to.</h1>
      <p>Flowline sends polite reminders, reconciles payments and flags the clients who always pay late.</p>
      <a class="button button-primary" href="/signup">Start your 14-day trial</a>
    </section>
    <section class="logos" data-aos="fade-up" data-aos-delay="100">
      <h2>Trusted by finance teams at Northwind and Brightpath</h2>
    </section>
    <section class="features">
      <h2>Everything accounts receivable needs</h2>
      <div class="card" data-aos="fade-up" data-aos-delay="0"><h3>Smart reminders</h3><p>Gentle nudges timed to each client's habits.</p></div>
      <div class="card" data-aos="fade-up" data-aos-delay="100"><h3>Auto reconciliation</h3><p>Payments matched to invoices the minute they land.</p></div>
      <div class="card" data-aos="fade-up" data-aos-delay="200"><h3>Late-payer radar</h3><p>A weekly list of who to call before month end.</p></div>
    </section>
    <section class="how-it-works">
      <h2>How it works</h2>
      <ol><li>Connect your ledger</li><li>Pick a reminder tone</li><li>Watch the overdue column shrink</li></ol>
    </section>
    <section class="stats">
      <h2>Results</h2>
      <p>42% faster payment</p><p>12k invoices a day</p><p>99.9% uptime</p>
    </section>
    <section class="pricing" data-aos="fade-up" data-aos-delay="300">
      <h2>Pricing</h2>
      <div class="card plan"><h3>Starter</h3><p>$19/mo billed yearly</p></div>
      <div class="card plan"><h3>Growth</h3><p>$49/mo billed yearly</p></div>
      <div class="card plan"><h3>Scale</h3><p>$129/mo billed yearly</p></div>
    </section>
    <section class="testimonials">
      <h2>Loved by controllers</h2>
      <blockquote>Flowline cut our days sales outstanding from 58 to 31 in one quarter.</blockquote>
    </section>
    <section class="faq">
      <h2>Frequently asked questions</h2>
      <details><summary>Does Flowline work with QuickBooks?</summary><p>Yes, in two clicks.</p></details>
      <details><summary>Can clients pay by card?</summary><p>Card and ACH both.</p></details>
      <details><summary>Is there a contract?</summary><p>Month to month.</p></details>
    </section>
    <section class="cta">
      <h2>Ready to get paid on time?</h2>
      <a class="button button-primary" href="/signup">Start free</a>
    </section>
  </main>
  <footer><a href="/blog">Blog</a><a href="/careers">Careers</a></footer>
</body>
</html>`

const SAAS_CSS = `
body { background: #ffffff; color: #0f172a; font-family: 'Inter', system-ui, sans-serif; }
h1, h2 { font-family: 'Inter', sans-serif; font-weight: 800; letter-spacing: -0.02em; }
.navbar { display: flex; justify-content: space-between; border-bottom: 1px solid #e2e8f0; }
section { padding: 32px 24px; }
.button { border-radius: 9999px; background-color: #4f46e5; color: #ffffff; }
.button-primary { background-color: #4f46e5; }
.card { border: 1px solid #e2e8f0; border-radius: 16px; background: #ffffff; }
.hero h1 { color: #4f46e5; }
.stats p { color: #10b981; }
.badge-success { background: #10b981; }
a { color: #4f46e5; }
`

export const AI_INSPIRATION_PORTFOLIO: AiSiteInspirationRecording = {
  url: 'https://lumenandgrain.example/',
  page: { url: 'https://lumenandgrain.example/', html: PORTFOLIO_HTML, stylesheets: [PORTFOLIO_CSS] },
  never: [
    'Light that lingers on every frame since 2009',
    'Quiet portraits and coastal landscapes by Mara Ellison',
    'Mara Ellison',
    'Bolinas darkroom',
    'Lumen and Grain wordmark',
    'lumen-grain-wordmark.svg',
    'fog-over-pacifica.jpg',
    'Fog rolling over the Pacifica cliffs',
    'Commission a session',
    'lumenandgrain',
  ],
}

export const AI_INSPIRATION_RESTAURANT: AiSiteInspirationRecording = {
  url: 'https://osteriafiamma.example/',
  page: { url: 'https://osteriafiamma.example/', html: RESTAURANT_HTML, stylesheets: [RESTAURANT_CSS] },
  never: [
    "Fire, flour and Nonna Rosa's Sunday sugo",
    'Chef Dario Bellini',
    'Oregon white oak',
    'Pappardelle with wild boar ragu',
    'Burrata with charred peaches',
    'The best cacio e pepe outside of Rome',
    'Barolo tasting night',
    'Osteria Fiamma flame logo',
    'fiamma-logo.png',
    'dining-room.jpg',
    '2214 SE Division Street',
    'opentable.com/r/osteria-fiamma-portland',
    'Fiamma',
    'osteriafiamma',
  ],
}

export const AI_INSPIRATION_SAAS: AiSiteInspirationRecording = {
  url: 'https://flowline.example/',
  page: { url: 'https://flowline.example/', html: SAAS_HTML, stylesheets: [SAAS_CSS] },
  never: [
    'Invoices that chase themselves',
    'Flowline sends polite reminders',
    'Trusted by finance teams at Northwind and Brightpath',
    'Northwind',
    'Late-payer radar',
    'Flowline cut our days sales outstanding',
    'Does Flowline work with QuickBooks',
    'Flowline logo',
    'flowline-mark.svg',
    '$19/mo',
    'Flowline',
    'flowline.example',
  ],
}

export const AI_INSPIRATION_RECORDINGS: readonly AiSiteInspirationRecording[] = [
  AI_INSPIRATION_PORTFOLIO,
  AI_INSPIRATION_RESTAURANT,
  AI_INSPIRATION_SAAS,
]
