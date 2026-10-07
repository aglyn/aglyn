---
sidebar_position: 14
title: Create images with AI
description: "An AI image generator inside the Aglyn media library: describe a picture, choose its shape and how many, and it is added to Media with alt text, ready to place on a page. Metered in AI credits."
---

# Create images with AI

**Create with AI** in the media library makes pictures from a description, such as
*"a sunlit bakery counter with fresh sourdough loaves, warm morning light"*, and adds them
to the library you have open. Each picture is stored the way a file you upload is stored:
in the open folder, counted toward your storage, served from the same addresses, and with
alt text written from your description.

:::note Availability
Create with AI appears in Media only where image generation is turned on for the
deployment your workspace runs on. If you do not see it beside **Upload media**, it is not
on for your workspace yet.
:::

## Make a picture

1. Open **Media**, on a site or for the organization, and open the folder the pictures
   should land in.
2. Choose **Create with AI**, beside **Upload media**. An empty library offers it beside
   its own **Upload media** button too.
3. Describe the picture. Say what is in it, the setting and the light, and the style you
   want: a photo, an illustration, a flat icon.
4. Choose a shape: **Square 1:1**, **Landscape 4:3**, **Portrait 3:4**, **Wide 16:9** or
   **Tall 9:16**, and how many pictures to make, from one to four.
5. The window shows what the pictures will cost in credits before you start. Choose
   **Create**.

The pictures appear in the library a few seconds later, selected, so you can move, tag or
open them at once. Nothing is placed on a page: a picture is used only when you put it in
an **Image** element, a gallery or anywhere else a media field asks for one.

## What each picture gets

- **Alt text** written from your description. Edit it in the picture's details like any
  other alt text; a description written for the generator is not always the best
  description for a screen reader.
- **A file name** made from the first few words of your description, starting `ai-` and
  numbered within the set.
- **A record of how it was made**: the model, your description and the shape, kept with
  the file.
- **An invisible watermark.** The image service marks every picture it makes with Google's
  SynthID watermark, so the picture can later be identified as generated. You cannot see
  it, and it does not change how the picture looks.

## Credits {#credits}

Each picture is metered in [AI credits](overview.md#credits-and-caps) from the
workspace's pool, at a fixed rate per picture that the window shows before you create
anything. You are charged only for pictures that reach your library:

- a picture the safety filter holds back is not charged;
- a picture your library could not store, because your storage is full for example, is
  not charged;
- when the image service fails, nothing is charged.

A Free workspace spends from its monthly allowance and is told before it starts when the
pictures it asked for would cost more than it has left. A paid workspace past its included
band keeps working at its plan's overage rate unless the workspace stops AI at the band,
the same as every other AI request.

## What it will not make {#safety}

The image service checks every description and every picture against Google's safety
filters, set to block content they rate as a medium risk or higher, and it does not make
pictures of children. A description it declines is answered with a message and charges
nothing; try describing the scene differently. Some pictures in a set can be held back
while others arrive, and the window says how many were added.

Pictures of real, named people, brands and logos are not a good use of it. Use your own
photographs for those.

## What is sent {#what-is-sent}

The description you type, the shape and the number of pictures are sent to Google's
image models on Vertex AI. Nothing else is sent: no other content of your site, no file
from your library, and no name, email address or account identifier. The pictures come
back to Aglyn and are stored in your library; your description is kept with each picture
as part of its record of how it was made.

## Who can use it {#who-can-use-it}

Creating images needs the **Generate with AI** permission and a plan that includes AI
generation — see [who can use Aglyn AI](overview.md#who-can-use-it). It also needs
permission to upload to the library you have open, and on a site whose AI is
[switched off](overview.md#switch-ai-off-for-one-site) it is not offered.

## Related

- [Media Library & CDN](../content-and-data/media/overview.md)
- [Aglyn AI overview](overview.md)
- [AI allotments, usage and model choice](ai-allotments.md)
