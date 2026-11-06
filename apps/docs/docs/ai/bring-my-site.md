---
sidebar_position: 2.75
title: Bring my site
description: Bring the website you have now into Aglyn, kept as it is with a light polish or improved around your brand, in waves you review and start yourself, once you have proved the site is yours.
---

# Bring my site

:::note Beta
**Bring my site is in beta.** It is available today on every plan that includes
it, and it is still changing as we improve it. Beta means you can use it now,
while how it reads and rebuilds your pages, and the steps on this page, may
still change.
:::

**Bring my site** moves the website you have now into a new Aglyn site. Every page comes
across with its sections, columns, cards, icons, pictures, tables, tabs and forms, drawn with
Aglyn's own elements. You choose how it looks: **Keep my site** lays each page out as your
page is, every word as you wrote it, in your site's look, and **Improve it** redesigns each
page around your brand and can improve the wording of your main pages too. Pages come in a
few at a time, in **waves**, into your new site's preview. You review each wave before you
start the next.

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

Choose how your new site should look (see [Keep my site or improve it](#keep-or-improve)),
then choose **Read my site**. Aglyn then:

- creates your new site, with nothing on it and nothing published;
- reads your current site as **AglynBot**, starting with its robots.txt file and its
  sitemap, then your home page, then every other page, and only on your own domain.
  Your current site is not changed.

Aglyn reads up to 400 pages. A link to a file, such as a download or a PDF, is not a page,
so it is never read as one and never counts toward that number.

Reading uses no AI credits.

**What is read.** For each page Aglyn reads its words and how your site lays them out: its
sections and their background colors, its columns, its cards and the icons on them, its
numbered steps, figures, questions and answers, quotes, logo strips, plan cards with their
badge, price and button, plan rows, tables and tabs, its pictures where they sit, its
videos (a film on your page, with its poster, title and description), your forms with their
fields and their button, and which links your site shows as buttons. From
your home page it also reads your menu, with each dropdown and its entries, the buttons
beside it, and your footer's columns, profiles and copyright line, plus your site's fonts
and colors. Your new pages are built from this, with every word as you wrote it unless you
chose to improve your wording.

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
- **A second address for the same page.** Your site answers at this address with a page
  already found, such as a photo's link in a gallery, or a home page at both `/` and
  `/home`. It is not brought in twice, and links to it go to the page.
- **A cart, checkout, account, or search screen.** Your website platform makes these
  screens, and they are not pages of your own. A page at one of those addresses is brought
  in if it has plenty to say and your site doesn't keep it out of search results.
- **Your site says this page does not exist.** A link or a sitemap on your site still
  points to the address, so that link is worth fixing on your current site.
- **No text could be read.** The page shows its words only once a browser runs it, so it
  cannot be brought in yet.
- **Could not be read just now**, **a sign-in page**, **robots.txt asks AglynBot not to
  read it**, **larger than a page can be**, or **sends visitors to another website**.

If more than half of your pages were turned away, **Your site is read** says so at the
top. You can still start the first wave.

## Keep my site or improve it {#keep-or-improve}

Before you choose **Read my site**, choose how your new site should look under **How should
your new site look?**:

- **Keep my site** keeps your pages laid out as they are, in your site's colors, buttons and
  fonts. Aglyn tidies spacing, type and color so every page reads well. Every word stays as
  you wrote it.
- **Improve it**, chosen unless you pick otherwise, has Aglyn AI redesign each page with your
  pictures, menus and forms, in a theme built around your brand. Every page and section, every
  picture, icon, button and heading, your forms, videos and menus all come across, in your
  brand's colors and fonts.

Under **Improve it**, **Also improve my wording** is on unless you switch it off. Aglyn AI
rewrites the headings, paragraphs and buttons of your main pages so they read better. Every
name, price, number, date, address, phone number and email stays exactly as you wrote it,
and quotes, policy pages, tables and forms keep every word. Pages of a collection, such as
blog posts, and your header and footer keep every word too, and so do the names on your
cards, your plans and prices, your figures and badges, the small labels above your headings,
your fine print and any sentence with a link in it. A line Aglyn AI cannot reword without
changing a fact keeps the words you wrote. Improving the wording uses more AI credits, and
the switch says how many before you start a wave.

**You can change it before each wave.** Your import's page says how the next wave will be
built, for example **How your new site looks: Keep my site**. Choose **Change**, pick again,
then start the wave. A wave that is already in is never redrawn. Each wave's heading says
how it was built, for example **Main pages · Keep my site** or **Main pages · Improved**.

An import started before this choice existed is built as **Keep my site**.

### A planned, rewritten Improve it {#improve-planned}

**A planned, rewritten Improve it is rolling out**, so your workspace may not have it yet.
Where it is on, **Improve it** does more than redraw your pages. It reorganizes your site
and can add to it. Without it, Improve it works as described above.

**Your new site.** When you start your first wave, Aglyn AI reads your pages and plans the
site before anything is built, then waits for you. **Your new site** shows what it plans:

- what your site is and who it serves;
- your new menu, with like pages grouped under one entry;
- your header's main button and where it goes; the page it goes to is reached from the
  button and the footer rather than a menu entry of its own;
- your footer's columns, at least one on any site with more than one page;
- one new page your site lacks, if there is one it can write, with a switch to leave it
  out. It is on unless you switch it off, it counts toward your plan's page limit, and it
  is not proposed when your plan has no room;
- **Create pictures with AI where needed**, a switch that is on unless you turn it off.

Choose **Build my new site** to go on. Every page of every wave is then drawn to that plan,
so your whole site reads as one design. If the plan does not pass our checks, your import's
page says so and your own menu and footer stand.

**Also write new copy** takes the place of **Also improve my wording** and is on unless you
switch it off. Aglyn AI plans each main page again for what it is for, adds the sections a
visitor of your kind of business looks for, and writes new headings, paragraphs and buttons
from what your site says. Your home page and your main service pages get at least two new
sections, such as how it works, why choose you or the questions people ask, where the page has
room. A contact page gets none: its form is set on a framed ground beside how to reach you.
Services and reasons are drawn as cards, steps as numbered steps, questions as a list you can
open, quotes on their own ground, and pictures side by side. A long page keeps each of its sets
of cards, steps, questions and photo galleries whole and is planned around them. It never makes up a name, number, price, date, testimonial, client, award, credential,
address or guarantee, and every picture, form, plan, table, quote and video your page has
stays on it. If a redesign does not pass those checks, its row says **Layout kept: the
redesign did not pass**, and the page keeps your words. With the switch off, every word stays
as you wrote it, and your layout and menu are still redesigned. Policy pages and pages of a
collection, such as blog posts, always keep every word.

Each redesigned page stays within the most a page can use, which you see before you start,
whether or not it passes.

**Pictures.** Where a redesigned page needs a picture, it takes one from these, in order: your
page's own photos, then the photos your other pages left off, then the stock library, which
uses no AI credits and keeps its photographer's credit. With **Create pictures with AI where
needed** on, which it is unless you turn it off, a page's opening picture or a section's first picture that none of those fits
can be created for you, up to two a page, never of a person. Each uses the credits a picture
in [Create images](./create-images.md) does, and you see the most it can add before you start.
A picture nothing fits is left out, and the row around it closes up. Your own opening photo
always comes before a new one.

**What it says it did.** A page's row says **Redesigned by Aglyn AI**, how many sections it
added, and which, for example **New: Why us, FAQ (4)**, and how many of its pictures came from
stock or were created. Each wave lists its **What's new** once it is in. A wave's cost includes
the plan, the new page and, where you turned them on, the most its pictures can add.

## Waves {#waves}

- **The first wave** brings in your main pages: home, then the pages in your menu,
  then your other top-level pages. Before any page, it gives your new site its look. With
  **Improve it**, that is the built-in theme that fits your kind of site, in your brand's
  colors and fonts. With **Keep my site**, it is your current site's look, on one of
  Aglyn's built-in themes: your buttons' color as its main color and
  your links' color beside it, the color of the small labels above your headings as its
  third color, your pages' background color, the rounding of your buttons, and your own
  font when Google Fonts has it, or a font in the same style when it does not.
  Colors are kept readable. With **Improve it**, a color too light for white words is used a
  shade deeper. With **Keep my site**, your buttons keep their color and take dark words on a
  color too light for white ones, while links and outlined buttons use a shade that reads. If
  you already chose a theme for the new site, it is kept.
- **Your header and footer** come in with the first wave, as your current site shows them:
  your logo, your name, or both; your menu, each dropdown as a **Dropdown Menu** or a
  **Mega Menu** with its entries, their icons and the line under each; and your buttons,
  such as **Sign in** or **Start free**, going where they go now. A large dropdown keeps
  its columns in the same order, side by side and as wide as yours, with each column's
  heading and words, its featured picture, its light or dark box, and the colored tile
  behind each icon. Every label stays on one line, and on a screen too narrow for the whole
  menu it becomes a menu button that opens every menu and button.
- **Your menus open the way they do now.** A menu that opens when you point at it opens
  the same way on a computer, and clicking its name opens that page, as it does on your
  current site. A menu name with no page of its own opens its menu on a click. A menu that
  only opens on a click stays that way. In the menu on a phone, tap a menu's name to open
  or close it; every entry and every word of its panel is there. Each menu's panel starts
  hidden until it is shown: select it in the **Besigner** to work on it, and change how it
  opens in the **Interactions** tab of its name.
- **Your footer** keeps its columns and headings, its profiles, its address, phone and
  email, and its copyright line as written. It opens with your logo when yours does, and a
  box your footer sets apart, such as a call to developers, stays a box with its heading,
  words and link. When your menu can be read, the header and footer use no AI credits. See
  [Menus & navigation](../building-sites/menus-and-navigation/overview.md) to change them
  later. Your home page's title and description become your new site's search listing,
  unless you already changed it, and your site's icon becomes your new site's icon, unless
  you already gave it one.
- **Each later wave** brings in up to 10 pages of one collection, for example
  **Blog, 1 of 3**.
- **Never past your plan.** Your main pages are kept first. If your site has more pages
  than your plan allows, the last pages of your collections are the ones left out, each
  listed with **Past your plan's page count**. **See plans** opens Billing.

With **Keep my site**, your words are never rewritten. With **Improve it** and **Also
improve my wording** on, Aglyn AI rewrites the headings, paragraphs and buttons of your main
pages; every name, price, number, date, address, phone number and email stays exactly as you
wrote it, and quotes, policy pages, tables and forms keep every word.

With **Keep my site**, every page is laid out as your page is: its sections in
their own backgrounds, its columns, its cards with their icons and links, its numbered
steps, figures, questions and answers, quotes, logo strips, plan cards and plan rows, tables and tabs,
and its pictures where your page shows them. It is drawn as your page draws it too:

- **Pictures at their own shape, never cut.** A picture keeps the shape it has. Only a
  picture your page itself crops, to a set height or a set shape, is cropped the same way.
  A picture your page rounds, sets on a shadow or holds narrower than its column keeps that.
- **Labels in your site's colors.** The small label above a heading keeps its color, in
  capitals with no line before it, and keeps its rounded outline where your page draws one.
- **Large statements stay large.** A paragraph your page sets as large and bold as a heading
  is set in the **Heading 4** Text Style, and stays a paragraph.
- **Cards as your page draws them.** Each icon keeps its tinted square and each card its
  corner arrow, the words keep their alignment, and a row of three on a wide screen is two to
  a row on a tablet when your page does that. Steps your page sets under a line, not in boxes,
  keep the line.

Unless its wording is improved, each heading, paragraph, list, link and button keeps the
words your page has. Every link goes to the page it went to: to that page on your new site,
once it is in. Each page also keeps your page's own title and description as its search
listing.

Each page is built one of two ways, and the wave's row for the page says which:

- **Copied as it is**: a page of a collection, such as a blog post or a policy. It is laid
  out as your page is, in your new site's look, with no AI.
- **Arranged by Aglyn AI**: your main pages. With **Keep my site**, they are laid out as
  your pages are, and Aglyn AI chooses only their finish: how the first section opens around
  its picture, with the picture kept where your page has it (under, beside or behind the
  words), how each group of cards is drawn, and a background where your page has none. With
  **Improve it**, Aglyn AI redesigns them: how each section opens, its background and
  alignment, and how each group is drawn.
- **Arranged and reworded by Aglyn AI**: a main page whose wording was improved. Its row
  says **Every fact kept** where other pages count their words. A policy page, such as your
  privacy policy, reads **Arranged by Aglyn AI · Words kept**, and so does a page whose
  rewrite could not keep every fact: it keeps your words as you wrote them.

To start a wave, choose its **Start** button, for example **Start Main pages**. Each wave
shows its cost before you start it, and how many of its pages are arranged, arranged and
reworded, or copied. A page copied as it is uses no AI credits unless its listing has to be written. Credits
are used as each page is brought in. A page that fails on our side gives its credits back.

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
- a page whose form was rebuilt, with the form's name;
- a page with a video your old site serves itself, which plays from your old site's address,
  and a page with a video that was left out because it had no poster picture;
- how many AI credits the wave used.

If your site started in [preview](../building-sites/site-protection/make-your-site-private.md#keep-it-to-your-team-with-preview),
each wave's pages are published into the preview as the wave comes in. You, your team and
Aglyn support can open the site and see them at their addresses, home at your site's
address. Visitors still see **Coming soon**. To make the site public, switch **Preview** off
in **Admin → Error pages**, or choose **Make it public** on the banner that says your site is
in preview.

If your site is not in preview, every page is a **draft**: nothing is published until you
publish it.

**Open your draft pages**, or **Open your pages** when your site is in preview, opens the
site's Pages list. When you are ready for more, choose
the next wave's **Start** button. Nothing starts the next wave except you, unless you chose
**Start every remaining wave**.

**Cancel** stops the import. The pages already brought in stay where they are: in the
preview, or as drafts. Under **Every wave**, a wave that was running reads **stopped**, and a
wave that had not started reads **not started**.

## Photos and videos {#photos}

A page's photos are copied into your new site's media library and placed on that page:
on a page copied as it is, each one where your page shows it. The same photo is stored only
once, however many pages show it.

A video on your page is placed with the [Video](../building-sites/besigner/video.md) element,
where your page shows it, and plays from where it plays now:

- **A video on Wistia, YouTube or Vimeo** plays in that host's player, which loads only when a
  visitor presses play.
- **A video your old site serves itself** plays from your old site's address. Its page's row
  says so. To move it, pick the video from your media library on its Video element. So it can
  play on your new site, the address it plays from is added to
  [Approved media hosts](../content-and-data/media/overview.md#approved-media-hosts) in
  **Admin → Security**. Every host on that list can see the IP address of each visitor whose
  browser plays the video from it.

Its poster picture, the still a visitor presses, is copied into your media library like any
photo, and its title, description, date and running time come with it when your page gives
them. A button on your page that plays the video, such as **Watch the film**, plays it on the
new page too. A video on another host is shown as its poster picture, linking to where it
plays. A video your page shows without a poster picture is left out, and its page's row says
so: add it with the Video element and pick a poster for it. A video that plays by itself
behind a section's words is shown as its poster picture there.

Your logo is copied once, for your header. If it is a drawing (an SVG file), it is saved as
a picture. Your home page's share image, the one shown when your site is linked, becomes
your new site's share image unless you already chose one.

## What is never brought in {#never-brought-in}

- **Sign-in pages.** A page that asks for a password is left out, and so is a page AglynBot
  is asked not to read by robots.txt.
- **Code.** Scripts are never brought in. An embedded video is placed as a video, and any
  other embedded frame is left out.
- **Forms that ask for a password or a card number.** These are left out. Every other form
  on your page is rebuilt as a form of your new site, with the same fields, required marks
  and button, where your page had it. What visitors send lands in your **Inbox**, a form that
  asks for an email also asks for marketing consent, and rebuilding a form uses no AI credits.
  A form your new site already has is placed instead of a second copy. If your plan has no
  room for another form, the page comes in without it and its row says so. A form can't take
  a file here, so a file upload field is left out and the page's row names it.
- **Other websites.** Only pages on your own domain are read. A page that sends visitors to
  another website is left out.

## When an import waits for you {#when-an-import-waits}

- **Your import stopped before it finished.** Something kept a page or a wave from going on.
  The import says how many pages are not in yet, and everything already brought in is safe.
  Choose **Start** for the wave it names and it goes on from where it stopped. If you chose
  **Start every remaining wave**, the waves after it keep going too.
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
