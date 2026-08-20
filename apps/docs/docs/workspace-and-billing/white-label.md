---
sidebar_position: 7
title: White-label
description: Replace the Aglyn brand across the console, your published sites, and transactional email — product name, logo, colors, support URL, and email from-name.
---

# White-label

White-labeling replaces the Aglyn brand everywhere your organization and its
sites are shown: the console your team signs in to, the sites you publish, and
the transactional email your members and customers receive.

It is one setting card, and the fields are short. The part worth reading
closely is [what each field actually replaces](#fields) — a few of them change
a surface you never look at yourself.

:::info Plan availability
White-labeling is the `whiteLabel` entitlement. Exactly two plans carry it by
default: **Agency** and **Enterprise**. No lower tier does, and no add-on
buys it.

Entitlements can also be granted per organization on top of a plan's
defaults, which is how an Enterprise agreement enables it for one organization
— the card's own upgrade notice says so.

An organization that white-labels and then downgrades reverts cleanly: the
stored brand is ignored, not deleted, and the Aglyn brand comes back
everywhere at once. Upgrade again and the same values return.
:::

## Where the settings are {#where}

1. Open your organization's **Settings** page — the heading reads
   **Organization Settings**.
2. Choose the **Branding** tab.
3. The card is **White-label brand**.

You need the **admin** role. The Branding tab is not shown at all to members
below it, so a teammate who cannot find it is looking at a shorter tab strip
than you are, not at a hidden card.

While your plan is still being read the card says **"Checking your plan…"**.
On a plan without the entitlement it shows an information notice instead of
the editor: *"White-labeling the platform is included on the **Agency** plan —
see Billing to upgrade. Enterprise plans can enable it per organization."*

## The fields {#fields}

Every field is optional. **Leave one blank and it keeps the Aglyn default for
that field** — the greyed-out placeholder text in each box is that default, so
a blank box is showing you exactly what will be used.

Two fields are the exception, and both fall back to **nothing** rather than to
an Aglyn value: **Support URL** and **Email logo URL**. Their placeholders say
so. Leaving Support URL blank means no support link is shown anywhere — your
customers are never sent to Aglyn's support desk, which could not help them
and would name us to someone who was never told we exist.

| Field | Helper text under it | What it replaces |
| --- | --- | --- |
| **Product name** | Shown in the console chrome, site badge, and emails. | The word "Aglyn" wherever the product names itself |
| **Email from-name** | Display name on transactional email (the verified sending address is unchanged). | The display name in the recipient's inbox |
| **Support URL** | Linked from branded surfaces and email footers. Leave it blank and no support link appears at all — your customers are never sent to Aglyn. | Where a "need help?" link points, or nothing |
| **Primary color** | CSS hex color used for the console primary and site badge. | The console's primary color, live |
| **Logo URL** | Console chrome + site badge. Browse the org media library or paste an https URL. | The Aglyn wordmark in the console header |
| **Favicon URL** | Browser tab icon for branded console surfaces. | The browser-tab icon |
| **Email logo URL** | Logo shown in transactional email headers (a hosted PNG works best). | Nothing — it *adds* a header to your email. See [below](#email) |
| **Custom console domain** | Saved now; domain routing to it ships in a later phase. | Nothing yet. See [below](#custom-console-domain) |

**Logo URL**, **Favicon URL** and **Email logo URL** each carry a **Browse**
button that opens your organization's media library, so you do not have to
host the file yourself or paste a URL by hand.

Press **Save brand**. A confirmation reads **"Brand settings saved"**.

:::note What the save will refuse
**Support URL**, **Logo URL**, **Favicon URL** and **Email logo URL** must
begin with `https://`. A plain `http://` or a bare hostname is rejected by
name — "Logo URL must be an https:// URL" — rather than saved and quietly
ignored later.

**Primary color** must be a hex color: `#1a73e8` or the three-digit `#1ae`.
Anything else is refused with "Primary color must be a hex color like
#1a73e8". Color names and `rgb()` are not accepted.
:::

## Where you will see the change {#where-you-see-it}

- **Console header.** Your **Logo URL** replaces the Aglyn wordmark. Set a
  **Product name** but no logo and the name is rendered as text in the same
  place instead.
- **Console theme and tab.** **Primary color** and **Favicon URL** are applied
  to the page you are already on, so the change is visible without a reload.
- **Published sites.** The site badge and the site favicon follow the same
  brand.
- **Site fingerprint.** The `<meta name="generator">` tag and the
  `x-powered-by` header that otherwise credit Aglyn are suppressed on a
  white-label organization's published sites. This one is worth knowing about
  because it is invisible in a browser and is the part a technically curious
  visitor would otherwise read.
- **Transactional email.** Covered in its own section next.

One counter-intuitive rule governs all of it: **the branded chrome activates
only once you have actually set a product name or a logo**, not the moment
your plan grants the entitlement. An Agency organization that has never opened
this card keeps the plain Aglyn wordmark — there is no half-branded state and
no flash of one brand turning into the other.

## The email half {#email}

Email is where white-labeling used to leak, and it is the part that changed
most recently.

### Merge tokens {#merge-tokens}

Every system email resolves three brand tokens, for every organization:

| Token | Resolves to |
| --- | --- |
| `{{brand.productName}}` | Your **Product name**, or `Aglyn` |
| `{{brand.fromName}}` | Your **Email from-name**, or `Aglyn` |
| `{{brand.supportUrl}}` | Your **Support URL**, or **empty** |

They resolve on Aglyn's own organizations too, which is what lets one email
template be correct for both populations instead of hard-coding the majority
case. If your organization is not white-labeled, the tokens render the Aglyn
values.

`{{brand.supportUrl}}` is the one that can render as nothing, and only for a
white-labeled organization that left the field blank. Aglyn's own support page
is never substituted — the email your customer receives reads as you
throughout, and a link to our desk in it would be the one thing on the page
that is not. Aglyn's built-in emails drop the whole "Need help?" line rather
than leave a dangling phrase; a template you design places the token yourself,
so put it somewhere a blank reads cleanly.

### The email logo {#email-logo}

**Email logo URL** renders as a **centered header row at the top of the email
body**, above whatever the template itself lays out, inside the same 600-pixel
column — so on a phone it scales with the message rather than floating against
the viewport. Its height is capped rather than fixed, so a wide wordmark and a
square mark both land at a sensible size without you supplying dimensions.

Two details are deliberate and quiet:

- **A blank Email logo URL emits nothing at all** — not an empty row, not a
  spacer. (Support URL behaves the same way, for the same reason.) An email with a gap where a logo should be reads as broken; an email
  with no logo reads as plain, which is the right appearance for an
  organization that has not set one.
- **The image's `alt` text is your product name.** Most inboxes block remote
  images by default, so for a large share of recipients the alt text *is* the
  header. Setting **Email logo URL** without setting **Product name** gives
  those recipients a blank box where your identity should be.

There is no `{{brand.logoUrl}}` token, and that is on purpose: the logo is
structural, placed by the renderer, so a template can never forget to include
it or place it twice.

### The sending address does not change {#sending-address}

**Email from-name** changes the display name only. The address the mail is
actually sent from stays the deployment's verified sending address, because
that is what the receiving mail servers authenticate against.

## Known limitation: the custom console domain {#custom-console-domain}

**Custom console domain** is saved but **does nothing yet**, and the field
says so in its own helper text: *"Saved now; domain routing to it ships in a
later phase."* Your team still signs in at the standard console address.

Saving it is not entirely inert. The name is **reserved** for your
organization when you save it, so nobody else can claim it in the meantime,
and the reservation is released if you clear the field or change it to a
different name. What has not shipped is the routing and certificate half —
until that lands, a reservation is all the field buys, and pointing DNS at it
achieves nothing.

## Not the same as renaming a self-hosted platform {#platform-brand}

These two get confused constantly, and they are unrelated mechanisms:

| | White-label brand | Platform brand |
| --- | --- | --- |
| Who sets it | An organization admin, in the console | Whoever runs the deployment, in its environment |
| Scope | That one organization | The entire installation, every organization on it |
| How | The card on this page | `NEXT_PUBLIC_PLATFORM_BRAND_NAME` and friends |
| Gated on | The `whiteLabel` entitlement | Nothing — it is deployment configuration |
| Takes effect | On save | On the next image **build**, not a restart |

If you are running Aglyn yourself and want the product to stop calling itself
Aglyn for everybody, that is the platform brand, not this card — see
[Self-hosting](../developers/self-hosting.md#platform-brand). The two compose:
on a self-hosted installation, an organization without the `whiteLabel`
entitlement falls back to *the operator's* platform brand rather than to
Aglyn's.

## Related

- [Billing & plans](billing-and-plans/overview.md#tiers--entitlements)
- [Teams, roles & membership](teams-and-roles/overview.md)
- [Self-hosting](../developers/self-hosting.md)
