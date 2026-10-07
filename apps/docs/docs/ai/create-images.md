---
sidebar_position: 14
title: Create images with AI
description: "An AI image generator in the Aglyn media library: describe a picture and get an SVG illustration, icon, pattern or logo mark, or a photo where photos are on, with alt text. Metered in AI credits."
---

# Create images with AI

**Create with AI** in the media library makes pictures from a description and adds them
to the library you have open. There are two kinds:

- **Illustration or icon**: a picture drawn as an SVG, sharp at any size. Choose an
  **Illustration** (a spot illustration or small scene), an **Icon** (one color, or two
  tones), a **Pattern** (a seamless background that tiles) or a **Logo mark** (a simple
  symbol without lettering). Available wherever Aglyn AI is.
- **Photo**: a picture made by Google's image models. Offered only where photo creation
  is turned on for the deployment your workspace runs on; where it is not, the window
  shows only Illustration or icon.

Each picture is stored the way a file you upload is stored: in the open folder, counted
toward your storage, served from the same addresses, and with alt text you can edit.

## Make a picture

1. Open **Media**, on a site or for the organization, and open the folder the pictures
   should land in.
2. Choose **Create with AI**, beside **Upload media**. An empty library offers it beside
   its own **Upload media** button too.
3. Where photos are on, choose **Photo** or **Illustration or icon**. For an
   illustration, choose its **Kind**.
4. Describe the picture: what is in it, the setting, and the style you want.
5. Choose a shape: **Square 1:1**, **Landscape 4:3**, **Portrait 3:4**, **Wide 16:9** or
   **Tall 9:16**, and how many pictures to make, from one to four.
6. For an illustration, choose its colors: **Use my site's theme colors**, which reads
   your site's theme, or **Choose colors** to pick up to six. The organization's library
   belongs to no single site, so there you choose the colors.
7. The window shows what the pictures will cost in credits before you start. Choose
   **Create**.

The pictures appear in the library a few seconds later, selected, so you can move, tag or
open them at once. Nothing is placed on a page: a picture is used only when you put it in
an **Image** element, a gallery or anywhere else a media field asks for one.

## What each picture gets

- **Alt text.** A photo's is your description; an illustration's is a sentence the AI
  writes about what it drew. Edit it in the picture's details like any other alt text.
- **A file name** made from the first few words of your description, starting `ai-` and
  numbered within the set: `.svg` for an illustration, the picture's own type for a photo.
- **A record of how it was made**: the model, your description, the mode, the kind of
  illustration and the shape, kept with the file.
- **For a photo, an invisible watermark.** Google marks every picture its image models
  make with its SynthID watermark, so the picture can later be identified as generated.
  You cannot see it, and it does not change how the picture looks.

## Credits {#credits}

Pictures are metered in [AI credits](overview.md#credits-and-caps) from the workspace's
pool. The window shows an estimate before you create anything:

| Mode | About, per picture | What it is made of |
| --- | --- | --- |
| Illustration or icon | 18 credits | The words the AI reads and writes to draw the SVG, at the same rates as other AI text |
| Photo | 108 credits | The picture, plus the description and the thinking the image model does before it draws |

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

Photos are checked by Google's safety filters, set to block content they rate as a medium
risk or higher, and Google's own policies refuse some content whatever is asked, such as
photorealistic depictions of children or celebrities that its policies do not allow. A
description that is declined is answered with a message and no picture is charged.

## What is sent {#what-is-sent}

- **Illustration or icon:** your description, the kind and shape of picture, and your
  site's theme colors or the colors you chose are sent to the AI service every other
  Aglyn AI feature uses.
- **Photo:** your description and the shape you chose are sent to Google's image models
  on Vertex AI.

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
