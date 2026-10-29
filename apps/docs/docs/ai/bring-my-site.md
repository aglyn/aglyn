---
sidebar_position: 2.75
title: Bring my site
description: Bring the website you have now into Aglyn, its pages, words and photos, in waves you review and start yourself, once you have proved the site is yours.
---

# Bring my site

:::note Beta
**Bring my site is in beta.** It is available today on every plan that includes
it, and it is still changing as we improve it. Beta means you can use it now,
while how it reads and rebuilds your pages, and the steps on this page, may
still change.
:::

**Bring my site** moves the website you have now into a new Aglyn site. Aglyn AI
reads each of its pages and rewrites it in your new site's design, keeping its words,
facts and photos. Pages come in a few at a time, in **waves**. You review each wave
before you start the next.

It is included on every paid plan. On the Free plan the card is shown but turned off,
with a link to upgrade.

## Start {#start}

1. Open **Sites** and choose **Create site**.
2. Fill in your new site's **Site name** and **Subdomain**.
3. Choose **Bring my site**.

No site is created yet. The close control and the Escape key close the window and
create nothing.

## Your current website {#your-current-website}

Under **Website address**, type the address people use to reach your site today,
for example `example.com`, and choose **Next**. Leave out `www.`: the site's two
names are treated as one site.

You need to prove the site is yours before anything is read from it. This makes
sure only a site you own can be brought in.

## Prove it is yours {#prove-it-is-yours}

Use **one** of these three ways. The status at the top shows **Verified** once one
of them works.

- **Add a DNS record.** At the company where your domain is registered, or wherever
  its DNS is managed, add a TXT record. Copy its **Name** and **Value** from the card,
  then choose **Check the DNS record**. A new record can take a few minutes to an hour
  to show up. If it is not found yet, the card says so and you can check again.
- **Add a tag to your home page.** In the builder your site uses today, open the
  setting for header code on your home page. It is often called **Custom code** or
  **Header code**. Paste the tag you copy from the card's **Tag** field, publish your
  site, then choose **Check my home page**.
- **Get a code by email.** Type the part of an email address that comes before the
  `@`. The part after it is always your site's domain. Choose **Send a code**, then
  type the six-digit code from the email and choose **Confirm the code**. A code
  stays valid for 15 minutes.

Once the site is verified, choose **Next**. A proof stays valid for 30 days.

## Read my site {#read-my-site}

Choose **Read my site**. Aglyn then:

- creates your new site, with nothing on it and nothing published;
- reads your current site as **AglynBot**, starting with its robots.txt file and its
  sitemap, then your home page, then every other page, and only on your own domain.
  Your current site is not changed.

Aglyn reads up to 400 pages. A link to a file, such as a download or a PDF, is not a page,
so it is never read as one and never counts toward that number.

Reading uses no AI credits.

**What is read.** For each page Aglyn reads its words and how your site lays them out: its
sections and their background colors, its columns, its cards and the icons on them, its
numbered steps, figures, questions and answers, quotes, logo strips, price cards, tables
and tabs, its pictures where they sit, and which links your site shows as buttons. From
your home page it also reads your menu, with each dropdown and its entries, the buttons
beside it, and your footer's columns, profiles and copyright line, plus your site's fonts
and colors. Your new pages are built from this, with every word as you wrote it.

**Your home page comes first.** If AglynBot cannot read your home page, nothing is
planned and no AI credits are used. The import waits and says why:

- **AglynBot was turned away** means your site's bot protection or firewall refused it.
  See [When your site turns AglynBot away](#turned-away).
- **Your home page could not be read** means your home page answered with an error or
  did not answer. Check that your site is up, then choose **Check again**.

**Check again** reads your site again, and uses no AI credits either.

When it is done, **Your site is read** shows:

- what was found, grouped as your **Main pages** and each **collection**, such as a
  blog's posts, and how many more pages could not be read;
- how many pages your plan includes, how many will be brought in, and in how many waves;
- if the read ran out of time before it reached every page, a line that says so;
- each page's old address and its address on your new site, and **Old page**, which
  opens the page on your current site in a new tab;
- under **Not brought in**, every page that was left out and the reason.

### Not brought in {#not-brought-in}

Each page left out is listed under one of these reasons:

- **Past your plan's page count.** **See plans** opens Billing.
- **Turned away by your site's bot protection or firewall.** See
  [When your site turns AglynBot away](#turned-away).
- **Not reached.** The read stopped before it got to the page.
- **A file, not a page.** The link led to a file, such as a PDF, rather than a page.
- **No text could be read.** The page shows its words only once a browser runs it, so it
  cannot be brought in yet.
- **Could not be read just now**, **a sign-in page**, **robots.txt asks AglynBot not to
  read it**, **larger than a page can be**, or **sends visitors to another website**.

If more than half of your pages were turned away, **Your site is read** says so at the
top. You can still start the first wave.

## Waves {#waves}

- **The first wave** brings in your main pages: home, then the pages in your menu,
  then your other top-level pages. Before any page, it gives your new site your current
  site's look: your colors, read from your home page, on one of Aglyn's built-in themes,
  with type in the same style as yours. If you already chose a theme for the new site, it
  is kept. The first wave also builds your header and footer: your logo, your name, or both,
  as your current site's header shows them, your menu linking your pages, and the address,
  phone, email and profiles your current header and footer show. Your home page's title and
  description become your new site's search listing, unless you already changed it.
- **Each later wave** brings in up to 10 pages of one collection, for example
  **Blog, 1 of 3**.
- **Never past your plan.** Your main pages are kept first. If your site has more pages
  than your plan allows, the last pages of your collections are the ones left out, each
  listed with **Past your plan's page count**. **See plans** opens Billing.

Your words are never rewritten. Each page is built one of two ways, and the wave's row for
the page says which:

- **Copied as it is**: a page of a collection, such as a blog post or a policy, and any
  long page. Every heading, paragraph, list and link comes in, in order, laid out in your
  new site's theme.
- **Arranged by Aglyn AI**: your main pages. Aglyn AI chooses how each section is laid
  out, such as its columns and background, and every line keeps the words your page has.

To start a wave, choose its **Start** button, for example **Start Main pages**. Each wave
shows its cost before you start it, and how many of its pages are arranged and how many are
copied. A page copied as it is costs far less than a page Aglyn AI arranges. Credits are used
as each page is brought in. A page that fails on our side gives its credits back.

**Start every remaining wave** starts every wave that is left, one after another, with no
review between them. It shows the cost of all of them before you choose it. You review the
last wave when it is in, and **Cancel** still stops the import after the page it is on.

While a wave runs, its page lists each page as it comes in. You can leave the page.
You are told when the wave is in.

### Your site's preview {#your-sites-preview}

A site you bring in starts in [preview](../building-sites/site-protection/make-your-site-private.md#keep-it-to-your-team-with-preview):
only you and your team can see it, and visitors see **Coming soon**. When a wave is in, its
pages are on your new site for your team, home at your site's address, so you can open the
site and look through it as visitors will. When you are ready, switch **Preview** off and
your site is public to everyone.

If you switched **Start in preview** off when you created the site, each wave's pages stay
drafts instead, and nothing is published until you publish it.

## Review a wave {#review-a-wave}

When a wave is in, its page says so, for example **Main pages is in your site's preview**,
and shows:

- every page of the wave, with **Open draft**, its old and new address, and **Old page** to
  compare it with the page on your current site;
- how many of the page's photos came in, for example **3 of 5 photos**, with how many were
  already in your media library and how many could not be brought in;
- a page that could not be brought in, with the reason;
- how many AI credits the wave used.

If your site started in [preview](../building-sites/site-protection/make-your-site-private.md#keep-it-to-your-team-with-preview),
each wave's pages are published into the preview as the wave comes in. You, your team and
Aglyn support can open the site and see them at their addresses, home at your site's
address. Visitors still see **Coming soon**. To make the site public, switch **Preview** off
in **Admin → Error pages**, or choose **Make it public** on the banner that says your site is
in preview.

If your site is not in preview, every page is a **draft**: nothing is published until you
publish it.

**Open your draft pages** opens the site's Pages list. When you are ready for more, choose
the next wave's **Start** button. Nothing starts the next wave except you, unless you chose
**Start every remaining wave**.

**Cancel** stops the import. The pages already brought in stay where they are: in the
preview, or as drafts.

## Photos {#photos}

A page's photos are copied into your new site's media library and placed on that page:
on a page copied as it is, each one where your page shows it. The same photo is stored only
once, however many pages show it.

Your logo is copied once, for your header. If it is a drawing (an SVG file), it is saved as
a picture. Your home page's share image, the one shown when your site is linked, becomes
your new site's share image unless you already chose one.

## What is never brought in {#never-brought-in}

- **Sign-in pages.** A page that asks for a password is left out, and so is a page AglynBot
  is asked not to read by robots.txt.
- **Code and forms.** Scripts, embedded frames and forms are never brought in.
- **Other websites.** Only pages on your own domain are read. A page that sends visitors to
  another website is left out.

## When an import waits for you {#when-an-import-waits}

- **Verify your site again.** A wave starts only while your proof is less than 30 days old.
  Choose **Verify again**, prove the site is yours once more, then start the wave again.
- **The day's limit.** A workspace can start 12 waves a day, counting each time a site is
  read. Start the wave again the next day.
- **The site could not be read.** If robots.txt could not be read, or no page answered,
  nothing is read. Choose **Read the site again** once your site is up. If your site's
  bot protection turned AglynBot away, see [When your site turns AglynBot away](#turned-away).
- **AglynBot was turned away**, or **Your home page could not be read.** Nothing was
  planned and no AI credits were used. Fix what the page names, then choose **Check again**.
- **Out of AI credits.** The import pauses. Choose **Get more AI credits**, then **Resume**.

Every import is also logged for the Trust & Safety team's review.

## When your site turns AglynBot away {#turned-away}

Many hosts protect a site with bot protection or a firewall that turns away visitors it
takes for robots. If yours turns AglynBot away, the page is listed under **Not brought in**
as turned away by your site's bot protection or firewall.

If it turns away your **home page**, nothing is planned and no AI credits are used. The
import waits under **AglynBot was turned away**, and says how many other pages were turned
away too. A site seen without its home page is not your site, so nothing is built from it.

To let AglynBot in:

1. Open your site's bot protection or firewall settings, wherever your host or your
   domain's security service keeps them. When the import can tell who answered, it names
   them:
   - **Vercel**: in your project's **Firewall**, under **Rules**, add a bypass rule for the
     user agent **AglynBot**.
   - **Cloudflare**: under **Security**, **WAF**, add a custom rule that skips the checks when
     the user agent contains **AglynBot**.
2. Allow **AglynBot**. It reads only your own domain, and only pages robots.txt lets it read.
3. Choose **Check again**. If the import had already planned its waves, bring the site in
   again instead.
