---
sidebar_position: 3
title: Custom roles & permissions
description: Define roles with unique permission sets and fine-tune access per member.
---

# Custom roles & permissions

Control what each teammate can do with **roles** — named permission sets — plus optional
**per-member overrides**.

:::info Plan availability
**Paid**.
:::

![The organization Team page, with each member's role picker and Permissions in the roster and Custom roles in the navigation](/img/teams-and-roles/org-team-page.png)

## Create a custom role

1. On the organization **Team** page, find the **Custom roles** card and choose
   **New role**.
2. Give it a name. The permissions are grouped by area (Organization, Billing, Team,
   Sites, Data, Marketplace and plugins) and by plugin (AI, Commerce and the others
   your workspace uses), and **Search permissions** finds one by name or description.
3. Set each permission to **Allow**, **Deny** or **Inherit**. Inherit falls back to
   the member's org role default, and each one says which org roles hold it by
   default. The switch beside a group's heading sets every permission in it at once.
4. Save, then assign it to members from the roster's **Custom role** column.

The permission catalog covers organization settings, the activity log, API keys,
privacy requests, holds and reviews, billing (view and manage separately), member
management, site creation and deletion, the [site permissions](#site-permissions),
organization data, marketplace publishing,
plugin installs, the two AI keys, and every permission the workspace's plugins add,
such as **Use the point of sale** (`managePos`) and the
[reservation permissions](#reservation-permissions). A plugin's permissions are listed
while the plugin is on for the workspace. Owners, admins and editors hold the point
of sale by default and viewers don't, so a custom role can hand the register to a
viewer or take it from an editor. The permission decides on its own: a member's
role on the site no longer has to be admin or editor too, so a site viewer you
grant the register can work it.

### Point of sale permissions {#point-of-sale-permissions}

**Use the point of sale** (`managePos`) opens the register. Five finer permissions
split what it covers: **Sell at the register**, **Refunds and returns**, **Give
discounts at the register**, **Cash drawer and shifts** and **Registers and
devices**. Each one follows **Use the point of sale** until a role or a member sets
it, which is what its **Inherit** says, so a role that only turns the point of sale
on or off works as it always has. Denying a finer permission narrows the register
for that role; allowing one never opens the register by itself, because each also
needs **Use the point of sale**. What each covers is in [Who can do what at the register](../../commerce-and-bookings/commerce/pos-and-reservations.md#who-can-do-what-at-the-register).

**Buy point of sale hardware** (`posBuyHardware`) follows **Use the point of sale**
the same way until a role or a member sets it, but it stands on its own: allowing it
lets a member order card readers from the hardware shop without the register. That
suits a bookkeeper who orders the store's readers and never rings a sale. Denying it
keeps a cashier at the register and out of the shop. See
[Who can buy hardware](../../commerce-and-bookings/commerce/pos-hardware.md#who-can-buy-hardware).

### A site's access narrows its register and waivers {#site-access-narrows}

The register and waivers belong to a site. When an editor who works across the
whole workspace is given **Viewer** or **Author** access to one site, that site also
takes **Use the point of sale**, its five finer permissions, **Manage waivers** and
**Collect waivers** from them there. On every other site they keep what their role,
custom role and overrides give them, and members whose access matches their
workspace role everywhere (owners and admins always do) see no change.

Whether a permission follows the narrower site role is a setting of its own. Each
permission a site can narrow (the point of sale ones, the waivers ones, the two AI ones
and [the two site dataset ones](#dataset-permissions)) has a second choice under it, **On
sites where their role is narrower**:

- **Follow the site role**: on that site the member holds what their Viewer or Author
  access holds, which for the register and waivers is nothing.
- **Keep this permission**: on that site they keep what their role, custom role and
  overrides give them everywhere else.
- **Inherit**: the layer below decides.

Set it on a custom role for everyone on that role, or on one member in their
**Permissions** card, where it wins over their custom role. Left on **Inherit**, the
built-in default applies: the point of sale, waivers and site dataset permissions follow
the site role, and the AI permissions are kept.
Keeping **Sell at the register** also keeps the register open for selling, and only
for selling. The choice changes something only for editors: owners and admins are
admins of every site, and a viewer has no narrower access to be given. Keeping a
permission for a member counts as granting it, so you can only keep one you hold
yourself.

To give a permission that follows the site role back on one site only, open the
site's **Users** card and choose **Permissions** beside them. The dialog lists just
the permissions that follow the site role for them, each **Allow**, **Deny** or
**Inherit** (what their narrower access leaves). Allowing **Sell at the register**
opens the register to sell and nothing else; allowing **Use the point of sale** gives
back the whole register, as far as their workspace role and custom role allow it.
Everything else about them is still set on their Team page.

### Workspace permissions {#workspace-permissions}

Five more workspace actions have a permission each, so a custom role or a per-member
override can hand one to someone outside the roles that held it, or take it away:

| Permission | What it opens | Owner / Admin | Editor | Viewer |
|---|---|---|---|---|
| **Export workspace data** (`org.export`) | Download a copy of everything the workspace holds, from **Settings → Import & export** | Yes | No | No |
| **Sending domains** (`org.sendingDomains`) | Add, verify and remove the domains the workspace's mail is sent from | Yes | No | No |
| **Business profile** (`org.businessProfile`) | Change the services, audience and tone every site starts from | Yes | No | No |
| **Edit the workspace media library** (`org.media`) | Upload, change, move and remove the files every site shares | Yes | Yes | No |
| **Delete workspace records** (`org.eraseRecords`) | Delete a whole dataset or list the workspace shares, with everything in it (deleting one row of a dataset asks **Manage data**) | Yes | Yes | No |

Each starts with exactly the roles that could do it before, so nobody's access changed.

**Manage data** (`data.manage`) decides the workspace's data on its own: creating and
editing datasets, adding, changing and deleting their records, and importing into them
(deleting a whole dataset asks **Delete workspace records**); working the
CRM's records, such as leads, companies, deals and tasks; and changing the workspace's
marketing lists and email topics. Owners, admins and editors hold it by default and viewers
don't, so a custom role or a per-member override can let a viewer do this work, or stop
an editor from doing so. Lists and topics belong to the whole workspace, so a collaborator
added to particular sites doesn't change them, even when granted this permission.

A member invited to one site who holds **Manage data** can add, change and delete records
shared with the whole workspace, such as a company, a deal or a dataset's rows, because a
record shared with every site is shared with theirs too. They can't change what a record is
shared with, and records shared only with other sites stay out of their reach. To keep
someone to their own site's records, share the rest with the sites that need them rather
than with the whole workspace, or take **Manage data** away from them.

### Dataset permissions {#dataset-permissions}

Four permissions sit beside **Manage data** and **Delete workspace records**:

| Permission | What it opens | Owner / Admin | Editor | Viewer | Site Admin / Editor | Site Author / Viewer |
|---|---|---|---|---|---|---|
| **Manage this site's data** (`data.siteManage`) | Change the schema and records of a dataset shared with that site alone, and import into it | Yes | Yes | No | Yes | No |
| **Delete this site's datasets** (`data.siteDelete`) | Delete a dataset shared with that site alone, with its records | Yes | Yes | No | Yes | No |
| **View dataset records** (`data.viewRecords`) | Read the records of the datasets the member can see | Yes | Yes | Yes | Yes | Yes |
| **Export data** (`data.export`) | Take those records out as a file; needs **View dataset records** | Yes | Yes | Yes | Yes | Yes |

**A dataset shared with one site alone answers to that site.** Writing it takes **Manage
data**, or **Manage this site's data** on that site. Deleting it takes **Delete workspace
records**, or **Delete this site's datasets** on that site. So:

- A site Admin or Editor who is a viewer of the workspace can edit and delete the datasets
  shared with that site alone, without holding anything across the workspace. Allow or deny
  either permission for one person from the site's **Users** card, under **Permissions**.
- An editor of the whole workspace given **Viewer** or **Author** access to a site loses
  both on the datasets shared with that site alone, schema, records, delete and import, and
  keeps them everywhere else. They can still change who such a dataset is shared with. Choose **Keep this permission** for either
  permission on their custom role or their **Permissions** card to keep it there, or allow
  it from the site's **Users** card to give it back on that one site. See
  [A site's access narrows its register and waivers](#site-access-narrows), which works the
  same way.
- Someone refused **Manage data** or **Delete workspace records** by a custom role or an
  override doesn't get them back from their site role. Those decisions stand.

A dataset shared with every site or with several answers to **Manage data** and **Delete
workspace records** alone, because no one site speaks for it. So does one shared with all
sites except some, however few sites it reaches today: it belongs to the workspace, and the
next new site joins it. That has two consequences worth knowing:

- A member who reaches only some sites can't delete a dataset shared with every site or with
  several, whatever they hold. It takes access to every site.
- A member who reaches only some sites and holds **Manage data** can change the schema and
  records of a dataset shared with every site or with several of theirs.

Creating a dataset still takes **Manage data**, wherever it's created from, and changing who
a dataset is shared with takes **Manage data** with access to every site.

**View dataset records** and **Export data** start with every role, so taking one away is a
choice you make for a role or a person. Without **View dataset records**, the Data page lists
a member's datasets and says which permission their records need, and AI won't read figures
from them for that member. Without **Export data**, **Export** is shown switched off.
Published sites aren't members: a page showing a dataset's records keeps showing them,
whoever holds what.

### Site permissions {#site-permissions}

Four permissions decide what someone may do on a site:

| Permission | What it opens | Admin | Editor | Author | Viewer |
|---|---|---|---|---|---|
| **Edit site content** (`site.edit`) | Create and change pages, layouts, components, entries, media and the rest of a site's content, without making it live; edit alongside others in the Besigner, and open the edit bar on the live site | Yes | Yes | Yes | No |
| **Publish site content** (`site.publish`) | Publish, unpublish and schedule pages and entries, delete pages and content, change redirects, choose a theme from the library, change the site's fonts, publish forms and members-only posts, and test an automation's actions | Yes | Yes | No | No |
| **See orders and webhooks** (`site.sensitive`) | Read the site's orders and returns and the address its mail is sent from, and set up its webhooks | Yes | Yes | No | No |
| **Manage site settings** (`site.manage`) | Manage the site's people, custom domain, address and plugins, change its plugin settings (such as live chat) and security allow-lists, disconnect a Zap, import and export it, and delete it or a collection (deleting the site also needs **Delete sites**) | Yes | No | No | No |

Each starts from the member's role on the site, the columns above, so nobody's access
changed when they became permissions. Owners and admins are admins of every site, and
someone whose access to one site differs from their workspace role starts from their
access there. An editor of the whole workspace given **Viewer** access to one site, for
example, can't edit alongside others on that site or open its edit bar unless the site
grants them **Edit site content**. A custom role or a per-member override can then grant
or deny any of them, and it applies on every site the member can reach. For someone added to one site
only, set them for that site in its **Users** card: choose **Permissions** beside them.

### Order permissions {#order-permissions}

| Permission | What it opens | Admin | Editor | Author | Viewer |
|---|---|---|---|---|---|
| **Manage orders** (`commerce.orders`) | Fulfill, cancel and print orders, resend receipts, build draft orders, take returns, and record shipments from a file | Yes | Yes | No | No |
| **Create and edit quotes** (`commerce.quotes`) | Create, edit and delete [quotes](../../commerce-and-bookings/commerce/quotes-and-proofs.md) for customers, and download a quote's [PDF](../../commerce-and-bookings/commerce/quotes-and-proofs.md#pdf) | Yes | Yes | No | No |
| **Send quotes and invoices to customers** (`commerce.quotes.send`) | [Email a quote](../../commerce-and-bookings/commerce/quotes-and-proofs.md#send) to the customer, copy its [pay link](../../commerce-and-bookings/commerce/quotes-and-proofs.md#pay-link) to send yourself, and replace it so the old link stops working. [Send an invoice](../../commerce-and-bookings/commerce/orders-and-returns.md#send-invoice) for an order or a quote. A quote's PDF carries the pay link only for someone who has this | Yes | Yes | No | No |
| **Issue gift cards** (`commerce.giftCards`) | Issue, adjust and void the store's gift cards | Yes | Yes | No | No |
| **Import gift cards** (`commerce.giftCards.import`) | Import gift cards from a file, which issues each one as spendable money (also takes **Manage data**) | Yes | No | No | No |
| **Manage payment methods** (`commerce.paymentMethods`) | Turn the store's payment methods on and off (anyone with **Manage orders** sees them) | Yes | No | No | No |
| **Connect shipping apps** (`commerce.shippingConnections`) | Connect, sync and disconnect ShipStation and ShippingEasy, and show or replace their credentials (anyone with **Manage orders** sees whether they're connected) | Yes | No | No | No |
| **Refund orders** (`commerce.refunds`) | Refund any order, online or at the register, with no register limit | Yes* | No | No | No |
| **Approve refunds over the register's limit** (`commerce.posApprovals`) | Refund at the register above its limit, approve a cashier's refund over it with a PIN, and set or clear other staff members' PINs | Yes* | No | No | No |
| **Manage order webhooks** (`commerce.webhooks`) | Add, change, test and remove order webhooks, roll their secrets and resend deliveries | Yes* | No | No | No |

Like the site permissions, each starts from the member's role on the site, so nobody's
access changed when they became permissions, and a custom role, a per-member override
or the site's **Permissions** dialog can grant or deny any of them.

\* Only for a member of the whole workspace. These three move money or the store's
order data out of the business, so someone added to just one site as its admin doesn't
hold them unless that site grants them in its **Permissions** dialog.

### Reservation permissions {#reservation-permissions}

Two permissions decide who may work a site's stays:

| Permission | What it opens |
|---|---|
| **Manage reservations** (`commerce.reservations`) | Check stays in and out, mark no-shows, cancel stays, and add, change and remove what can be booked, on the **Reservations** card and in the apps |
| **Book walk-ins and change guests** (`commerce.walkIns`) | Book a walk-in stay and change how many guests a stay is for |

Both start from the member's role on the site, so nobody's access changed when they
became permissions: a site's admins, editors and authors hold them, and viewers
don't. That includes someone whose access to one site is different from their
workspace role, such as an editor given **Viewer** access there, or a viewer given
**Editor** access there. A custom role or a per-member override can then grant or
deny either one, and it applies on every site the member can reach. **Book walk-ins
and change guests** follows **Manage reservations** until a role or a member sets it,
and it can be allowed on its own: the staff at your check-in window can book walk-ins
without changing anyone's booking. For someone added to one site only, set either one
for that site in its **Users** card: choose **Permissions** beside them.

### Booking permissions {#booking-permissions}

| Permission | What it opens | Admin | Editor | Author | Viewer |
|---|---|---|---|---|---|
| **Take booking payments in person** (`bookings.payments`) | Take a booking's payment at the desk on a card reader | Yes | Yes | No | No |
| **Refund bookings** (`bookings.refunds`) | Refund a paid booking, including **Cancel and refund** | Yes | No | No | No |

Checking guests in and moving bookings follow **Edit site content**, as editing a
booking always has. Like the site permissions, both start from the member's role on
the site, so nobody's access changed when they became permissions, and a custom role,
a per-member override or the site's **Permissions** dialog can grant or deny either one.

### Funnel and campaign permissions {#funnel-and-campaign-permissions}

| Permission | What it opens | Admin | Editor | Author | Viewer |
|---|---|---|---|---|---|
| **Manage funnels** (`funnels.manage`) | Create, change, activate and remove a site's funnels, and draft them with AI | Yes | Yes | No | No |
| **Run email campaigns** (`marketing.campaigns`) | Draft, send, duplicate and manage email campaigns, and see who a send reached | Yes | Yes | No | No |

Both start from the member's role on the site, so nobody's access changed when they became
permissions. In the organization hub, with no site picked, **Run email campaigns** starts from
the workspace role instead: owners, admins and editors of the whole workspace hold it. A custom
role, a per-member override or the site's **Permissions** dialog can grant or deny either one.

Creating or editing a campaign asks **Run email campaigns** on the workspace. On a campaign placed
on one site, holding it on that site is enough too. So turning it off for someone in a site's
**Permissions** dialog stops them sending, duplicating and deleting there, and, if they hold it on
the workspace, they can still create and edit campaigns. A campaign placed on several sites or on
every site follows the workspace permission alone.

### Marketplace permissions on a site {#marketplace-site-permissions}

| Permission | What it opens | Admin | Editor | Author | Viewer |
|---|---|---|---|---|---|
| **Install marketplace items into a site** (`marketplace.siteInstall`) | Install templates, themes, layouts, components, email designs and plugins from the marketplace into the site | Yes | Yes | No | No |
| **Publish a site's items to the marketplace** (`marketplace.sitePublish`) | Publish the site's templates, themes, layouts, components and email designs to the marketplace | Yes | Yes | No | No |

Each works beside the workspace's own marketplace permission (installing from the
marketplace, publishing to it), which is still asked too. Both start from the member's role
on the site, so nobody's access changed when they became permissions, and a custom role, a
per-member override or the site's **Permissions** dialog can grant or deny either one.

### Marketplace publisher permissions {#marketplace-publisher-permissions}

| Permission | What it opens | Owner | Admin | Editor | Viewer |
|---|---|---|---|---|---|
| **Edit the publisher profile** (`marketplace.publisherProfile`) | Change the workspace's public marketplace profile on **Marketplace → Profile**: its handle, name, bio, logo, support contact and links; and ask for the Verified publisher badge on a listing, or withdraw the ask | Yes | Yes | No | No |
| **Manage published listings** (`marketplace.manageListings`) | Edit the listings the workspace has published (their words, pictures and category), make a plugin public or private, unpublish or republish a listing, and read a listing's **Review status** card | Yes | Yes | No | No |
| **Manage marketplace payouts** (`marketplace.payouts`) | Set up, finish and recheck the payout account on **Marketplace → Payouts** that the workspace's paid listings pay into, and open its payouts | Yes | Yes | No | No |

Publishing a new listing is still **Publish to marketplace**, which editors hold too.
Nobody's access changed when these became permissions, and a custom role or a per-member
override can grant or deny each one, so an editor can be trusted with the listings
without the profile or the payouts, or any one of them alone.

Belonging to the publishing workspace is not a permission, so no role grants it or takes
it away: everyone in the workspace installs its own listings on the workspace's own sites
without buying them, and nobody in it can buy or review them. On another workspace's
sites the same people are buyers like anyone else, so that workspace needs its own
license. See
[Your own listings](../../developers/plugins/publishing/publisher-handbook.md#your-own-listings).

### CRM settings permission {#crm-settings-permission}

| Permission | What it opens | Owner | Admin | Editor | Viewer |
|---|---|---|---|---|---|
| **Change CRM settings** (`crm.settings`) | Change what the CRM does for every site on **CRM → Settings**: default sharing for new records, companies from email domains, default owners, assignment rules and the round-robin pool, sharing rules, and rotating the email capture address; and share records across sites by hand | Yes | Yes | No | No |

A custom role or a per-member override can grant or deny it. A site collaborator never
holds it, because it acts on the whole workspace. Everyone who can open the CRM can still
read the settings, and a member without the permission sees each control switched off with
the permission named beside it.

### Moving contacts and deals between stages {#crm-move-stages-permission}

| Permission | What it opens | Admin | Editor | Author | Viewer |
|---|---|---|---|---|---|
| **Move contacts and deals between stages** (`crm.moveStages`) | Change a contact's lifecycle stage, and move a deal through its pipeline, including winning, losing and reopening it | Yes | Yes | No | No |

This one starts from the member's role on the site, so nobody's access changed when it
became a permission. In the organization hub, with no site picked, it follows **Manage
data** until a custom role or a per-member override sets it. A custom role, a per-member
override or the site's **Permissions** dialog can grant or deny it. Moving a deal also
takes **Manage data**. A member without the permission still sees each stage control,
switched off with the permission named beside it.

### Automation and domain permissions {#automation-and-domain-permissions}

| Permission | What it opens | Owner | Admin | Editor | Viewer |
|---|---|---|---|---|---|
| **Manage org automations** (`workflows.orgAutomations`) | Create, change, switch on and off, remove and import the organization's automations | Yes | Yes | Yes | No |
| **Manage the workspace's domains** (`domains.manage`) | The workspace's **Domains** page: buy, transfer in, unlock and renew domains, and change their contacts and DNS (paying also needs **Manage billing**) | Yes | Yes | No | No |

Both are for members of the whole workspace. **Pause org automations on a site**
(`workflows.sitePause`) starts from the member's role on the site instead: a site's admins
and editors hold it. Nobody's access changed when these became permissions, and a custom
role or a per-member override can grant or deny each one.

### Integration permissions {#integration-permissions}

Each integration plugin declares its own permissions, so a custom role, a per-member
override or the site's **Permissions** dialog can grant or deny them one by one. Each
starts from the member's role on the site, so nobody's access changed when they became
permissions. Some reads stay open to everyone on the site: its rewards program and members,
its sales channels, its after-the-sale and review settings, its print-on-demand connections
and imported products, its tax engine connection and a product's tax code, and what an order
shows from a fulfillment network, an inventory system, an online marketplace, an
after-the-sale or review service, or a print-on-demand service.

| Permission | What it opens | Admin | Editor | Author | Viewer |
|---|---|---|---|---|---|
| **See email platform connections** (`marketingPlatforms.view`) | See a site's Mailchimp, Klaviyo, Omnisend or Attentive connections and their sync log | Yes | Yes | No | No |
| **Manage email platform connections** (`marketingPlatforms.manage`) | Connect, change, pause, sync and disconnect those platforms | Yes | No | No | No |
| **See help desk connections** (`helpDesks.view`) | See a site's help desk connections and their sync log | Yes | Yes | No | No |
| **Manage help desk connections** (`helpDesks.manage`) | Connect, change, pause, sync and disconnect a help desk | Yes | No | No | No |
| **Change the rewards program** (`loyalty.program`) | Change how rewards are earned and spent, the referral offer and the emails | Yes | No | No | No |
| **Connect a rewards service** (`loyalty.connection`) | Connect and disconnect Smile.io or Yotpo Loyalty, and bring balances in | Yes | No | No | No |
| **Adjust rewards balances** (`loyalty.adjustBalances`) | Add or take away a member's points or store credit by hand | Yes | Yes | No | No |
| **Turn product feeds on and off** (`salesChannels.feeds`) | Turn a shopping channel's product feed on or off | Yes | Yes | No | No |
| **Change sales channel defaults** (`salesChannels.settings`) | Change the store defaults the feeds use | Yes | Yes | No | No |
| **Replace a feed address** (`salesChannels.replaceAddress`) | Replace a feed's address, and turn off an earlier Google address | Yes | No | No | No |
| **Connect Google and Meta** (`salesChannels.connect`) | Connect and disconnect a Google Merchant Center or Meta catalog, and choose the account | Yes | No | No | No |
| **Push the catalog to a channel** (`salesChannels.sync`) | Send the catalog to a connected channel now | Yes | Yes | No | No |
| **See shipping settings** (`shipping.viewSettings`) | See where parcels ship from, the boxes and the label settings | Yes | Yes | No | No |
| **Change shipping settings** (`shipping.settings`) | Change those settings and the services checkout offers | Yes | No | No | No |
| **Manage label charges** (`shipping.labelCharges`) | See how labels are paid for, and agree to the charges (agreeing also takes **Manage billing**) | Yes | No | No | No |
| **Manage carrier accounts** (`shipping.carrierAccounts`) | See the carrier accounts, connect one and switch them on and off (changing them also takes **Manage billing**) | Yes | No | No | No |
| **Manage your own shipping accounts** (`shipping.ownAccounts`) | See and connect your own Easyship, Sendcloud or ShipperHQ account (changing them also takes **Manage billing**) | Yes | No | No | No |
| **Check rates and see labels** (`shipping.labels`) | Check an address, compare rates and see an order's labels | Yes | Yes | No | No |
| **Buy shipping labels** (`shipping.buyLabels`) | Buy a label or a batch of labels, which charges the workspace | Yes | Yes | No | No |
| **Void shipping labels** (`shipping.voidLabels`) | Void a label that has not been used | Yes | Yes | No | No |
| **See ad conversion connections** (`adConversions.view`) | See which ad accounts a site sends conversions to | Yes | Yes | No | No |
| **Manage ad conversion connections** (`adConversions.manage`) | Connect, change, pause and disconnect an ad account, and send a test event | Yes | No | No | No |
| **See the courier connection** (`couriers.view`) | See a site's courier connection and an order's delivery | Yes | Yes | No | No |
| **Manage the courier connection** (`couriers.manage`) | Connect, test and disconnect a courier, and change its settings and webhook token | Yes | No | No | No |
| **Dispatch couriers** (`couriers.dispatch`) | Get a quote, send a courier for an order, cancel one and refresh where it is | Yes | Yes | No | No |
| **See fulfillment network connections** (`fulfillmentNetworks.view`) | See a site's fulfillment networks and each one's activity | Yes | Yes | No | No |
| **Manage fulfillment network connections** (`fulfillmentNetworks.manage`) | Connect and disconnect a network, change its settings and webhook secret, and run its sync | Yes | No | No | No |
| **Send orders to a fulfillment network** (`fulfillmentNetworks.orders`) | Send an order's lines to a network, or ask it to cancel them | Yes | Yes | No | No |
| **See the inventory connection** (`inventorySync.view`) | See a site's inventory system, its activity and the orders that could not be sent | Yes | Yes | No | No |
| **Manage the inventory connection** (`inventorySync.manage`) | Connect and disconnect a system, change its settings and locations, and run its sync | Yes | No | No | No |
| **Send orders to the inventory system** (`inventorySync.orders`) | Send an order that could not be sent again | Yes | Yes | No | No |
| **See online marketplace connections** (`marketplaces.view`) | See the online marketplaces a site sells on, their activity and the listings to look at | Yes | Yes | No | No |
| **Manage online marketplace connections** (`marketplaces.manage`) | Connect and disconnect a seller account, change its settings and run its sync | Yes | No | No | No |
| **Resend marketplace shipments** (`marketplaces.orders`) | Send an order's refused or failed shipments to its marketplace again | Yes | Yes | No | No |
| **Change after-the-sale services** (`postPurchase.manage`) | Connect, change and disconnect the services that follow an order after it is placed | Yes | No | No | No |
| **Manage print-on-demand connections** (`printOnDemand.manage`) | Connect and disconnect a service, and choose how paid orders are sent to it | Yes | No | No | No |
| **Import print-on-demand products** (`printOnDemand.products`) | Browse a service's products, import or re-sync them, and stop filling a product through it | Yes | Yes | No | No |
| **Work print-on-demand orders** (`printOnDemand.orders`) | See the service orders, and send, confirm, refresh or cancel one | Yes | Yes | No | No |
| **Change review services** (`reviewPlatforms.manage`) | Connect, change and disconnect the services that ask buyers for reviews | Yes | No | No | No |
| **Manage the tax engine connection** (`taxEngines.manage`) | Connect, test and disconnect a tax engine, and change its address, default tax code and recording | Yes | No | No | No |
| **Manage exempt customers** (`taxEngines.exemptions`) | See, save and remove the customers exempt from tax | Yes | Yes | No | No |
| **Set product tax codes** (`taxEngines.productCodes`) | Set the tax code a product is taxed under | Yes | Yes | No | No |
| **Check addresses with the tax engine** (`taxEngines.addresses`) | Ask the tax engine how it reads an address | Yes | Yes | No | No |
| **See and resend orders to the tax engine** (`taxEngines.orders`) | See how an order stands with the tax engine, and send it again | Yes | Yes | No | No |

### Email and inbox permissions {#email-and-inbox-permissions}

| Permission | What it opens | Admin | Editor | Author | Viewer |
|---|---|---|---|---|---|
| **Manage the site's suppressions** (`email.suppressions`) | Add addresses to the site's suppression list and check addresses against it | Yes | Yes | No | No |
| **Add people to marketing lists from a site** (`email.lists`) | Add and remove people on the organization's marketing lists from a site | Yes | Yes | No | No |
| **Reply from the inbox** (`inbox.reply`) | Reply by email to a form submission | Yes | Yes | No | No |
| **Add people to lists from the inbox** (`inbox.assign`) | Add a submission's person to the organization's marketing lists | Yes | Yes | No | No |

Each starts from the member's role on the site, so nobody's access changed when they became
permissions, and a custom role, a per-member override or the site's **Permissions** dialog
can grant or deny any of them. Marketing lists belong to the whole organization, so changing
who is on one also still needs an owner, admin or editor of the whole workspace.

### API keys, privacy requests, and holds {#api-keys-privacy-and-holds}

Three settings sections have a permission each. Owners and admins hold all three by
default, as they always could, and a custom role or a per-member override can hand
one to another member of the whole workspace, or take it from an admin:

| Permission | What it opens |
|---|---|
| **Manage API keys** (`org.apiKeys`) | **Settings → API keys**: create and revoke the workspace's REST API keys |
| **Privacy requests** (`org.privacy`) | **Settings → Privacy**, and **Erase this person** on a contact or lead: file a privacy erasure |
| **Holds and reviews** (`org.holds`) | **Settings → Holds & reviews**, and **Request a review** on a held page |

A site collaborator never holds them: each acts on the whole workspace. Notices about
holds are still emailed to the owners and admins.

### The AI permissions {#ai-permissions}

Two keys decide who may spend the workspace's AI credits:

| Permission | What it opens | Owner / Admin | Editor | Viewer |
|---|---|---|---|---|
| **Use AI assistance** (`ai.use`) | The assistant, copy rewrites, and "generate a section" in the Besigner | Yes | Yes | No |
| **Generate with AI** (`ai.generate`) | AI generation jobs and AI edits — pages, components, emails, campaigns, products, CRM, insights, workflows | Yes | Yes | No |
| **Bring a site in** (`ai.import`) | Import an existing website into the workspace with Bring my site | Yes | No | No |

Both are ordinary catalog keys: a custom role can grant or deny either, and a
per-member override wins over the role. An editor given **Viewer** or **Author**
access to one site keeps both there unless a custom role or their own permissions
set them to **Follow the site role** — see
[A site's access narrows its register and waivers](#site-access-narrows). They are enforced at the AI endpoints
themselves — a member whose role lacks a key is refused with a message naming it
and asking them to see an organization admin, whichever button they reached it
by. A viewer may not ask the assistant even on the Free plan, so an admin can
switch AI off for a read-only teammate without changing their role.

Site collaborators are not decided by these keys. Their AI access is set per site,
from the site role — see [AI access for collaborators](overview.md#collaborator-ai-access).

Permissions are enforced on the server — every one of them is checked by the API that
performs the action, not merely used to hide a button — so a role reliably limits what
a member can do, whichever route they reach it by. Members without billing or settings
permissions don't see those tabs at all either.

The console follows the same permissions as the server. Someone allowed **Manage
members** can change roles, custom roles and per-member permissions on the Team page,
whatever their org role, and someone allowed **Organization settings** gets the
Profile, Plugins, Branding and Single sign-on settings and the General settings form.
The API keys, Privacy and Holds & reviews sections follow their own permissions in
the same way. Changing the workspace URL and handing the workspace over stay with
the owner.

There is deliberately no permission for **marketing** surfaces (announcement bars,
popups, campaigns). Those belong to a **site**, not to the organization, and access to
them follows the member's role on that site — see
[Site access](./invite-teammates.md). An organization-level toggle would suggest a
control the model does not have.

## Effective permissions

Not sure what someone can actually do? The roster's **Permissions** column says what
is set for each member alone — **Role defaults** when nothing is, or how many
permissions are allowed and denied for them — and sorts by it. Choose it to open the
member's permissions: every permission with its final verdict and where that verdict
comes from (their org role, their custom role, or set for this member). The same
list is the **Permissions** card on the member's own page under **Team**.

## Per-member overrides

Need one person to have slightly more (or less) than their role? Set a **per-member
override** on top of the role instead of creating a whole new role for one exception.

1. Open the member from the **Team** roster (or choose their **Permissions** cell).
2. In **Permissions**, find the permission (grouped like the role editor, with
   **Search permissions**) and set it to **Allow** or **Deny**. **Inherit** clears
   the override, and says what the member falls back to. For an editor, a
   permission a site can narrow also offers **Follow the site role** or **Keep this
   permission** for sites where their access is narrower — see
   [A site's access narrows its register and waivers](#site-access-narrows).
3. Choose **Save permissions**.

Overrides win over both the org role and the custom role. A few rules hold them in
check:

- Only members who can manage people (`members.manage`) change overrides.
- The owner keeps every permission, so no override applies to them.
- Nobody changes their own overrides; ask another admin.
- You can only allow a permission you hold yourself, so managing people is not a way
  into billing or the register. The owner can allow anything.

Every change is recorded in the organization's activity log, one row per permission,
naming who changed it and what it became. Members who work on named sites (not the
whole workspace) get their permissions from their site access instead; set those per
site on the site's **Users** card — see
[AI access for collaborators](overview.md#collaborator-ai-access). A site that gives a
workspace editor narrower access sets their register and waivers there, on the same
card — see [A site's access narrows its register and waivers](#site-access-narrows).

## Tips

- Model roles around jobs ("Editor", "Marketer"), not individuals.
- Use overrides sparingly — too many overrides make access hard to reason about.

## Related

- [Invite teammates](invite-teammates.md)
- [Members-only areas](members-only.md)
