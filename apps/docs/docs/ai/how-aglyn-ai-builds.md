---
sidebar_position: 2
title: How Aglyn AI builds
description: Every AI build reuses what your site already has, takes its colors and spacing from your theme, and arrives as a draft. Every plan is checked against those rules before you see it, asked again, then stopped.
---

# How Aglyn AI builds

When Aglyn AI builds for your site (a page, a component, a layout, a page template, a
form or an email), it builds the way a careful designer on your team would: from what the
site already has, with your theme and brand, as a draft you review. The rules
below are not a suggestion in a prompt. Every plan and every generated document
is checked against them before you see it.

## Where to describe a build

Open the site you are building for, go to the page that lists what you want built, and
choose **Create with AI** beside its create button:

- a page on **Pages**, or **Describe a page** in **AI jobs** in the Assist panel; see
  [Generate a page](../building-sites/screens-and-layouts/generate-a-page.md);
- a page template on **Templates**; see
  [Generate a page template](../building-sites/site-templates/templates-library.md#generate-a-page-template-with-aglyn-ai);
- a layout on **Layouts**; see
  [Generate a layout](../building-sites/screens-and-layouts/layouts.md#generate-a-layout-with-aglyn-ai);
- a form on **Forms**; see [Generate a form](./generate-a-form.md);
- a reusable component on **Components**; see
  [Generate a reusable component](../building-sites/components/generate-a-component-with-aglyn-ai.md#from-a-brief).

**Create with AI** is there when your workspace has AI build jobs, you have the **Generate
with AI** permission, and AI is on for the site.

## The plan comes first

Before it generates anything, a build job proposes a **plan**:

- what it will **reuse** from your site: components, layouts, templates, forms,
  datasets and collections;
- what it will **create**, and why nothing you already have will do;
- the **pages** it will build, each with its layout, address, search title and
  sections;
- any **YouTube or Vimeo player** your brief asks for, the page or component it
  goes on, and what it costs: a player loads its host's own code when a visitor
  reaches it, whether or not they press play. A brief that asks for no video gets
  no player.

A plan only proposes what your workspace can create: what your plan includes, and what
your site still has room for. A plan the job could not build is stopped before you are
asked to confirm it, with the reason. What a page's plan creates, such as its layout, a
card that repeats or its form, is built first when you confirm, in the same job.

The job then waits for you. The window you started it from stays with it: it
shows the job planning, then the plan itself, with **Confirm plan** to build it
and **Cancel job** to stop. Nothing is generated until you confirm.

## Finding your AI jobs

You never have to remember where a job went:

- **The window that started it** shows where it stands as it happens: queued,
  planning, plan ready, building, then done or stopped. Once it is done, its first
  button opens what it built, such as your site's draft pages or the draft page in
  the editor.
- **Open AI jobs**, in that window, opens the Assist panel on its **AI jobs** list
  with your job highlighted, so you can close the window and follow it there.
- **The AI chip in the top bar**, beside the notifications bell, is there while any
  of your workspace's jobs is running or waiting for you. It reads **AI · plan
  ready** when a plan is waiting for you to confirm it, **AI · needs attention**
  when a job stopped for something only you can change, and **AI · planning** or
  **AI · working** while jobs run. Choose it to open AI jobs on that job.
- **The Assist button** at the bottom right shows a badge while a job runs, and a
  count in the warning color while one needs you.
- **A notification** arrives when a job's plan is ready for you to confirm, when it
  finishes and when it stops. It opens the job, or what it built. You can turn
  these off under **AI job needs you**, **AI job finished** and **AI job stopped** in
  your notification settings.

**AI jobs** opens on its own while anything is running or waiting for you, and
lists each job with where it stands.

## The building rules

1. **Repeats become one reusable component.** A block that appears three or more
   times on a page, such as the same card with different words, is built once as
   a reusable component and placed as instances. The AI looks for a component you
   already have first, and never makes a second copy of one. On a plan without
   reusable components, such as Free, the block is built into the page each time it
   repeats instead. Either way, a list of such blocks is one section of the page, never a
   section for each block.
2. **Site-wide regions live in the layout.** Headers, navigation, footers,
   announcement bars and cookie notices belong to the site's layout. A generated
   page sits in your layout and never carries its own copy of them.
3. **Forms are built on the Forms page, then placed.** A form is created with its
   fields, validation, consent and routing on the Forms page, and a page places it
   by reference, so you edit it in one place. On a plan without saved forms, such as
   Free, the page carries the form itself, with its fields, and its submissions reach
   your inbox like any form's. A search is never built as a form,
   because a form collects submissions: the AI places a
   [Search Box](../building-sites/site-search/overview.md) for your site search, or a
   Collection Search for the entries of one collection.
4. **Similar pages share one template.** Pages that share a structure and differ by
   content, such as products, locations, team members or services, are built from
   one template or bound to a collection.
5. **Colors, spacing and type come from your theme.** Generated content uses your
   theme's colors, spacing scale and text styles, never a fixed color value. A
   color your theme lacks is proposed as a theme change for you to review. A link
   or button on a colored band, such as a footer in your primary color, uses the
   band's text color, so it stays readable.
6. **Emails use your brand.** Email designs use your brand's colors and fonts, and
   campaigns start from an email template.
7. **Reuse before creating.** Creating something new is the exception, and the plan
   says why. A plan never creates something your plan does not include or your site
   has no room for, and everything it puts on a page is something your site already
   has or something the plan itself creates.
8. **Data is bound, not typed.** A list you already keep as a dataset, collection
   or product catalog is bound to it rather than typed into the page, so it stays
   current. A long list your site does not have yet becomes a proposed dataset.
9. **Images come from your media library, with alt text.** Images are placed from
   the media library, or left as an empty slot for you to fill, and never linked
   from another website. Every image has alt text or is marked decorative.
10. **Navigation and SEO travel with a page.** Every new page gets its own
    address, a search title and description, and a navigation entry when the brief
    calls for one. A link goes only to a page that does what its words say: when your
    site has no such page yet, the link is left out rather than sent to your home
    page. Every button and link goes somewhere: to a page of your site, to an
    address the brief gives, or to a section of the same page, which it scrolls to
    with a Scroll to element interaction you can change. One with nowhere to go is
    left out.
11. **One main landmark and an ordered outline.** Every page has one main content
    area, one top-level heading, and headings that step down in order, so it reads
    well to screen readers and search engines.
12. **Responsive by your theme's breakpoints.** Widths follow your theme's
    breakpoints instead of fixed sizes, so pages hold up on phones, tablets and
    desktops. A row of cards or columns is a grid that shows one column on a phone
    and steps up to several side by side on larger screens.
13. **Drafts only.** Everything the AI builds is a new draft. It never publishes,
    and never changes a live page in place.
14. **Your voice, with no filler.** Copy follows your site's tone and the brief,
    with no lorem ipsum, and every heading, subhead and paragraph is finished rather
    than cut off mid-sentence. Where the brief leaves out a fact, such as a phone number
    or a price, the AI marks the gap in square brackets instead of inventing it, and
    **AI jobs** lists those gaps beside the draft so you can fill them before you
    publish.
15. **Start from a duplicate of the nearest thing.** When your site has a similar
    page, template or email, the job starts from a copy of it, which keeps its
    bindings and SEO.
16. **The smallest document that does the job.** Generated pages use the fewest
    elements that render the design: no empty or doubled-up containers, no list item
    or card with nothing in it, text as text, images that load as they are reached,
    video that plays on click behind its poster, and no fonts you did not ask for.
    A YouTube or Vimeo player appears only where the plan you confirmed lists it,
    playing the link your brief gave or waiting for you to paste one. A template
    or a layout never carries one, because it would load on every page it serves;
    a template plays an entry's featured video only when its plan lists it.
17. **A measured size for every output.** Each page, component, layout, form and
    email is measured (elements, stored size, image weight, embeds and fonts)
    against a budget for its kind, and an email is kept under the size mail apps
    clip. A job shows a page's estimated first-visit weight before you apply it.

## When an answer breaks a rule

A plan or document that breaks a rule is not used. The AI is asked once more and
told which rules it broke. If the second answer still breaks one, the job stops
and shows you which rules. Choose **Try again** to ask once more, or cancel the
job. Every answer counts toward your AI usage, including the ones that were not
used.

## Who can use it

Build jobs need the **Generate with AI** permission. See
[who can use AI assist](overview.md#who-can-use-it).

## Related

- [AI Assist](overview.md)
- [AI Generate Section](generate-section.md)
- [Generate a layout](../building-sites/screens-and-layouts/layouts.md#generate-a-layout-with-aglyn-ai)
- [Generate a page template](../building-sites/site-templates/templates-library.md#generate-a-page-template-with-aglyn-ai)
- [Generate a reusable component](../building-sites/components/generate-a-component-with-aglyn-ai.md)
- [Generate a page from a brief](../building-sites/screens-and-layouts/generate-a-page.md)
- [Generate an email with AI](../marketing-and-automation/email-campaigns/generate-with-ai.md)
