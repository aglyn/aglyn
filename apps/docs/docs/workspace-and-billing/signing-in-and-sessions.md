---
sidebar_position: 3
title: Signing In & Sessions
description: How console sign-in works — Google sign-in on desktop and mobile, one session across all your workspaces, and automatic sign-out after inactivity.
---

# Signing In & Sessions

Sign in to the console with **email & password** or **Google**. A few behaviors are worth
knowing about, especially if you work across devices or multiple organization workspaces.

## Google sign-in

- On **desktop**, Google sign-in opens a popup window and returns you to the console when
  it completes.
- On **mobile browsers**, the console uses a full-page redirect instead: you're taken to
  Google, sign in there, and land back on the console already authenticated. (Mobile
  browsers can't reliably hand a popup's result back to the opening page.)

## Sign-in methods

You can link **both** methods to one account, and then sign in either way — same
profile, same workspaces, no duplicate account. Manage them under
[Manage Account → Account](manage-account.md#sign-in-methods):

- **Continue with Google** links Google to an account that signed up with a password.
- **Disconnect** unlinks Google again.
- **Email & password** is marked **Required** and can't be disconnected — it's the
  method that always works.

Your last remaining sign-in method can never be removed, so there's no way to lock
yourself out.

### Signing in with any of your addresses

If you keep more than one [email address](manage-account.md#email-addresses) on your
account, you can type **any confirmed one** on the sign-in page with your usual
password — you don't have to remember which address the account was opened with.
Unconfirmed addresses don't work here, and neither does an address on somebody else's
account.

**Single sign-on accounts are the exception.** If your company signs you in through
its own identity provider, no other method can be linked — see
[Manage Account](manage-account.md#sign-in-methods) for why, and for what happens
to methods linked before your organization enabled enforcement.

## Resetting your password

Forgot your password? From the sign-in screen, choose **Account recovery** and enter your
email. We email you a secure reset link, then walk you through the rest:

1. **Request** — enter your email on the account recovery screen and submit. We always show
   the same "check your email" confirmation, whether or not an account exists for that
   address (so the screen can't be used to probe who has an account).
2. **Email** — open the message and follow the reset link. Links expire after a short
   while and can only be used once.
3. **Choose a new password** — the link opens the reset screen, which confirms whose
   account it's for and asks for a new password (entered twice). Password rules match the
   sign-up screen.
4. **Done** — once saved, head back to the sign-in screen and sign in with your new
   password.

If a link has expired or was already used, the reset screen offers to send a fresh one.

If you signed up with Google and have never set a password, there's nothing to reset —
connect **Email & password** from [Manage Account](manage-account.md#sign-in-methods)
first.

:::note Self-hosting
Aglyn composes and sends the reset and verification emails itself, through your configured
mail provider — **you do not need to set a Firebase action URL**, and the Firebase email
templates are not used at all. Firebase still mints the one-time code; only the message
and the link's host are Aglyn's, and the link is built from your own console origin.

What you do still need: the console domain listed under **Authentication → Settings →
Authorized domains**, and a working mail provider. If mail is unconfigured, account
recovery still returns its usual "check your email" screen — deliberately, so the screen
can't be used to probe who has an account — but no message goes out. Check your server
logs for `[auth/send-password-reset] email is not configured`.
:::

## One session across workspaces

Signing in on the main console signs you in to every `{org}` workspace subdomain too — the
session is shared at the parent domain, so hopping between workspaces never re-prompts for
credentials. Signing out anywhere retires the shared session everywhere.

## Automatic sign-out after inactivity

For security, an idle console session expires after **1 hour of no activity** (in any open
tab, on any of your workspace subdomains). When that happens you're returned to the
sign-in screen, and the page you were on is preserved — after signing back in you resume
exactly where you left off.

Activity means any interaction: pointer movement, typing, scrolling, or touching. Active
work in one tab keeps your other tabs alive too.

Inactivity is the **only** thing that ends a session early: a background tab losing its
own authentication (a laptop waking from sleep, a suspended tab, a network blip) recovers
silently from the shared session instead of signing you out everywhere. Only an explicit
sign-out — yours, or a staff-initiated revocation — retires the shared session.

:::note Self-hosting
The idle window is configurable via the `NEXT_PUBLIC_AUTH_IDLE_TIMEOUT_MINUTES`
environment variable (default `60`; set `0` to disable).
:::

## When the console asks you to sign in again

Sometimes a session stops working without ending. A tab left open overnight, a laptop
that slept for a long weekend, or a sign-out somewhere else can leave the console holding
credentials the server no longer accepts. The pages you already loaded keep rendering
from their cache, so nothing looks broken — but anything the console tries to fetch comes
back refused, and lists load empty.

When that happens the console opens **Sign in again to verify your device** over whatever
you were doing. You do not have to find a message and work out what to do about it: the
dialog *is* the fix.

- **You stay where you are.** No redirect, no lost page, and unsaved changes stay on
  screen behind the dialog.
- **Sign in with your usual method** — your password, your Google or single sign-on
  account, or a passkey. The dialog closes and the data that would not load, loads.
- **Not now** puts it away. The page stays usable and read-only-ish: what is already on
  screen is fine, but lists that failed will still be incomplete, and each of them offers
  **Sign in again** to bring the dialog back.

It is a real sign-in, not a confirmation. There is no way to dismiss your way back into a
working session, because the session itself is what stopped working.

:::note
Occasionally the console instead says it cannot reach your data and that **signing in
again will not help**. That is a different problem — it is not your account and not your
session, nothing has been deleted, and it usually clears on its own. Signing out at that
point only makes it harder to diagnose, so don't.
:::

## Recent sign-ins

When your account is signed in to from a device it has not been used on before,
we email you: the device, the approximate location, the IP address, and the
time. **Manage Account → Security → Recent sign-ins** is the list that email
points at — every device that has signed in to your account, newest first, up
to the last 50.

Each row names the device as a summary of its browser and operating system
("Chrome on Windows"), and beneath it the approximate location, the IP address,
when it was last used, and when it was first seen. Location and IP come from
the network the request arrived on, so they are approximate — a mobile
connection or a VPN can put you in a city you have never been to.

A device here is a browser that holds a long-lived cookie we set when you sign
in, not a fingerprint of your hardware. Clearing cookies, using a private
window, or switching browsers therefore shows up as a **new** device, and the
first device ever recorded on an account never triggers the email.

### When we do not email you

We do not send the alert for a device that signs in from the **same IP address
and the same operating system** as a device already on your list, seen within
the last 30 days. That is the shape of clearing your cookies, opening a private
window, making a new browser profile, or using a second browser on the same
machine — all the same person on the same computer, and an alert people learn
to ignore is worth less than no alert.

Three things bound it, because "same network" is not "same person" on an office
or café connection:

- the device is still **recorded and still listed**, marked with the reason no
  email was sent, so a sign-in is never invisible even when it is silent;
- a device on a *different* operating system behind the same address always
  gets an email;
- at most three alerts a day can be suppressed this way. Past that you are
  emailed about every one.

### Signing a device out

**Sign out** on a row ends its sessions. Because of how the underlying sign-in
works, there is no way to end one device's session and leave the others: the
button signs out **every device on your account, including the one you are
using**, and you will be asked to sign in again. The confirmation says so
before you click.

Anything that goes through us — every console page, every action, every API
call — stops **within a few seconds**. What survives longer is narrower, but it
is not nothing: a tab that is *already open* on the signed-out device holds a
short-lived token it cannot renew, and until that token expires — **up to an
hour** — it can still reach your workspace's data directly, to read it **and to
change it**. Uploaded files are the exception: those always go through us, so
they stop at once. The tab goes dark when the token expires. If you believe
someone else has access, sign out and then
[reset your password](#resetting-your-password) as well, and treat anything
changed in that hour as suspect. The row stays in the list, marked with when it
was signed out, rather than disappearing.

**If you do not recognise a sign-in**, treat it as an account compromise: sign
it out, [reset your password](#resetting-your-password), and add a passkey from
the same Security section.

If the card cannot load your history it says so. That is not the same as an
empty list — do not read a failed load as "nothing else has signed in".

**If you cannot get in yourself** — the stolen device is the one with your email
on it, or you are locked out — [support](support-and-community.md) can do this
for you. It is the same action with the same effect, taken against the same
list, and it is recorded against the staff member who took it. It does **not**
disable your account and does **not** change your password, so you can sign in
again the moment it is done.

## Passkeys

**Manage Account → Security → Passkeys** lists every passkey on your account,
when it was added and when it was last used, with **Set up a passkey** to add
one and **Remove** on each row.

Passkeys are *additive*. Adding one never weakens or replaces anything —
your password and your sign-in providers keep working exactly as before — so
losing an authenticator costs you a convenience, not your account.

### Removing one

Use **Remove** when a device is lost or stolen, or when you no longer want a
particular key on the account. Removing a passkey:

- stops that passkey signing in, immediately and everywhere;
- does **not** sign you out anywhere. Sessions the passkey already started
  are ended by [signing out of a device](#recent-sign-ins), which is a
  separate control;
- does **not** touch your password or your other sign-in methods.

You can set the same device up again afterwards — removing a passkey frees it
completely, rather than blocklisting it.

### "Blocked — possible credential copy"

Every authenticator keeps a counter that only goes up. If a passkey presents a
counter that has gone *backwards*, that is the signature of a **copied**
credential, so Aglyn refuses the sign-in and marks the passkey Blocked.

A Blocked passkey stays refused. It is not a warning you can sign past, and it
does not clear itself — the only signal there will ever be is the one
regression, so throwing it away after a single refusal would throw away the
detection. Sign in another way, then **Remove** the passkey and set the device
up again if you still have it.

Rarely, an authenticator with a buggy counter can trigger this on a device
nobody has copied. The remedy is the same, and it is the reason Remove exists
next to it.

## Downloading your data

**Manage Account → Close account → Download my data** gives you a machine-readable JSON
copy of everything we hold about you: your profile and contact details, your workspace
memberships, your passkeys, your public publisher handle, and the support messages you
wrote. It is the same file we would send if you asked us in writing.

It is deliberately scoped to *you*. A workspace is shared, so your colleagues' details
are not in it — a support thread you took part in contributes only the messages you
wrote yourself, not the replies. To take a whole workspace with you, use the workspace
export below instead.

**It never contains a secret.** API keys, webhook secrets, password hashes and payment
links are listed as *present* rather than reproduced, so the file tells you what exists
without becoming something you can lose. An API key's identifier is withheld too,
because that identifier is derived from the key itself.

That is decided by what a value **looks like**, not only by what the field is called —
a credential is withheld whether it sits in a field named `webhook_secret`, one named
`supplierToken`, or one named nothing in particular. A credential carried inside a URL is
stripped out of the address while the address itself stays, so you can still see where
your own files live. Ordinary content, prose, identifiers and content hashes are not
touched: a list of names is a list somebody has to keep up to date, and the whole point of
this file is that it does not quietly stop covering something.

The file opens with a `coverage` section naming every place we looked and what was done
with each — including the two things that are deliberately *not* included, and why. If
something you expected is missing, that section is where to check first.

### Downloading a whole workspace

Owners and admins can export an entire workspace from **Settings → Delete → Download
workspace data**: its sites and their content, datasets, contacts, orders, form
submissions, members, support threads, custom domains and billing identifiers.

Do this **before** deleting a workspace. Deletion keeps no copy, and the 7-day hold is
the window in which this export is still possible.

:::note What survives a deletion
Sales-tax records for transactions on your storefront are kept after an erasure, because
tax law requires it. They are included in the export — it is the one place you can see
what remains.
:::

## Closing your account

**Manage Account → Close account** permanently deletes your personal account. It removes
your profile and contact details, your avatar, your notifications, and your sign-in, and
takes you off every workspace roster you're on.

This cannot be undone, and support cannot restore it.

**Workspaces are never deleted by closing an account.** A workspace outlives the person
who created it, and deleting one as a side effect of someone closing their personal
account would take its sites and data with it. So if you are the **sole owner** of a
workspace, closing your account is refused until you hand that workspace over — the
message names each one, along with whether it has an active subscription and how many
other members it has. Transfer ownership from **Team → Permissions**, then come back here.

Being a member, editor, admin or site collaborator is never a blocker; only sole
ownership is.

You'll be asked to confirm twice: once by proving it's you (your password, or a fresh
sign-in through your provider), and once by typing `DELETE`. Both are required, and the
confirmation of identity has to be recent — starting the flow and leaving it open for an
hour will ask you again.

:::note Single sign-on
If your organization uses SSO, your account also exists in your identity provider's
directory. Closing it here removes you from Aglyn; it does not touch your account with
your identity provider, and an administrator there may be able to provision you again.
:::
