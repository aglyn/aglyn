package com.aglyn.plugins.marketplace

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.InstallTarget
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.Live
import com.aglyn.core.mediaPreviewUrl
import com.aglyn.core.nowMillis
import com.aglyn.core.relativeTime
import com.aglyn.pluginhost.ActionRunner
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListDetail
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.DetailRow
import com.aglyn.ui.EmptyState
import com.aglyn.ui.EmptyTone
import com.aglyn.ui.ListHeader
import com.aglyn.ui.LoadContent
import com.aglyn.ui.LoadMoreEffect
import com.aglyn.ui.MediaThumb
import com.aglyn.ui.MenuAction
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.OverflowMenu
import com.aglyn.ui.RefreshableBox
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SelectOption
import com.aglyn.ui.SelectField
import com.aglyn.ui.SelectionPlaceholder
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatRow
import com.aglyn.ui.StatTile
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.space

const val MARKETPLACE_BROWSE_SCREEN = "marketplace.browse"
const val MARKETPLACE_LISTING_SCREEN = "marketplace.listing"
const val MARKETPLACE_INSTALLED_SCREEN = "marketplace.installed"
const val MARKETPLACE_LICENCES_SCREEN = "marketplace.licenses"
const val MARKETPLACE_PLUGIN_SETTINGS_SCREEN = "marketplace.plugin-settings"

/** Publishing to the marketplace is a spec screen (marketplace.screens.json): what this site and the workspace can publish. */
const val MARKETPLACE_PUBLISH_SCREEN = "marketplace.publish"

/** Workspace roles with `plugins.install` (`installPlugins`): the admin tier and editors. */
internal val INSTALL_ROLES = setOf("owner", "admin", "editor")

/** Site roles every host install route admits. */
internal val SITE_INSTALL_ROLES = setOf("admin", "editor")

private fun canInstall(context: NativePluginContext) = context.orgRole in INSTALL_ROLES && context.siteRole in SITE_INSTALL_ROLES

private sealed interface ListingDialog {
  data class Install(val scope: InstallTarget?) : ListingDialog
  data class Uninstall(val scope: InstallTarget) : ListingDialog
  data object Review : ListingDialog
  data object Report : ListingDialog
  /** Reporting someone else's review: its reviewer's uid and name. */
  data class ReportReview(val uid: String, val name: String) : ListingDialog
}

/** The marketplace's sections, as the console's hub tabs them. */
@Composable
private fun SectionTabs(context: NativePluginContext, current: String) {
  ChoiceChipRow(
    listOf(
      ChipOption(MARKETPLACE_BROWSE_SCREEN, "Browse all", "storefront"),
      ChipOption(MARKETPLACE_INSTALLED_SCREEN, "Installed", "extension"),
      ChipOption(MARKETPLACE_LICENCES_SCREEN, "Licenses", "receipt"),
      ChipOption(MARKETPLACE_PUBLISH_SCREEN, "Publish", "upload"),
      ChipOption(MARKETPLACE_SELL_SCREEN, "Selling", "storefront"),
    ),
    current,
    { if (it != current) context.navigate(it) },
  )
}

/**
 * Browse: the listings the workspace may see, by category, search and order,
 * the picked one beside the list on wide windows with its details, versions,
 * reviews and install.
 */
@Composable
fun BrowseScreen(context: NativePluginContext, initialListingId: String? = null) {
  val scope = rememberCoroutineScope()
  val model = remember(context.orgId, context.firestore) { BrowseModel(context.orgId, context.firestore, scope) }
  LaunchedEffect(model) { model.reload() }
  // A card's Install opens its listing with the listing's own Install asked straight away.
  var installFor by remember { mutableStateOf<String?>(null) }
  var view by remember { mutableStateOf(com.aglyn.ui.ListView.LIST) }
  AglynListDetail(
    initialSelected = initialListingId,
    list = { selected, onSelect ->
      val listState = rememberLazyListState()
      LoadMoreEffect(listState, model.hasMore, onLoadMore = model::loadMore)
      Column(Modifier.fillMaxSize()) {
        ListHeader("Marketplace")
        Column(Modifier.padding(horizontal = space(2f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
          SectionTabs(context, MARKETPLACE_BROWSE_SCREEN)
          com.aglyn.ui.ListToolbar(
            model.search, model::type, placeholder = "Search the marketplace", tag = "marketplace",
            sorts = BrowseSort.entries.map { com.aglyn.ui.SortOption(it.name, it.label) },
            sort = model.sort.name,
            onSort = { model.order(BrowseSort.valueOf(it)) },
            view = view,
            onView = { view = it },
          )
          ChoiceChipRow(
            listOf(ChipOption("", "All")) + Contracts.listingCategories.map { ChipOption(it, listingCategoryLabel(it)) },
            model.category ?: "",
            { model.pick(it.ifEmpty { null }) },
          )
        }
        RefreshableBox(model.refreshing, model::refresh) {
          LoadContent(model.rows, onRetry = { model.reload() }, failedTitle = "Could not load the marketplace") { rows ->
            if (rows.isEmpty()) {
              EmptyState("Nothing matches", body = "Try another search or category.", icon = AglynIcons.named("storefront"))
            } else {
              LazyColumn(Modifier.fillMaxSize().testTag("listings"), state = listState) {
                if (model.search.isBlank() && model.category == null) {
                  item(key = "home") {
                    MarketplaceHome(context.firestore, context.orgId, context.api.origin, onOpen = onSelect, onInstall = { id -> installFor = id; onSelect(id) })
                  }
                }
                if (view == com.aglyn.ui.ListView.GRID) {
                  items(rows.chunked(2), key = { chunk -> chunk.first().id }) { chunk ->
                    Row(Modifier.fillMaxWidth().padding(horizontal = space(2f), vertical = space(0.75f)), horizontalArrangement = Arrangement.spacedBy(space(1.5f))) {
                      for (row in chunk) ListingCard(row, context.api.origin, { onSelect(row.id) }, { installFor = row.id; onSelect(row.id) }, Modifier.weight(1f))
                      if (chunk.size == 1) androidx.compose.foundation.layout.Spacer(Modifier.weight(1f))
                    }
                  }
                } else items(rows, key = { it.id }) { row ->
                  AglynListItem(
                    title = row.name,
                    supporting = listOfNotNull(artifactLabel(row.artifactType), row.category, ratingLabel(row), "${row.installCount} installs").joinToString(" · "),
                    icon = AglynIcons.named(if (row.artifactType == "plugin") "extension" else "widgets"),
                    selected = row.id == selected,
                    trailing = { StatusChip(priceLabel(row.priceUsd), if (row.paid) StatusTone.INFO else StatusTone.SUCCESS) },
                    onClick = { onSelect(row.id) },
                    modifier = Modifier.testTag("listing-${row.id}"),
                  )
                }
                if (model.hasMore) item { SkeletonList(rows = 2) }
              }
            }
          }
        }
      }
    },
    detail = { selected ->
      if (selected == null) {
        SelectionPlaceholder("Pick a listing to see it here", icon = AglynIcons.named("storefront"))
      } else {
        ListingDetail(context, selected, startInstall = installFor == selected) { installFor = null }
      }
    },
  )
}

/** One listing on its own, as a link to `/{org}/marketplace/{listingId}` opens it. */
@Composable
fun ListingScreen(context: NativePluginContext, listingId: String) = ListingDetail(context, listingId)

@Composable
private fun ListingDetail(context: NativePluginContext, listingId: String, startInstall: Boolean = false, onInstallAsked: () -> Unit = {}) {
  val scope = rememberCoroutineScope()
  val api = remember(context.api) { MarketplaceApi(context.api) }
  val runner = remember(listingId) { ActionRunner(scope, roleHint = "an owner, admin or editor") }
  var dialog by remember(listingId) { mutableStateOf<ListingDialog?>(null) }
  val live by remember(listingId, context.firestore) { context.firestore.observeDoc("$LISTINGS/$listingId") }.collectAsState(Live.Loading)
  when (val value = live) {
    Live.Loading -> SkeletonList(rows = 6, modifier = Modifier.padding(space(2f)))
    is Live.Failed -> EmptyState("Could not load this listing", body = "Check the connection and try again.", icon = AglynIcons.named("error"), tone = EmptyTone.ERROR)
    is Live.Ready -> {
      val listing = value.value?.let(ListingRow::from)
      if (listing == null || listing.deleted || listing.workspaceLocked) {
        return EmptyState("This listing does not exist", body = "It may have been removed.", icon = AglynIcons.named("storefront"))
      }
      val hostId = context.hostId
      val orgId = context.orgId
      val hostPin by remember(hostId, listingId, context.firestore) {
        if (hostId != null) context.firestore.observeDoc("hosts/$hostId/installs/$listingId") else kotlinx.coroutines.flow.flowOf(Live.Ready(null))
      }.collectAsState(Live.Loading)
      val orgPin by remember(orgId, listingId, context.firestore) {
        if (orgId != null) context.firestore.observeDoc("orgs/$orgId/installs/$listingId") else kotlinx.coroutines.flow.flowOf(Live.Ready(null))
      }.collectAsState(Live.Loading)
      val hostDoc = (hostPin as? Live.Ready)?.value
      val orgDoc = (orgPin as? Live.Ready)?.value
      val state = resolvePluginInstallState(
        listing.offeredVersion,
        hostDoc?.data?.get("version")?.let { com.aglyn.pluginhost.jsString(it) },
        hostDoc != null,
        orgDoc?.data?.get("version")?.let { com.aglyn.pluginhost.jsString(it) },
        orgDoc != null,
      )
      val plugin = listing.artifactType == "plugin"
      val mine = listing.profileId != null && listing.profileId == orgId
      LaunchedEffect(startInstall, listing.id) {
        if (!startInstall) return@LaunchedEffect
        onInstallAsked()
        val targets = installTargets(listing.artifactType)
        if (state.installedVersion == null && canInstall(context) && context.hostId != null && (!plugin || listing.offeredVersion != null)) {
          dialog = ListingDialog.Install(if (InstallTarget.HOST in targets) InstallTarget.HOST else targets.firstOrNull())
        }
      }
      ListingBody(context, listing, plugin, state, mine, runner, api) { dialog = it }
      ListingDialogs(context, listing, dialog, state, api, runner) { dialog = null }
    }
  }
}

@Composable
private fun ListingBody(
  context: NativePluginContext,
  listing: ListingRow,
  plugin: Boolean,
  state: PluginInstallState,
  mine: Boolean,
  runner: ActionRunner,
  api: MarketplaceApi,
  open: (ListingDialog) -> Unit,
) {
  var versions by remember(listing.id) { mutableStateOf<List<ListingVersion>?>(null) }
  LaunchedEffect(listing.id) { versions = runCatching { api.versions(listing.id) }.getOrNull() ?: emptyList() }
  val reviews by remember(listing.id, context.firestore) {
    context.firestore.observe(FirestoreQuery("$LISTINGS/${listing.id}/reviews", orderBy = listOf(FirestoreOrder("__name__")), limit = 100))
  }.collectAsState(Live.Loading)
  val publisher by remember(listing.profileId, context.firestore) {
    listing.profileId?.let { context.firestore.observeDoc("publisherProfiles/$it") } ?: kotlinx.coroutines.flow.flowOf(Live.Ready(null))
  }.collectAsState(Live.Loading)
  val handle = (publisher as? Live.Ready)?.value?.let { it.string("handle") ?: it.string("displayName") }
  val now = remember(listing.id) { nowMillis() }
  val installable = canInstall(context) && context.hostId != null
  val targets = installTargets(listing.artifactType)
  val offered = listing.offeredVersion
  Column(
    Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(space(2f)).testTag("listing-detail"),
    verticalArrangement = Arrangement.spacedBy(space(2f)),
  ) {
    if (runner.error != null) NoticeBanner(runner.error!!, StatusTone.ERROR)
    runner.notice?.let { NoticeBanner(it, StatusTone.SUCCESS, action = { TextButton(onClick = runner::clear) { Text("Dismiss") } }) }
    SectionCard(null) {
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1.5f))) {
        MediaThumb(mediaPreviewUrl(listing.imageUrl, context.api.origin, null, 160), contentDescription = null, icon = if (plugin) "extension" else "widgets", modifier = Modifier.size(64.dp))
        Column(Modifier.weight(1f)) {
          Text(listing.name, Modifier.semantics { heading() }, style = MaterialTheme.typography.headlineSmall)
          Text(
            listOfNotNull(artifactLabel(listing.artifactType), handle?.let { "@$it" }, offered?.let { "v$it" }).joinToString(" · "),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall,
          )
        }
        OverflowMenu(
          listOf(
            MenuAction("review", "Rate and review", "star", enabled = !mine) { open(ListingDialog.Review) },
            MenuAction("report", "Report this listing", "warning") { open(ListingDialog.Report) },
          ),
        )
      }
      // The owner's actions on the listing itself: a plugin ships a new version from here, and any listing is edited here.
      if (mine && context.orgRole in INSTALL_ROLES) OwnerActions(context, listing.id, plugin)
      FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
        StatusChip(priceLabel(listing.priceUsd), if (listing.paid) StatusTone.INFO else StatusTone.SUCCESS)
        if (listing.verified) StatusChip("Verified publisher", StatusTone.SUCCESS)
        if (listing.reviewed) StatusChip("Reviewed", StatusTone.SUCCESS)
        if (listing.visibility == "private") StatusChip("Private")
        (listing.categories.ifEmpty { listOfNotNull(listing.category) }).forEach { StatusChip(listingCategoryLabel(it)) }
        if (state.installedVersion != null) {
          StatusChip("Installed (v${state.installedVersion})" + if (state.scope == InstallTarget.ORG) " · Org-wide" else "", StatusTone.SUCCESS)
          if (state.shadowed) StatusChip("Org-wide (shadowed)", StatusTone.WARNING)
        }
      }
      if (!mine && listing.paid && state.installedVersion == null) {
        NoticeBanner("A paid listing is bought once for the workspace; buying is not in the app yet.", StatusTone.INFO)
      }
      FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
        when {
          plugin && state.installedVersion != null -> {
            if (state.updateAvailable && offered != null) {
              Button(onClick = { open(ListingDialog.Install(state.scope)) }, enabled = installable && !runner.busy, modifier = Modifier.testTag("listing-update")) {
                Text("Update to v$offered")
              }
            }
            OutlinedButton(onClick = { open(ListingDialog.Uninstall(state.scope ?: InstallTarget.HOST)) }, enabled = installable && !runner.busy, modifier = Modifier.testTag("listing-uninstall")) {
              Text(if (state.scope == InstallTarget.ORG) "Remove from the workspace" else "Remove from this site")
            }
          }
          else -> {
            Button(
              onClick = { open(ListingDialog.Install(if (InstallTarget.HOST in targets) InstallTarget.HOST else targets.firstOrNull())) },
              enabled = installable && !runner.busy && (!plugin || offered != null),
              modifier = Modifier.testTag("listing-install"),
            ) {
              Icon(AglynIcons.named("download"), contentDescription = null)
              Text(if (InstallTarget.HOST in targets) "Install on this site" else "Install", Modifier.padding(start = space(1f)))
            }
            if (InstallTarget.ORG in targets && InstallTarget.HOST in targets) {
              OutlinedButton(onClick = { open(ListingDialog.Install(InstallTarget.ORG)) }, enabled = installable && !runner.busy && offered != null) {
                Text("Install for every site")
              }
            }
          }
        }
      }
      if (plugin && offered == null) NoticeBanner("No reviewed version yet: it can be installed once one passes review.", StatusTone.WARNING)
      if (!installable) NoticeBanner("Installing needs the editor role in the workspace and on the picked site.", StatusTone.NEUTRAL)
    }
    StatRow {
      StatTile("Rating", if (listing.ratingCount > 0 && listing.ratingAverage != null) com.aglyn.pluginhost.jsNumber(listing.ratingAverage) + " ★" else "—", Modifier.weight(1f), if (listing.ratingCount > 0) "${listing.ratingCount} ratings" else "Not yet rated")
      StatTile("Installs", (listing.activeInstalls ?: listing.installCount).toString(), Modifier.weight(1f), "${listing.installCount} all time")
    }
    if (listing.description.isNotBlank()) SectionCard("About") { Text(listing.description) }
    listing.readme?.let { readme -> SectionCard("Read me") { Text(readme.take(4000), style = MaterialTheme.typography.bodyMedium) } }
    SectionCard("Versions") {
      when (val list = versions) {
        null -> SkeletonList(rows = 2)
        else -> {
          if (list.isEmpty()) Text("No published versions yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
          list.forEachIndexed { index, version ->
            if (index > 0) HorizontalDivider()
            AglynListItem(
              title = "v${version.version}",
              supporting = listOfNotNull(version.publishedAtMs?.let { "Published " + relativeTime(it, now) }, version.activeInstalls?.let { "$it active" }, version.changelog).joinToString(" · "),
              icon = AglynIcons.named("history"),
            )
          }
        }
      }
    }
    SectionCard("Reviews", action = { if (!mine) TextButton(onClick = { open(ListingDialog.Review) }) { Text("Write a review") } }) {
      when (val list = reviews) {
        Live.Loading -> SkeletonList(rows = 2)
        is Live.Failed -> Text("Reviews could not be loaded.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        is Live.Ready -> {
          val rows = list.value.mapNotNull(ReviewRow::from).sortedByDescending { it.updatedAtMs ?: 0 }
          if (rows.isEmpty()) Text("No reviews yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
          rows.forEachIndexed { index, review ->
            if (index > 0) HorizontalDivider()
            AglynListItem(
              title = review.name + (review.rating?.let { " · " + "★".repeat(it.toInt().coerceIn(0, 5)) } ?: ""),
              supporting = listOfNotNull(review.comment, if (review.verifiedInstaller) "Verified installer" else null, review.updatedAtMs?.let { relativeTime(it, now) }).joinToString(" · "),
              icon = AglynIcons.named("person"),
              trailing = if (review.uid == context.uid) ({
                TextButton(onClick = { runner.run("Your review was removed.") { api.deleteReview(listing.id) } }) { Text("Delete") }
              }) else ({
                // Not on your own review: the queue is for what someone else wrote.
                TextButton(onClick = { open(ListingDialog.ReportReview(review.uid, review.name)) }, modifier = Modifier.testTag("review-report-${review.uid}")) { Text("Report") }
              }),
            )
          }
        }
      }
    }
    SectionCard("Details") {
      DetailRow("License", listing.license)
      DetailRow("Homepage", listing.homepageUrl)
      DetailRow("Source", listing.repositoryUrl)
      DetailRow("Listing id", listing.id)
    }
  }
}

@Composable
private fun ListingDialogs(
  context: NativePluginContext,
  listing: ListingRow,
  dialog: ListingDialog?,
  state: PluginInstallState,
  api: MarketplaceApi,
  runner: ActionRunner,
  close: () -> Unit,
) {
  val hostId = context.hostId
  when (dialog) {
    null -> Unit
    is ListingDialog.Install -> ActionDialog(
      title = when {
        state.updateAvailable -> "Update ${listing.name}?"
        dialog.scope == InstallTarget.ORG -> "Install ${listing.name} for every site?"
        else -> "Install ${listing.name}?"
      },
      body = when {
        listing.artifactType == "theme" -> "It replaces this site's theme. Setup → Theme has a way back."
        dialog.scope == InstallTarget.ORG -> "Every site in the workspace gets it, except a site with its own install of it."
        listing.artifactType == "plugin" -> "It runs on this site's pages once installed."
        else -> marketplaceLandingMessage(listing.artifactType, listing.name)?.let { "Once installed: $it" }
      },
      icon = "download",
      confirmLabel = if (state.updateAvailable) "Update" else "Install",
      busy = runner.busy,
      error = runner.error,
      onDismiss = { runner.error = null; close() },
      onConfirm = {
        if (hostId == null) return@ActionDialog
        runner.run(onDone = close) {
          val outcome = api.install(listing, hostId, dialog.scope)
          runner.notice = outcome.message + (outcome.warning?.let { " $it" } ?: "")
        }
      },
    )
    is ListingDialog.Uninstall -> ActionDialog(
      title = "Remove ${listing.name}?",
      body = if (dialog.scope == InstallTarget.ORG) "It stops running on every site that uses the workspace's install." else "It stops running on this site.",
      icon = "delete",
      confirmLabel = "Remove",
      destructive = true,
      busy = runner.busy,
      error = runner.error,
      onDismiss = { runner.error = null; close() },
      onConfirm = {
        if (hostId == null) return@ActionDialog
        runner.run("Removed \"${listing.name}\".", onDone = close) { api.uninstall(listing.id, hostId, dialog.scope) }
      },
    )
    ListingDialog.Review -> {
      var rating by remember { mutableStateOf(0) }
      var comment by remember { mutableStateOf("") }
      ActionDialog(
        title = "Review ${listing.name}",
        body = "A rating needs an installed copy; a comment alone does not.",
        icon = "star",
        confirmLabel = "Post",
        confirmEnabled = rating > 0 || comment.isNotBlank(),
        busy = runner.busy,
        error = runner.error,
        onDismiss = { runner.error = null; close() },
        onConfirm = { runner.run("Thanks — your review is posted.", onDone = close) { api.review(listing.id, rating.takeIf { it > 0 }, comment) } },
      ) {
        ChoiceChipRow((1..5).map { ChipOption(it.toString(), "★".repeat(it)) }, rating.takeIf { it > 0 }?.toString(), { rating = it.toInt() }, wrap = true)
        OutlinedTextField(comment, { comment = it.take(2000) }, label = { Text("Comment") }, minLines = 3, modifier = Modifier.fillMaxWidth().testTag("review-comment"))
      }
    }
    ListingDialog.Report -> ReportDialog(listing.name, "listing", null, listing.id, api, runner, close)
    is ListingDialog.ReportReview -> ReportDialog("this review by ${dialog.name}", "review", dialog.uid, listing.id, api, runner, close)
  }
}

/** The plugins installed on the picked site and for the whole workspace, with update and remove. */
@Composable
fun InstalledScreen(context: NativePluginContext) {
  val hostId = context.hostId ?: return
  val orgId = context.orgId
  val scope = rememberCoroutineScope()
  val api = remember(context.api) { MarketplaceApi(context.api) }
  val runner = remember(hostId) { ActionRunner(scope, roleHint = "an owner, admin or editor") }
  val sitePins by remember(hostId, context.firestore) { context.firestore.observe(FirestoreQuery("hosts/$hostId/installs", limit = 50)) }.collectAsState(Live.Loading)
  val orgPins by remember(orgId, context.firestore) {
    if (orgId != null) context.firestore.observe(FirestoreQuery("orgs/$orgId/installs", limit = 50)) else kotlinx.coroutines.flow.flowOf(Live.Ready(emptyList()))
  }.collectAsState(Live.Loading)
  var removing by remember { mutableStateOf<InstallPinRow?>(null) }
  val installable = canInstall(context)
  Column(Modifier.fillMaxSize()) {
    ListHeader("Installed")
    Column(Modifier.padding(horizontal = space(2f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
      SectionTabs(context, MARKETPLACE_INSTALLED_SCREEN)
      if (removing == null) {
        runner.notice?.let { NoticeBanner(it, StatusTone.SUCCESS, action = { TextButton(onClick = runner::clear) { Text("Dismiss") } }) }
        runner.error?.let { NoticeBanner(it, StatusTone.ERROR) }
      }
    }
    val site = (sitePins as? Live.Ready)?.value?.map { InstallPinRow.from(it, InstallTarget.HOST) }
    val org = (orgPins as? Live.Ready)?.value?.map { InstallPinRow.from(it, InstallTarget.ORG) }
    when {
      site == null || org == null -> SkeletonList(rows = 4, modifier = Modifier.padding(space(2f)))
      site.isEmpty() && org.isEmpty() -> EmptyState("No plugins installed", body = "Browse the marketplace to add one to this site or the whole workspace.", icon = AglynIcons.named("extension"))
      else -> LazyColumn(Modifier.fillMaxSize().testTag("installed-list")) {
        val shadowedIds = site.map { it.listingId }.toSet()
        items(site + org, key = { "${it.scope}-${it.listingId}" }) { pin ->
          AglynListItem(
            title = pin.name,
            supporting = listOfNotNull(
              pin.version?.let { "v$it" },
              if (pin.scope == InstallTarget.ORG) "Every site" else "This site",
              if (pin.scope == InstallTarget.ORG && pin.listingId in shadowedIds) "this site has its own install" else null,
            ).joinToString(" · "),
            icon = AglynIcons.named("extension"),
            trailing = {
              OverflowMenu(
                listOf(
                  MenuAction("open-${pin.listingId}", "Details", "info") { context.navigate(MARKETPLACE_LISTING_SCREEN, mapOf("listing" to pin.listingId)) },
                  MenuAction("remove-${pin.listingId}", "Remove", "delete", destructive = true, enabled = installable) { removing = pin },
                ),
              )
            },
            onClick = { context.navigate(MARKETPLACE_LISTING_SCREEN, mapOf("listing" to pin.listingId)) },
            modifier = Modifier.testTag("pin-${pin.listingId}"),
          )
        }
      }
    }
  }
  removing?.let { pin ->
    ActionDialog(
      title = "Remove ${pin.name}?",
      body = if (pin.scope == InstallTarget.ORG) "It stops running on every site that uses the workspace's install." else "It stops running on this site.",
      icon = "delete",
      confirmLabel = "Remove",
      destructive = true,
      busy = runner.busy,
      error = runner.error,
      onDismiss = { runner.error = null; removing = null },
      onConfirm = { runner.run("Removed \"${pin.name}\".", onDone = { removing = null }) { api.uninstall(pin.listingId, hostId, pin.scope) } },
    )
  }
}

/** The licenses the workspace holds: each live purchase, who bought it, and what was paid. */
@Composable
fun LicencesScreen(context: NativePluginContext) {
  val orgId = context.orgId ?: return EmptyState("Pick a workspace to see its licenses", icon = AglynIcons.named("receipt"))
  var licensedTo by remember(orgId) { mutableStateOf<String?>(null) }
  val heldLive by remember(orgId, context.firestore) { context.firestore.observe(licencesQuery(orgId)) }.collectAsState(Live.Loading)
  val mineLive by remember(licensedTo, context.uid, context.firestore) { context.firestore.observe(boughtByYouQuery(context.uid, licensedTo)) }.collectAsState(Live.Loading)
  val held = (heldLive as? Live.Ready)?.value?.map(LicenceRow::from)
  val mine = (mineLive as? Live.Ready)?.value?.map(LicenceRow::from)
  var listingNames by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
  var orgNames by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
  val listingIds = (held.orEmpty() + mine.orEmpty()).map { it.listingId }.filter { it.isNotEmpty() }.distinct()
  LaunchedEffect(listingIds) {
    for (id in listingIds.filter { it !in listingNames }) {
      runCatching { context.firestore.get("$LISTINGS/$id") }.getOrNull()?.let { listingNames = listingNames + (id to (it.string("displayName") ?: id)) }
    }
  }
  val licensedIds = mine.orEmpty().mapNotNull { it.buyerOrgId }.distinct()
  LaunchedEffect(licensedIds) {
    // The workspace names the person already sees in the switcher; a workspace they have left stays its id.
    for (id in licensedIds.filter { it !in orgNames }) {
      runCatching { context.firestore.get("orgs/$id") }.getOrNull()?.string("name")?.let { orgNames = orgNames + (id to it) }
    }
  }
  val now = remember(held?.size, mine?.size) { nowMillis() }
  @Composable
  fun row(licence: LicenceRow, detail: String) = AglynListItem(
    title = listingNames[licence.listingId] ?: licence.listingId,
    supporting = listOfNotNull(detail, "Paid " + dollars(licence.paidCents.toDouble()), licence.createdAt?.let { relativeTime(it.epochMillis, now) }).joinToString(" · "),
    icon = AglynIcons.named("receipt"),
    onClick = { context.navigate(MARKETPLACE_LISTING_SCREEN, mapOf("listing" to licence.listingId)) },
  )
  Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).testTag("licences-list")) {
    ListHeader("Licenses")
    Column(Modifier.padding(horizontal = space(2f)), verticalArrangement = Arrangement.spacedBy(space(2f))) {
      SectionTabs(context, MARKETPLACE_LICENCES_SCREEN)
      NoticeBanner(
        "A marketplace purchase licenses one organization. Any member with install permission can install what this workspace owns — and a second workspace needs its own license.",
        StatusTone.INFO,
      )
      when {
        heldLive is Live.Failed -> EmptyState("Could not load licenses", body = "This workspace’s licenses could not be loaded. Check the connection and try again.", icon = AglynIcons.named("error"), tone = EmptyTone.ERROR)
        held == null -> SkeletonList(rows = 3)
        held.isEmpty() -> EmptyState("This workspace holds no licenses", body = "Anything bought for this workspace shows up here, whoever on the team paid for it.", icon = AglynIcons.named("receipt"))
        else -> SectionCard("This workspace", modifier = Modifier.testTag("licences-held")) {
          Text("Installable by any member with install permission, whoever on the team bought it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
          held.forEach { licence -> row(licence, "Bought by " + boughtByLabel(licence, context.uid)) }
        }
      }
      when {
        mineLive is Live.Failed -> EmptyState("Could not load your purchases", body = "Your purchases could not be loaded. Check the connection and try again.", icon = AglynIcons.named("error"), tone = EmptyTone.ERROR)
        mine == null -> SkeletonList(rows = 3)
        mine.isEmpty() && licensedTo == null -> EmptyState("You have not bought anything yet", body = "Your own marketplace receipts appear here, across every workspace you belong to.", icon = AglynIcons.named("receipt"))
        else -> SectionCard("Bought by you", modifier = Modifier.testTag("licences-mine")) {
          Text("Your own receipts, and which workspace each license landed in", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
          SelectField(
            "Licensed to",
            listOf(SelectOption(orgId, "This workspace")) +
              orgNames.filterKeys { it != orgId }.entries.sortedBy { it.value.lowercase() }.map { SelectOption(it.key, it.value) } +
              SelectOption(EVERY_WORKSPACE, "Every workspace you belong to"),
            licensedTo,
            { licensedTo = it },
            Modifier.testTag("licences-licensed-to"),
            noneLabel = "Any workspace",
          )
          if (mine.isEmpty()) Text("None of your purchases is licensed there.", color = MaterialTheme.colorScheme.onSurfaceVariant)
          mine.forEach { licence -> row(licence, "Licensed to " + licensedToLabel(licence, orgId, orgNames)) }
        }
      }
    }
  }
}

/** Publish new version (a plugin's) and Edit listing, as the console's listing page offers its owner. */
@Composable
private fun OwnerActions(context: NativePluginContext, listingId: String, plugin: Boolean) {
  val orgId = context.orgId ?: return
  val scope = rememberCoroutineScope()
  val runner = remember(listingId) { ActionRunner(scope, roleHint = "an owner, admin or editor") }
  val api = remember(context.api, orgId) { SellerApi(context.api, orgId) }
  val doc by remember(listingId, context.firestore) { context.firestore.observeDoc("$LISTINGS/$listingId") }.collectAsState(Live.Loading)
  var editing by remember(listingId) { mutableStateOf<SellerListing?>(null) }
  FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
    if (plugin) {
      Button(onClick = { context.navigate("marketplace.publishPlugin", mapOf("listing" to listingId)) }, modifier = Modifier.testTag("listing-publish-version")) { Text("Publish new version") }
    }
    OutlinedButton(
      onClick = { runner.clear(); editing = (doc as? Live.Ready)?.value?.let(SellerListing::from) },
      enabled = doc is Live.Ready,
      modifier = Modifier.testTag("listing-edit"),
    ) { Text("Edit listing") }
  }
  editing?.let { listing -> EditListingDialog(context, listing, runner, api) { editing = null } }
}

/** The console's report dialog, for a listing or a review. */
@Composable
private fun ReportDialog(label: String, noun: String, reviewUid: String?, listingId: String, api: MarketplaceApi, runner: ActionRunner, close: () -> Unit) {
  var reason by remember(reviewUid) { mutableStateOf("") }
  ActionDialog(
    title = "Report $label",
    body = "Tell us what is wrong with this $noun. A staff member reads every report. Reporting again updates your report rather than adding another one.",
    icon = "warning",
    confirmLabel = "Send report",
    confirmEnabled = reason.isNotBlank(),
    busy = runner.busy,
    error = runner.error,
    onDismiss = { runner.error = null; close() },
    onConfirm = { runner.run("Thanks — staff will review this report", onDone = close) { api.report(listingId, reason, reviewUid) } },
  ) {
    OutlinedTextField(reason, { reason = it.take(MAX_REPORT_REASON_LENGTH) }, label = { Text("Reason") }, minLines = 3, modifier = Modifier.fillMaxWidth().testTag("report-reason"))
  }
}
