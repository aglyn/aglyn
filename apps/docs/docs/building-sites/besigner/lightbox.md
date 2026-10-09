---
sidebar_position: 6.6
title: Lightboxes
description: Open a picture full size, step through a gallery, or put any elements in a lightbox of your own — and style how every lightbox looks and closes.
---

# Lightboxes

A lightbox shows something large over the page, on a dimmed backdrop, until the visitor
closes it. Aglyn has one lightbox, and four ways to open it:

- an **Image** with **Open in a lightbox** on shows its picture full size;
- an **Image List** with **Open in a lightbox** on opens a gallery of every picture in it;
- Images that share a **Gallery name** open as one gallery, wherever they are on the page;
- a **Lightbox** element holds any elements you like and opens from any button, link or
  picture.

The [Video element](video.md#video-lightbox) opens the same lightbox for its film.

## A picture, full size {#image-lightbox}

Select an **Image** and turn on **Open in a lightbox**. Pressing the picture — or focusing
it and pressing `Enter` — opens it full size. The lightbox asks the media library for the
largest version that fits the visitor's screen, so a small thumbnail on the page still opens
sharp.

- **Lightbox caption** — a line under the picture in the lightbox.
- **Gallery name** — give several Images the same name and they open as one gallery, with
  previous and next. Leave it empty to open the picture alone.
- **Gallery thumbnails** — a strip of small pictures under a gallery's picture.

The **Alt text** is what a screen reader reads for the picture in the lightbox too. A
**Decorative** image is announced as "Open picture".

An Image that links somewhere — **Link to page** or **External URL** — follows its link
instead. One press cannot both go somewhere and open a lightbox.

## A gallery {#image-list-gallery}

Select an **Image List** and turn on **Open in a lightbox**. Pressing any picture opens a
gallery of every picture in the list, starting at the one pressed:

- **Previous** and **Next** buttons, which wrap around at the ends;
- the arrow keys, and `Home` and `End` for the first and the last picture;
- a sideways swipe on a phone;
- a counter, such as *3 / 12*;
- each tile's **Caption** under its picture, or the picture's own **Lightbox caption**;
- **Gallery thumbnails**, when you turn them on.

## A lightbox of your own {#lightbox-element}

The **Lightbox** element (Surface group) is a container: drop any elements in it — text, a
form, a video, pictures, buttons. It is hidden on the published page until something opens
it.

To open it, give a button, link or picture an interaction: *When clicked →
**Show an element***, and pick the Lightbox as the target. *Show/hide an element* toggles it,
and *Hide an element* on a button inside it closes it — a **Done** button, say. See
[Interactions](interactions-and-custom-html.md#open-a-lightbox).

- **Accessible name** — what a screen reader announces when it opens, such as *Book a call*.
  The close button is named after it.

On the canvas the Lightbox is a small chip. Select it, or anything inside it, and it opens
over the design surface at its real size, so you design its contents as visitors will see
them.

## How a lightbox looks and closes {#lightbox-settings}

Every element that opens a lightbox has the same settings, shown once its lightbox is on:

| Setting | What it does |
| --- | --- |
| **Lightbox backdrop color** | The color behind the lightbox. Empty keeps the dark backdrop. |
| **Lightbox backdrop opacity** | 0 (clear) to 100 (solid). |
| **Lightbox backdrop blur** | Blurs the page behind, in pixels. |
| **Lightbox max width** / **max height** | The largest the lightbox frame grows, such as `1200px` or `90vh`. |
| **Lightbox padding** | Space inside the frame. |
| **Lightbox corner radius** | Rounds the frame's corners, in pixels. |
| **Lightbox close button** | An icon, an icon on a circle, or the word *Close*. |
| **Lightbox close position** | The frame's top right or top left, or the screen's top right. |
| **Lightbox caption** | Below the picture, over the foot of it, or hidden. |
| **Lightbox transition** | Fade, zoom or none. |
| **Close on backdrop click** | On by default. |
| **Close on Escape** | On by default. |

Inside a [reusable component](reusable-components.md), every one of these can be bound to
one of the component's properties, the way the Video's **Open in a lightbox** can — so each
place the component goes can choose, for instance, whether its picture opens large.

## For every visitor {#lightbox-accessibility}

- The lightbox is announced as a dialog, by name, and the rest of the page is set aside for
  screen readers while it is open.
- The keyboard stays inside it until it closes, and returns to whatever opened it.
- `Esc` closes it, unless you turned **Close on Escape** off.
- A visitor who asks their device for reduced motion gets no transition, whatever you chose.

## What it costs a page {#lightbox-performance}

Nothing until it opens. The lightbox's own code is fetched the first time a visitor points at
or presses something that opens one. A gallery's full-size pictures are fetched when they are
shown, not before. The contents of a **Lightbox** element are not in the page at all until
it opens — a video or a form inside one makes no request until then. That also means search
engines do not read what is inside a Lightbox element; keep anything a page needs to rank for
on the page itself.

## Sites Aglyn AI builds {#lightbox-ai}

A **portfolio** or **photography** site that Aglyn AI builds opens its galleries in a
lightbox: the pictures of each gallery section are one gallery, named for the section, with
each item's title as its caption. On any site, Aglyn AI can ask for a single picture to open
large. You can turn either off on the Image afterwards.

## Related

- [Video](video.md) — the film's lightbox and its controls.
- [Interactions & custom HTML](interactions-and-custom-html.md) — opening a Lightbox from
  anything.
- [Element catalog](element-catalog.md) — the Image, the Image List and the Lightbox.
