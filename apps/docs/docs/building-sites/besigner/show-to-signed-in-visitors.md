---
sidebar_position: 16
title: Show to signed-in or signed-out visitors
description: Show an element only to visitors who are signed in to your site's account, or only to those who are not — "Sign in" for visitors and "Account" for members.
---

# Show to signed-in or signed-out visitors

When your site has accounts, some things are for members and some are for
everyone else: **Sign in** in the header for visitors and **Account** once
they have signed in, a "Create an account" banner only for people who have not,
a "Welcome back" only for those who have.

## Choose who sees an element

1. Select the element on the canvas.
2. In the **Attributes** panel, find **Show to**.
3. Pick **Signed-in visitors** or **Signed-out visitors**. **Everyone** is the default.

For a header that says "Sign in" to visitors and "Account" to members, put two
buttons side by side: set the "Sign in" button to **Signed-out visitors** and
the "Account" button to **Signed-in visitors**. Both can open your account page,
which shows the sign-in form to anyone who is not signed in yet.

## What visitors see

The live site decides as the page loads, so a visitor never sees the wrong
button appear and disappear. Signing in or out on the account page updates the
page straight away.

In the Besigner every element shows, whatever its **Show to**, so you can
select and edit both versions.

:::caution It hides, it does not protect
**Show to** decides what is shown, not who may see it: the content is still in
the page. For content only members may read, use a members-only page.
:::
