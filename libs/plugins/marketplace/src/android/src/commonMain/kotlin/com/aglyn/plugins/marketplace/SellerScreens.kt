package com.aglyn.plugins.marketplace

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.Contracts
import com.aglyn.site.media.MediaChooserDialog
import com.aglyn.site.media.MediaPickField
import com.aglyn.core.mediaPreviewUrl
import com.aglyn.ui.EmptyTone
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.RemoteImage
import com.aglyn.ui.SelectField
import com.aglyn.ui.SelectOption
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import com.aglyn.contracts.PayoutReadiness
import com.aglyn.contracts.isPublisherHandle
import com.aglyn.contracts.payoutReadiness
import com.aglyn.contracts.summarizeSellerLedger
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.Live
import com.aglyn.pluginhost.ActionRunner
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.EmptyState
import com.aglyn.ui.ListHeader
import com.aglyn.ui.MenuAction
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OverflowMenu
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.space

const val MARKETPLACE_SELL_SCREEN = "marketplace.sell"

private val SELL_SECTIONS = listOf(
  ChipOption("profile", "Profile", "person"),
  ChipOption("listings", "Listings", "storefront"),
  ChipOption("payouts", "Payouts", "receipt"),
  ChipOption("sales", "Sales", "insights"),
)

/** The profile fields a publisher edits, in the order the console's form lists them, with the route's key and the label shown. */
private val PROFILE_FIELDS = listOf(
  Triple("displayName", "Display name", KeyboardType.Text),
  Triple("bio", "Bio", KeyboardType.Text),
  Triple("avatarUrl", "Logo", KeyboardType.Uri),
  Triple("website", "Website (https)", KeyboardType.Uri),
  Triple("supportEmail", "Support email", KeyboardType.Email),
  Triple("supportUrl", "Support address (https)", KeyboardType.Uri),
  Triple("githubUrl", "GitHub (https)", KeyboardType.Uri),
  Triple("xUrl", "X (https)", KeyboardType.Uri),
  Triple("linkedinUrl", "LinkedIn (https)", KeyboardType.Uri),
)

/**
 * Selling on the marketplace, the console's seller tabs in one screen: the public profile and the Publisher Agreement, the
 * listings with what can be done to each, payouts through Stripe, and the sales ledger. Publishing a plugin's code (a bundle
 * upload) and a listing's preview image and screenshots stay on the web.
 */
@Composable
fun SellScreen(context: NativePluginContext, initialSection: String? = null) {
  val orgId = context.orgId ?: return EmptyState("Pick a workspace to sell from", icon = AglynIcons.named("storefront"))
  var section by remember { mutableStateOf(initialSection?.takeIf { s -> SELL_SECTIONS.any { it.key == s } } ?: "profile") }
  val profile by remember(orgId, context.firestore) { context.firestore.observeDoc(publisherProfilePath(orgId)) }.collectAsState(Live.Loading)
  var retry by remember { mutableStateOf(0) }
  // `publishToMarketplace` is the admin tier\u2019s and the editor\u2019s (a per-person override is the server\u2019s to enforce).
  val canManage = context.orgRole in INSTALL_ROLES
  Column(Modifier.fillMaxSize()) {
    ListHeader("Selling")
    Column(Modifier.padding(horizontal = space(2f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
      ChoiceChipRow(SELL_SECTIONS, section, { section = it }, wrap = true)
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(space(2f)).testTag("sell-$section"), verticalArrangement = Arrangement.spacedBy(space(2f))) {
      if (!canManage) NoticeBanner("Selling is for a workspace owner, admin or editor. You can see how it stands.", StatusTone.INFO)
      when (section) {
        "profile" -> ProfileSection(context, orgId, (profile as? Live.Ready)?.value?.data, profile is Live.Ready, canManage)
        "listings" -> ListingsSection(context, orgId, canManage)
        "payouts" -> PayoutsSection(context, orgId, profile, canManage, retry = { retry += 1 })
        else -> SalesSection(context, orgId, (profile as? Live.Ready)?.value?.data)
      }
    }
  }
}

@Composable
private fun ProfileSection(context: NativePluginContext, orgId: String, stored: Map<String, Any?>?, loaded: Boolean, canManage: Boolean) {
  val scope = rememberCoroutineScope()
  val runner = remember(orgId) { ActionRunner(scope, roleHint = "an owner, admin or editor") }
  val api = remember(context.api, orgId) { SellerApi(context.api, orgId) }
  val initial = remember(stored) { (listOf("handle") + PROFILE_FIELDS.map { it.first }).associateWith { (stored?.get(it) as? String).orEmpty() } }
  var fields by remember(initial) { mutableStateOf(initial) }
  val valid = isPublisherHandle(fields.getValue("handle")) && fields.getValue("displayName").trim().isNotEmpty()
  SectionCard("Public profile") {
    Text("How your workspace shows to people browsing the marketplace.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    OutlinedTextField(
      fields.getValue("handle"), { fields = fields + ("handle" to it.lowercase()) }, label = { Text("Handle") },
      supportingText = { Text("3 to 30 lowercase letters, digits and hyphens. It is claimed on the server, so two workspaces cannot both have it.") },
      isError = fields.getValue("handle").isNotEmpty() && !isPublisherHandle(fields.getValue("handle")), singleLine = true, enabled = canManage && loaded,
      modifier = Modifier.fillMaxWidth().testTag("seller-handle"),
    )
    for ((key, label, keyboard) in PROFILE_FIELDS.filter { it.first != "avatarUrl" }) {
      OutlinedTextField(
        fields.getValue(key), { fields = fields + (key to it) }, label = { Text(label) }, singleLine = key != "bio", minLines = if (key == "bio") 3 else 1,
        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = keyboard), enabled = canManage && loaded,
        modifier = Modifier.fillMaxWidth().testTag("seller-$key"),
      )
    }
    // The logo is picked from the media library, as the console's profile picks it; never typed.
    MediaPickField(
      context, "Logo", fields.getValue("avatarUrl"), onPick = { fields = fields + ("avatarUrl" to listingMediaValue(it.item.cdnPath, it.item.url)) },
      onClear = { fields = fields + ("avatarUrl" to "") }, enabled = canManage && loaded, workspaceOnly = true, modifier = Modifier.testTag("seller-avatarUrl"),
    )
    runner.error?.let { NoticeBanner(it, StatusTone.WARNING) }
    runner.notice?.let { NoticeBanner(it, StatusTone.SUCCESS) }
    Button(
      onClick = {
        // Trimmed as the console sends them: an empty field explicitly clears what is stored.
        val body = fields.mapValues { it.value.trim() }
        runner.run("Profile saved") { api.saveProfile(body) }
      },
      enabled = canManage && loaded && valid && fields != initial && !runner.busy,
      modifier = Modifier.testTag("seller-save"),
    ) { Text("Save profile") }
  }
  val accepted = ((stored?.get("publisherAgreement") as? Map<*, *>)?.get("version") as? String)
  SectionCard("Marketplace Publisher Agreement") {
    Text(
      if (accepted == null) "Your workspace has not accepted the agreement. It must be accepted before anything is published." else "Your workspace accepted version $accepted.",
      style = MaterialTheme.typography.bodyMedium,
    )
    OutlinedButton(onClick = { context.navigate("marketplace.publisherAgreement") }, modifier = Modifier.testTag("seller-agreement")) { Text("Review the agreement") }
  }
}

@Composable
private fun ListingsSection(context: NativePluginContext, orgId: String, canManage: Boolean) {
  val scope = rememberCoroutineScope()
  val runner = remember(orgId) { ActionRunner(scope, roleHint = "an owner, admin or editor") }
  val api = remember(context.api, orgId) { SellerApi(context.api, orgId) }
  val live by remember(orgId, context.firestore) { context.firestore.observe(sellerListingsQuery(orgId)) }.collectAsState(Live.Loading)
  var editing by remember { mutableStateOf<SellerListing?>(null) }
  val listings = (live as? Live.Ready)?.value?.map(SellerListing::from)?.sortedBy { it.displayName.lowercase() }
  runner.notice?.let { NoticeBanner(it, StatusTone.SUCCESS) }
  runner.error?.let { if (editing == null) NoticeBanner(it, StatusTone.ERROR) }
  when {
    live is Live.Failed -> EmptyState("Could not load your listings", body = "Check the connection and try again.", icon = AglynIcons.named("error"), tone = EmptyTone.ERROR)
    listings == null -> SkeletonList(rows = 4)
    listings.isEmpty() -> Text("Publish a reusable component from a site’s Setup page to list it here.", color = MaterialTheme.colorScheme.onSurfaceVariant)
    else -> SectionCard("Your listings") {
      // Private plugins never show in Browse, so this is the only door to them.
      if (listings.any { it.isPrivate }) {
        Text("Private plugins never appear in the marketplace — open one with View to install it on your sites.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      listings.forEach { listing ->
        AglynListItem(
          title = listing.displayName,
          supporting = listing.subtitle,
          icon = AglynIcons.named("storefront"),
          trailing = {
            Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
              if (listing.isPrivate) StatusChip("Private")
              OverflowMenu(
                listOfNotNull(
                  MenuAction("view-${listing.id}", "View", "info") { context.navigate(MARKETPLACE_LISTING_SCREEN, mapOf("listing" to listing.id)) },
                  MenuAction("edit-${listing.id}", "Edit listing", "edit", enabled = canManage) { runner.clear(); editing = listing },
                  if (listing.isPlugin) {
                    MenuAction("version-${listing.id}", "Publish new version", "upload", enabled = canManage) { context.navigate("marketplace.publishPlugin", mapOf("listing" to listing.id)) }
                  } else {
                    null
                  },
                  if (listing.isPlugin) {
                    MenuAction("visibility-${listing.id}", if (listing.isPrivate) "Make public" else "Make private", "lock", enabled = canManage) {
                      val next = if (listing.isPrivate) "public" else "private"
                      runner.run(if (next == "private") "Now private — only your sites can install it" else "Published to the marketplace") { api.setVisibility(listing.id, next) }
                    }
                  } else {
                    null
                  },
                  MenuAction("published-${listing.id}", if (listing.unpublished) "Republish" else "Unpublish", if (listing.unpublished) "refresh" else "delete", destructive = !listing.unpublished, enabled = canManage) {
                    runner.run(if (listing.unpublished) "Republished" else "Unpublished") { api.setPublished(listing.id, published = listing.unpublished) }
                  },
                ),
              )
            }
          },
          onClick = { context.navigate(MARKETPLACE_LISTING_SCREEN, mapOf("listing" to listing.id)) },
          modifier = Modifier.testTag("seller-listing-${listing.id}"),
        )
      }
    }
  }
  editing?.let { listing -> EditListingDialog(context, listing, runner, api) { editing = null } }
}

/**
 * The console's listing editor: the words and links, the preview image (its own route), the screenshots and the logo,
 * each picture chosen from the workspace's media library (or uploaded there from this device), never typed.
 */
@Composable
internal fun EditListingDialog(context: NativePluginContext, listing: SellerListing, runner: ActionRunner, api: SellerApi, close: () -> Unit) {
  var values by remember(listing.id) {
    mutableStateOf(
      mapOf(
        "displayName" to listing.displayName, "description" to listing.text("description"), "readme" to listing.text("readme"), "logoUrl" to listing.text("logoUrl"),
        "homepageUrl" to listing.text("homepageUrl"), "repositoryUrl" to listing.text("repositoryUrl"), "license" to listing.text("license"), "category" to listing.category,
      ),
    )
  }
  var preview by remember(listing.id) { mutableStateOf(listing.text("previewImageUrl")) }
  var screenshots by remember(listing.id) { mutableStateOf(listing.screenshots) }
  var choosingScreenshot by remember { mutableStateOf(false) }
  ActionDialog(
    title = "Edit listing",
    icon = "edit",
    confirmLabel = "Save listing",
    confirmEnabled = values.getValue("displayName").isNotBlank(),
    busy = runner.busy,
    error = runner.error,
    onDismiss = { runner.clear(); close() },
    onConfirm = {
      val previewChanged = preview != listing.text("previewImageUrl")
      val sentPreview = preview
      val sentScreenshots = screenshots
      runner.run("Listing updated", onDone = close) {
        // The preview is not a content field, so it has its own route, touched only when it changed.
        if (previewChanged) api.setPreviewImage(listing.id, sentPreview)
        api.updateListing(listing.id, values.filterKeys { it != "category" }, values.getValue("category"), sentScreenshots)
      }
    },
  ) {
    Text("Everything here shows on the public listing page.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    for ((key, label) in listOf("displayName" to "Listing name", "description" to "Description", "readme" to "About")) {
      OutlinedTextField(
        values.getValue(key), { values = values + (key to it) }, label = { Text(label) }, singleLine = key == "displayName", minLines = if (key == "readme") 4 else if (key == "description") 2 else 1,
        modifier = Modifier.fillMaxWidth().testTag("listing-$key"),
      )
    }
    MediaPickField(
      context, "Preview image", preview, onPick = { preview = listingMediaValue(it.item.cdnPath, it.item.url) }, onClear = { preview = "" },
      supporting = "Shown on cards and at the top of the listing.", workspaceOnly = true, modifier = Modifier.testTag("listing-preview"),
    )
    Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
      Text("Screenshots (${screenshots.size}/$MAX_LISTING_SCREENSHOTS)", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      if (screenshots.isNotEmpty()) {
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(space(1f))) {
          screenshots.forEachIndexed { index, url ->
            Column(horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally) {
              RemoteImage(
                mediaPreviewUrl(url, context.api.origin, null), "Screenshot ${index + 1}",
                Modifier.size(width = 96.dp, height = 72.dp).clip(MaterialTheme.shapes.small), icon = "image",
              )
              TextButton(onClick = { screenshots = screenshots.filter { it != url } }, modifier = Modifier.testTag("listing-screenshot-remove-$index")) { Text("Remove") }
            }
          }
        }
      }
      if (screenshots.size < MAX_LISTING_SCREENSHOTS) {
        OutlinedButton(onClick = { choosingScreenshot = true }, modifier = Modifier.testTag("listing-screenshot-add")) { Text("Add from media") }
      }
    }
    MediaPickField(
      context, "Logo", values.getValue("logoUrl"), onPick = { values = values + ("logoUrl" to listingMediaValue(it.item.cdnPath, it.item.url)) },
      onClear = { values = values + ("logoUrl" to "") }, supporting = LISTING_LOGO_HINT, onLink = { values = values + ("logoUrl" to it) }, workspaceOnly = true,
      modifier = Modifier.testTag("listing-logoUrl"),
    )
    for ((key, label) in listOf("homepageUrl" to "Homepage (https)", "repositoryUrl" to "Repository (https)", "license" to "License")) {
      OutlinedTextField(
        values.getValue(key), { values = values + (key to it) }, label = { Text(label) }, singleLine = true,
        keyboardOptions = if (key == "license") KeyboardOptions.Default else KeyboardOptions(keyboardType = KeyboardType.Uri),
        modifier = Modifier.fillMaxWidth().testTag("listing-$key"),
      )
    }
    val stored = values.getValue("category")
    // A category the list no longer offers stays chosen rather than silently changing.
    val categories = Contracts.listingCategories + listOfNotNull(stored.takeIf { it.isNotEmpty() && it !in Contracts.listingCategories })
    SelectField("Category", categories.map { SelectOption(it, listingCategoryLabel(it)) }, stored.ifEmpty { null }, { values = values + ("category" to it.orEmpty()) }, Modifier.testTag("listing-category"), noneLabel = "None")
  }
  if (choosingScreenshot) {
    MediaChooserDialog(
      context,
      onChoose = { chosen -> screenshots = addingScreenshot(listingMediaValue(chosen.item.cdnPath, chosen.item.url), screenshots); choosingScreenshot = false },
      onDismiss = { choosingScreenshot = false },
      workspaceOnly = true,
    )
  }
}

@Composable
private fun PayoutsSection(context: NativePluginContext, orgId: String, profile: Live<com.aglyn.core.FirestoreDoc?>, canManage: Boolean, retry: () -> Unit) {
  val scope = rememberCoroutineScope()
  val runner = remember(orgId) { ActionRunner(scope, roleHint = "an owner, admin or editor") }
  val api = remember(context.api, orgId) { SellerApi(context.api, orgId) }
  val uri = LocalUriHandler.current
  var dashboard by remember { mutableStateOf<String?>(null) }
  val data = (profile as? Live.Ready)?.value?.data
  val readiness = payoutReadiness(
    when (profile) { is Live.Ready -> "loaded"; is Live.Failed -> "error"; Live.Loading -> "pending" },
    data?.get("stripeChargesEnabled"), data?.get("stripePayoutsEnabled"), data?.get("stripeAccountLivemode"),
  )
  val chargesEnabled = readiness in setOf(PayoutReadiness.READY, PayoutReadiness.BLOCKED, PayoutReadiness.UNKNOWN, PayoutReadiness.UNVERIFIED)
  SectionCard("Payouts") {
    runner.error?.let { NoticeBanner(it, StatusTone.ERROR) }
    runner.notice?.let { NoticeBanner(it, StatusTone.SUCCESS) }
    when (readiness) {
      PayoutReadiness.ERROR -> NoticeBanner(
        "We couldn’t load your payout setup. This says nothing about whether payouts are on — nothing has changed.", StatusTone.ERROR,
        action = { TextButton(onClick = retry) { Text("Retry") } },
      )
      PayoutReadiness.PENDING -> Text("Checking your payout setup…", color = MaterialTheme.colorScheme.onSurfaceVariant)
      else -> {
        if (readiness == PayoutReadiness.BLOCKED) {
          NoticeBanner(
            "Your Stripe account can take payments, but payouts are not enabled yet — sales would stay in Stripe rather than reaching your bank. Finish verification in Stripe to release them.",
            StatusTone.WARNING,
          )
        }
        if (readiness == PayoutReadiness.UNVERIFIED) {
          NoticeBanner(
            "This Stripe account has not been verified for payments here, so sales will be refused. Reconnect it to confirm — if it was set up against Stripe test mode, you will need to connect a live account.",
            StatusTone.ERROR,
          )
        }
        Text(payoutsSentence(readiness), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        val action = {
          runner.run {
            try {
              val answer = api.connect() ?: return@run
              if (answer.chargesEnabled) {
                // A link Stripe minted is the only way into an Express account that cannot release payouts yet.
                if (answer.payoutsEnabled == false && answer.url != null) {
                  uri.openUri(answer.url)
                  return@run
                }
                if (answer.payoutsEnabled != false) dashboard = answer.dashboardUrl
                runner.notice = if (answer.payoutsEnabled == false) "Connected — payouts are not released yet" else "Payouts are enabled"
              } else {
                answer.url?.let(uri::openUri)
              }
            } catch (error: ConsoleApiError) {
              if (error.status == 501) runner.notice = "Payouts are not configured on this deployment" else throw error
            }
          }
        }
        if (chargesEnabled) {
          OutlinedButton(onClick = action, enabled = canManage && !runner.busy, modifier = Modifier.testTag("seller-payouts")) { Text(if (runner.busy) "Opening Stripe…" else payoutsButton(readiness)) }
        } else {
          Button(onClick = action, enabled = canManage && !runner.busy, modifier = Modifier.testTag("seller-payouts")) { Text(if (runner.busy) "Opening Stripe…" else payoutsButton(readiness)) }
        }
        dashboard?.let { url -> TextButton(onClick = { uri.openUri(url) }) { Text("View payouts in Stripe") } }
      }
    }
  }
}

@Composable
private fun SalesSection(context: NativePluginContext, orgId: String, profile: Map<String, Any?>?) {
  val live by remember(orgId, context.firestore) { context.firestore.observe(sellerSalesQuery(orgId)) }.collectAsState(Live.Loading)
  val sales = (live as? Live.Ready)?.value
  SectionCard("Sales") {
    when {
      live is Live.Failed -> Text("Sales could not be loaded. Check the connection and try again.", color = MaterialTheme.colorScheme.onSurfaceVariant)
      sales == null -> Text("Loading…", color = MaterialTheme.colorScheme.onSurfaceVariant)
      sales.isEmpty() -> Text("No sales yet. Paid listings appear here with what buyers paid and what was paid out to you.", color = MaterialTheme.colorScheme.onSurfaceVariant)
      else -> {
        val totals = summarizeSellerLedger(sales.map { it.data })
        Text(
          "${totals.paidCount} sale${if (totals.paidCount == 1) "" else "s"}" + if (totals.refundedCount > 0) " · ${totals.refundedCount} refunded or charged back" else "",
          style = MaterialTheme.typography.bodyMedium,
        )
        // The payout first, named for what it is: the instruction given at charge time, not an arrival at the bank.
        Text("Sent to your Stripe account ${dollars(totals.sentToStripeCents)}", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.testTag("seller-sent"))
        val failedAt = (profile?.get("lastPayoutFailureAtMs") as? Number)?.toDouble()
        if (failedAt != null && failedAt != 0.0) {
          val cents = (profile["lastPayoutFailureCents"] as? Number)?.toDouble() ?: 0.0
          NoticeBanner(
            "A payout of ${dollars(cents)} did not reach your bank on ${com.aglyn.core.localDayAndTime(failedAt.toLong()).first} — ${(profile["lastPayoutFailureReason"] as? String) ?: "Stripe did not say why"} The money is still in your Stripe account. Open Stripe to fix your payout details.",
            StatusTone.WARNING,
          )
        }
        Text(
          "Buyers paid ${dollars(totals.buyersPaidCents)} · sales tax ${dollars(totals.salesTaxCents)} · platform fee ${dollars(totals.platformFeeCents)}",
          style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (totals.refundedCount > 0) {
          Text("${dollars(totals.returnedCents)} returned on refunded and charged-back sales, and excluded above", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Text(
          "Sent to your Stripe account is the pre-tax price less the platform fee. Sales tax is collected and remitted by $PLATFORM_LEGAL_NAME under its marketplace-provider registration and was never part of your share. Reaching your Stripe balance is not the same as reaching your bank — a failed payout is called out above.",
          style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
    }
  }
}
