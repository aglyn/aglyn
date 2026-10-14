---
sidebar_position: 14
title: Create images with AI
description: "An AI image generator in the Aglyn media library: describe a picture and get an SVG icon or logo mark, a realistic photo, a watercolor, a 3D render or a banner, with alt text. Metered in AI credits."
---

# Create images with AI

**Create with AI** in the media library makes pictures from a description and adds them
to the library you have open. The **Kind** menu lists what it can make, in four sections:

| Section | Kinds | Made as |
| --- | --- | --- |
| **Vector** | **Illustration** (a spot illustration or small scene), **Icon** (one color, or two tones), **Pattern** (a seamless background that tiles), **Logo mark** (a simple symbol without lettering) | An SVG, sharp at any size. Available wherever Aglyn AI is. |
| **Photo** | **Photo** (your description decides the style), **Natural photo**, **Studio product shot**, **Lifestyle with people**, **Architecture & interiors**, **Food**, **Aerial & landscape** | A picture made by Google's image models |
| **Art** | **3D render**, **Watercolor**, **Oil painting**, **Flat vector art**, **Line drawing**, **Cartoon or anime** | A picture made by Google's image models |
| **Design** | **Background or texture**, **Banner or hero image**, **Social post graphic**, **Mockup** (your design on a device screen or packaging) | A picture made by Google's image models |

Every kind but **Photo** adds its own style to your description: a photographic kind
asks for the lens, light and composition that genre is shot with, an art kind for its
medium and strokes, and a design kind for its layout, such as a banner's calm space for a
headline. The Photo, Art and Design sections are offered only where photo creation is
turned on for the deployment your workspace runs on; where it is not, the menu lists the
Vector kinds alone.

Each picture is stored the way a file you upload is stored: in the open folder, counted
toward your storage, served from the same addresses, and with alt text you can edit.

## Make a picture {#make-a-picture}

1. Open **Media**, on a site or for the organization, and open the folder the pictures
   should land in.
2. Choose **Create with AI**, beside **Upload media**. An empty library offers it beside
   its own **Upload media** button too.
3. Choose a **Kind**. Each one shows what a picture of it costs, and choosing it picks a
   shape that suits it — **Wide 16:9** for a banner, **Square 1:1** for a social post —
   which you can change.
4. Describe the picture: what is in it and the setting. For a **Photo**, describe the
   style too.
5. Choose a shape and how many pictures to make; see
   [Shapes and how many](#shapes-and-how-many).
6. For a Vector kind, choose its colors: **Use my site's theme colors**, which reads
   your site's theme, or **Choose colors** to pick up to six. The organization's library
   belongs to no single site, so there you choose the colors. For an Art or Design kind,
   name the colors in your description if you want particular ones; a Photo kind takes the
   colors of the scene.
7. The window shows what the pictures will cost in credits before you start. Choose
   **Create**.

The pictures appear in the library a few seconds later, selected, so you can move, tag or
open them at once. Nothing is placed on a page: a picture is used only when you put it in
an **Image** element, a gallery or anywhere else a media field asks for one.

## Shapes and how many {#shapes-and-how-many}

- **Shape:** **Square 1:1**, **Landscape 4:3**, **Portrait 3:4**, **Wide 16:9** or
  **Tall 9:16**. Choosing a kind picks the shape that suits it, which you can change.
- **How many:** one to four pictures from one description. Each is charged on its own, and
  a picture that is declined or does not come out is not charged.
- **Size:** 512 px on the longer side on the Free plan, about 1024 px on a paid plan. Your
  plan decides it.
- **Description:** up to 1,000 characters.

You can make up to six requests a minute. If one set was partly declined, the window says
how many were added, such as *Added 2 of 4 to the library*, and that the rest were not
charged.

## What each picture gets {#what-each-picture-gets}

- **Alt text.** A picture from the Photo, Art or Design sections takes your description;
  a Vector picture gets a sentence the AI writes about what it drew. Edit it in the picture's details like any other alt text.
- **A file name** made from the first few words of your description, starting `ai-` and
  numbered within the set: `.svg` for a Vector kind, the picture's own type for the others.
- **A record of how it was made**: the model, your description, the kind and the shape,
  kept with the file.
- **For a picture from Google's image models, an invisible watermark.** Google marks every picture its image models
  make with its SynthID watermark, so the picture can later be identified as generated.
  You cannot see it, and it does not change how the picture looks.

## Credits {#credits}

Pictures are metered in [AI credits](overview.md#credits-and-caps) from the workspace's
pool. The window shows an estimate before you create anything:

| Kinds | About, per picture | What it is made of |
| --- | --- | --- |
| Vector | 18 credits | The words the AI reads and writes to draw the SVG, at the same rates as other AI text |
| Photo, Art and Design, on the Free plan | 75 credits | A 512 px picture, plus the description and the thinking the image model does before it draws |
| Photo, Art and Design, on a paid plan | 108 credits | A 1K picture (about 1024 px on its longer side), plus the same |

The size comes from your plan: pictures are 512 px on Free and 1K on every paid plan.

What is charged is what was actually spent, so a picture can cost a little more or less
than its estimate, and an illustration that needed a second attempt costs about twice its
estimate. You are charged only for pictures that reach your library:

- a picture the safety filter holds back is not charged;
- an illustration that does not come out right is not charged. The window says
  *This one's on us — you weren't charged.*
- a picture your library could not store, because your storage is full for example, is
  not charged;
- when the AI service fails, nothing is charged.

A Free workspace spends from its monthly allowance and is told before it starts when the
pictures it asked for would cost more than it has left. A paid workspace past its included
band keeps working at its plan's overage rate unless the workspace stops AI at the band,
the same as every other AI request.

## Safe by construction {#safety}

An illustration is checked before it is stored. It has to be one SVG in the shape you
chose, no larger than 200 KB, and self-contained: no scripts, no links, no embedded images
or web pages, and nothing loaded from anywhere else, such as a font. An illustration that
fails the check is drawn again once with the problem pointed out; if the second one fails
too, it is not stored and not charged. The media library then removes anything unsafe from
every SVG it stores, as it does for an SVG you upload.

The AI declines to draw a real company's or organization's logo, a trademark or a
recognizable brand symbol, a real, named person, and anything sexual, hateful, violent or
otherwise unsafe; the window says why, and a declined request on a Free workspace costs
nothing. A **Logo mark** is always a symbol without lettering.

Pictures from the Photo, Art and Design sections are checked by Google's safety filters,
set to block content they rate as a medium risk or higher, and Google's own policies
refuse some content whatever is asked, such as photorealistic depictions of children or
celebrities that its policies do not allow. The window says so for those kinds: pictures
of real, identifiable people, celebrities or brands may be declined. The people in a
**Lifestyle with people** picture are asked for as made-up people, and a **Cartoon or
anime** picture as original characters. A description that is declined is answered with a
message and no picture is charged.

## Declined pictures {#declined-pictures}

When the image service declines a whole description, the window says *The image service
declined this description. Try describing the scene differently, without real people,
brands or anything unsafe.* Nothing is charged. Pictures of real, identifiable people,
celebrities and brands are the usual reason; describe a made-up person, or the scene
without the brand.

On the Free plan, three declined requests in a day pause free AI generation until the next
day (UTC).

When the workspace has run out of credits, the window says so and how many the pictures
need; make fewer pictures, or wait for the monthly reset. See [AI credits](./ai-credits.md).

## What is sent {#what-is-sent}

- **Vector kinds:** your description, the kind and shape of picture, and your site's
  theme colors or the colors you chose are sent to the AI service every other Aglyn AI
  feature uses.
- **Photo, Art and Design kinds:** your description, followed by the kind's fixed style
  wording, and the shape you chose are sent to Google's image models on Vertex AI.

Nothing else is sent: no other content of your site, no file from your library, and no
name, email address or account identifier. The pictures come back to Aglyn and are stored
in your library; your description is kept with each picture as part of its record of how
it was made.

## Who can use it {#who-can-use-it}

Creating images needs the **Generate with AI** permission and a plan that includes AI
generation — see [who can use Aglyn AI](overview.md#who-can-use-it). It also needs
permission to upload to the library you have open, and on a site whose AI is
[switched off](overview.md#switch-ai-off-for-one-site) it is not offered.

## Related

- [Media Library & CDN](../content-and-data/media/overview.md)
- [Aglyn AI overview](overview.md)
- [AI allotments, usage and model choice](ai-allotments.md)
