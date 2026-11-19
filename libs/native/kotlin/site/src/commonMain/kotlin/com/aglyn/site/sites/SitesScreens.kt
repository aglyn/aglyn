package com.aglyn.site.sites

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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.SuggestionChip
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import com.aglyn.core.HostStatus
import com.aglyn.core.HostStatusKind
import com.aglyn.core.Live
import com.aglyn.core.SiteBrandFiles
import com.aglyn.core.SiteStarterMode
import com.aglyn.core.SiteStarterPickBlock
import com.aglyn.core.SiteStarterSearch
import com.aglyn.core.SiteStarterSummary
import com.aglyn.core.SiteStyles
import com.aglyn.core.mediaPreviewUrl
import com.aglyn.core.nowMillis
import com.aglyn.core.relativeTime
import com.aglyn.core.releaseFlagOn
import com.aglyn.core.siteAddress
import com.aglyn.core.siteCreateWebUrl
import com.aglyn.core.siteListAddress
import com.aglyn.core.siteStarterPickBlock
import com.aglyn.core.siteStarterPickNote
import com.aglyn.pluginhost.ActionRunner
import com.aglyn.pluginhost.LocalStarterPickerZone
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.pluginhost.SlotWidgets
import com.aglyn.pluginhost.StarterPickerZone
import com.aglyn.site.SiteAreas
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListDetail
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.DetailRow
import com.aglyn.ui.EmptyState
import com.aglyn.ui.EmptyTone
import com.aglyn.ui.ImageFileField
import com.aglyn.ui.ImageFileGround
import com.aglyn.ui.ListHeader
import com.aglyn.ui.LoadContent
import com.aglyn.ui.LoadMoreEffect
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OptionCardItem
import com.aglyn.ui.OptionCardList
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.PanelSheet
import com.aglyn.ui.PickedFile
import com.aglyn.ui.RefreshableBox
import com.aglyn.ui.RemoteImage
import com.aglyn.ui.SearchField
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SelectionPlaceholder
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.controlShape
import com.aglyn.ui.space
import kotlinx.coroutines.delay

const val SITE_SITES_SCREEN = "site.sites"
const val SITE_SITE_SCREEN = "site.site"

fun hostStatusTone(kind: HostStatusKind): StatusTone = when (kind) {
  HostStatusKind.LIVE -> StatusTone.SUCCESS
  HostStatusKind.DRAFT -> StatusTone.NEUTRAL
  HostStatusKind.PREVIEW -> StatusTone.NEUTRAL
  HostStatusKind.MAINTENANCE -> StatusTone.WARNING
  HostStatusKind.SUSPENDED -> StatusTone.ERROR
}

/** A site's document, live, for its status pill and addresses. */
@Composable
private fun hostDoc(context: NativePluginContext, hostId: String): Live<com.aglyn.core.FirestoreDoc?> {
  val live by remember(hostId, context.firestore) { context.firestore.observeDoc("hosts/$hostId") }.collectAsState(Live.Loading)
  return live
}

/**
 * The workspace's sites, the picked one beside the list on wide windows:
 * search, the custom-domain filter, create a site, and open or switch to
 * one, with its status and addresses.
 */
@Composable
fun SitesScreen(context: NativePluginContext, initialSiteId: String? = null, startNew: Boolean = false) {
  val orgId = context.orgId ?: run {
    EmptyState("Pick a workspace first", icon = AglynIcons.named("workspaces"))
    return
  }
  val scope = rememberCoroutineScope()
  val model = remember(orgId, context.uid) { SitesListModel(context.uid, orgId, context.firestore, scope) }
  LaunchedEffect(model) { model.reload() }
  val canCreate = com.aglyn.pluginhost.rememberMemberPermissions(context).can("hosts.create")
  // `6 of 10 sites · Pro plan` beside Create site (the console's AGL-2166 readout): the plan and its cap from the
  // entitlements route, the count from the workspace's sites once the list has answered.
  val allowancePlan by produceState<SiteAllowancePlan?>(null, orgId) {
    value = runCatching { context.api.request("/api/orgs/entitlements", query = mapOf("orgId" to orgId)) as? kotlinx.serialization.json.JsonObject }
      .getOrNull()?.let(SiteAllowancePlan::of)
  }
  val workspaceSites = com.aglyn.pluginhost.rememberWorkspaceSites(context)
  val allowance = describeSiteAllowance(
    used = (workspaceSites as? Live.Ready)?.value?.size ?: 0,
    limit = allowancePlan?.hostLimit,
    planLabel = allowancePlan?.planLabel,
    ready = allowancePlan != null && workspaceSites is Live.Ready,
  )
  // Opened from Create new: the new-site form comes up at once (for those who may make one).
  var creating by remember { mutableStateOf(startNew && canCreate) }
  // The workspace's pinned sites, in the order pinned (`users/{uid}.pinnedHosts`, AGL-4005), live from the account.
  val prefs = context.accountPrefs
  val prefState = prefs?.state?.collectAsState()
  val pinned = prefState?.value?.pinnedHosts(orgId).orEmpty()
  val pinsFull = prefState?.value?.hostPinsFull(orgId) == true
  LaunchedEffect(model, pinned) { model.watchPinned(pinned) }
  // A pin past the account-wide bound, waiting on "Pinned is full. Replace one?".
  var pinning by remember { mutableStateOf<SiteRow?>(null) }
  var choosingCreated by remember { mutableStateOf(false) }
  val togglePin: (SiteRow) -> Unit = { row ->
    if (prefs?.toggleHostPin(row.id, orgId) == com.aglyn.core.SitePinToggle.FULL) pinning = row
  }

  // One list, as Figma's Sites (Mac 13:3): the title with ☆ and Create site, search and one Filter, the sites; a site
  // opens on its own, with the way back to the list.
  var selected by androidx.compose.runtime.saveable.rememberSaveable(initialSiteId) { mutableStateOf(initialSiteId) }
  val open = selected
  if (open != null) {
    Column(Modifier.fillMaxSize()) {
      com.aglyn.ui.TextButton(onClick = { selected = null }, modifier = Modifier.padding(start = space(1.5f), top = space(0.5f)).testTag("sites-back")) {
        Icon(AglynIcons.named("chevron_left"), contentDescription = null)
        Text("Sites")
      }
      Box(Modifier.weight(1f)) { SiteOverview(context, open) }
    }
  } else {
    val listState = rememberLazyListState()
    LoadMoreEffect(listState, model.hasMore, onLoadMore = model::loadMore)
    com.aglyn.ui.ListScreenScaffold(
      title = "Sites",
      query = model.search,
      onQuery = model::type,
      placeholder = "Search sites",
      tag = "sites",
      primary = com.aglyn.ui.PrimaryAction("add-site", "New site", enabled = canCreate) { creating = true },
      filters = SiteDomainFilter.entries.map { com.aglyn.ui.FilterChoice("Domain", it.name, it.label) },
      picked = mapOf("Domain" to model.domain.name),
      onPick = { model.pick(SiteDomainFilter.valueOf(it.key)) },
      // The console's Created range (`SITE_FILTER_FIELDS`): one condition and one day.
      extras = listOf(
        com.aglyn.ui.FilterExtra(
          com.aglyn.ui.MenuAction("created", if (model.created == null) "Created…" else "Change Created…", icon = "event") { choosingCreated = true },
          active = model.created?.label,
          clear = { model.pickCreated(null) },
        ),
      ),
    ) {
      // The one-time product-updates ask (AGL-3185), where the console puts it: over the Sites list.
      ProductUpdatesAsk(context)
      for (refusal in model.refused) {
        NoticeBanner("That filter was not applied: ${refusal.reason}.", tone = StatusTone.WARNING, modifier = Modifier.padding(horizontal = space(2f)))
      }
      allowance?.let {
        Text(
          it,
          Modifier.fillMaxWidth().padding(horizontal = space(2f)).padding(bottom = space(0.5f)).testTag("sites-allowance"),
          style = MaterialTheme.typography.bodyMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          textAlign = androidx.compose.ui.text.style.TextAlign.End,
        )
      }
      RefreshableBox(model.refreshing, model::refresh) {
        LoadContent(model.rows, onRetry = { model.reload() }, failedTitle = "Could not load sites") { queried ->
          val rows = sitesShown(queried, pinned, model.pinnedRows, model.filtering)
          if (rows.isEmpty()) {
            EmptyState(
              if (!model.filtering) "No sites yet" else "No sites match",
              body = if (!model.filtering) "Create a site to start building." else "Try another search or filter.",
              icon = AglynIcons.named("public"),
            )
          } else {
            LazyColumn(Modifier.fillMaxSize().padding(horizontal = space(1f)).testTag("sites-list"), state = listState) {
              // Opening a site drills into it (the sidebar slides to the site), landing on its Home (P4).
              items(rows, key = { it.id }) { row ->
                SiteListRow(
                  context, row, false,
                  pin = if (prefs == null) null else SitePin(row.id in pinned, pinsFull) { togglePin(row) },
                ) { context.selectSite(row.id); context.navigate("shell.home") }
              }
              if (model.hasMore) item { SkeletonList(rows = 2) }
            }
          }
        }
      }
    }
  }

  if (creating) CreateSiteDialog(context, orgId) { creating = false }
  pinning?.let { pending ->
    SitePinnedFullDialog(
      pending = pending,
      pins = pinned.map { id -> id to siteName(id, model, pending) },
      onReplace = { replacing ->
        prefs?.replaceHostPin(replacing, pending.id, orgId)
        pinning = null
      },
      onDismiss = { pinning = null },
    )
  }
  if (choosingCreated) {
    SiteCreatedFilterDialog(model.created, onApply = { model.pickCreated(it); choosingCreated = false }, onDismiss = { choosingCreated = false })
  }
}

/** A site's name for the replace question: the list's row, else its own row, else a site gone from reach. */
private fun siteName(id: String, model: SitesListModel, pending: SiteRow): String =
  ((model.rows as? com.aglyn.ui.Load.Ready)?.value.orEmpty() + model.pinnedRows + pending).firstOrNull { it.id == id }?.name
    ?: "A site you can no longer open"

/** The pin on a site row (the console's pin on a site card): whether it is pinned, whether pins are full, and the toggle. */
internal class SitePin(val pinned: Boolean, val full: Boolean, val toggle: () -> Unit)

/**
 * "Pinned is full. Replace one?" for a site (the console's `PinnedFullDialog`, kind site): asked only at the account-wide
 * bound. Each pin of the workspace has its Replace; Keep my pins changes nothing.
 */
@Composable
private fun SitePinnedFullDialog(pending: SiteRow, pins: List<Pair<String, String>>, onReplace: (String) -> Unit, onDismiss: () -> Unit) {
  androidx.compose.material3.AlertDialog(
    onDismissRequest = onDismiss,
    modifier = Modifier.testTag("site-pins-full"),
    title = { Text("Pinned is full. Replace one?") },
    text = {
      Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
        Text(
          "You can pin up to ${com.aglyn.contracts.Contracts.pinnedHostsMax} sites. Pick the one ${pending.name} takes the place of.",
          style = MaterialTheme.typography.bodyMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Column(Modifier.verticalScroll(rememberScrollState())) {
          for ((id, name) in pins) {
            Row(verticalAlignment = Alignment.CenterVertically) {
              Text(name, Modifier.weight(1f), maxLines = 1)
              com.aglyn.ui.TextButton(onClick = { onReplace(id) }, modifier = Modifier.testTag("replace-site-pin-$id").semantics { contentDescription = "Replace $name" }) {
                Text("Replace")
              }
            }
          }
        }
      }
    },
    confirmButton = { com.aglyn.ui.TextButton(onClick = onDismiss, modifier = Modifier.testTag("site-pins-keep")) { Text("Keep my pins") } },
  )
}

/** The Created filter (the console's Filters panel on the Sites cards): a condition the declaration offers and a day. */
@Composable
private fun SiteCreatedFilterDialog(current: SiteCreatedFilter?, onApply: (SiteCreatedFilter) -> Unit, onDismiss: () -> Unit) {
  var op by remember { mutableStateOf(current?.op ?: SiteCreatedFilter.operators.firstOrNull() ?: "is") }
  var day by remember { mutableStateOf(current?.day.orEmpty()) }
  ActionDialog(
    title = com.aglyn.contracts.Contracts.siteFilterHeaders["createdAt"] ?: "Created",
    confirmLabel = "Apply",
    onConfirm = { onApply(SiteCreatedFilter(op, day)) },
    onDismiss = onDismiss,
    confirmEnabled = Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(day),
    modifier = Modifier.testTag("sites-created-dialog"),
  ) {
    Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
      com.aglyn.ui.SelectField(
        "Condition",
        SiteCreatedFilter.operators.map { com.aglyn.ui.SelectOption(it, com.aglyn.pluginhost.listFilterOperatorLabel(it)) },
        op,
        { picked -> picked?.let { op = it } },
        modifier = Modifier.testTag("sites-created-op"),
      )
      com.aglyn.ui.FieldEditor(com.aglyn.ui.FieldSpec("createdDay", "Date", com.aglyn.ui.FieldKind.DATE), day, { day = it })
    }
  }
}

@Composable
private fun SiteListRow(context: NativePluginContext, row: SiteRow, selected: Boolean, pin: SitePin? = null, onClick: () -> Unit) {
  val host = hostDoc(context, row.id)
  val status = (host as? Live.Ready)?.value?.let { HostStatus.describe(it.data, nowMillis()) }
  // The site's favicon, as the console's Sites list shows it (`HostIcon`): the host's own `seo.favicon`, else the
  // membership row's copy of it; the globe while there is none.
  val favicon = siteFavicon((host as? Live.Ready)?.value) ?: row.favicon
  // Figma List/Site row (11:370): the favicon, the name over its address (its custom domain once mirrored, as the console
  // shows it), and the status.
  com.aglyn.ui.ScaffoldListRow(
    title = row.name,
    detail = listOfNotNull(siteListAddress((host as? Live.Ready)?.value?.string("cname")?.trim()?.ifEmpty { null } ?: row.cname, row.subdomain), row.role?.replaceFirstChar { it.uppercase() }).joinToString(" · "),
    kind = com.aglyn.ui.ScaffoldRowKind.SITE,
    selected = selected,
    leading = { com.aglyn.ui.ScaffoldRowTile("public", mediaPreviewUrl(favicon, context.api.origin, row.id, 160)) },
    status = {
      Row(horizontalArrangement = Arrangement.spacedBy(space(0.5f)), verticalAlignment = Alignment.CenterVertically) {
        if (row.id == context.hostId) StatusChip("Current", StatusTone.INFO)
        status?.let { StatusChip(it.label, hostStatusTone(it.kind)) }
        // The pin beside the status, as on the console's site card (`mdiPin` / `mdiPinOutline`): a pinned site leads.
        pin?.let { SitePinButton(row.name, it, Modifier.testTag("site-pin-${row.id}")) }
      }
    },
    onClick = onClick,
    modifier = Modifier.testTag("site-${row.id}"),
  )
}

@Composable
private fun SitePinButton(name: String, pin: SitePin, modifier: Modifier = Modifier) {
  androidx.compose.material3.IconButton(
    onClick = pin.toggle,
    modifier = modifier.size(32.dp).semantics {
      contentDescription = if (pin.pinned) "Unpin $name" else "Pin $name"
      stateDescription = if (pin.pinned) "Pinned" else if (pin.full) "Pinned is full: pick one to replace" else "Not pinned"
    },
  ) {
    Icon(
      AglynIcons.named(if (pin.pinned) "push_pin" else "keep"),
      contentDescription = null,
      modifier = Modifier.size(18.dp),
      tint = if (pin.pinned) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
    )
  }
}

/** A host document's favicon (`seo.favicon`), as the console stores it: a reference, a CDN path or an address. */
internal fun siteFavicon(doc: com.aglyn.core.FirestoreDoc?): String? =
  ((doc?.data?.get("seo") as? Map<*, *>)?.get("favicon") as? String)?.ifBlank { null }

/**
 * One site: its status, addresses and what it holds, with the switch that
 * makes it the site every screen shows, and its areas.
 */
@Composable
fun SiteOverview(context: NativePluginContext, hostId: String) {
  val live = hostDoc(context, hostId)
  val uri = LocalUriHandler.current
  val visitScope = rememberCoroutineScope()
  when (live) {
    Live.Loading -> SkeletonList(rows = 6, modifier = Modifier.padding(space(2f)))
    is Live.Failed -> EmptyState("Could not load this site", body = "You may no longer have access to it.", icon = AglynIcons.named("error"), tone = EmptyTone.ERROR)
    is Live.Ready -> {
      val doc = live.value ?: return EmptyState("This site is gone", icon = AglynIcons.named("public"))
      val now = remember(doc) { nowMillis() }
      val status = HostStatus.describe(doc.data, now)
      val name = doc.string("displayName")?.ifBlank { null } ?: doc.string("subdomain") ?: hostId
      val platform = siteAddress(doc.string("subdomain"))
      val custom = doc.string("cname")?.ifBlank { null }
      val favicon = siteFavicon(doc)
      val current = hostId == context.hostId
      Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(space(2f)).testTag("site-detail"),
        verticalArrangement = Arrangement.spacedBy(space(2f)),
      ) {
        SectionCard(null) {
          Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1.5f))) {
            RemoteImage(mediaPreviewUrl(favicon, context.api.origin, hostId, 160), null, Modifier.size(48.dp).clip(RoundedCornerShape(12.dp)), icon = "public")
            Column(Modifier.weight(1f)) {
              Text(name, Modifier.semantics { heading() }, style = MaterialTheme.typography.headlineSmall)
              Text(custom ?: platform ?: "", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            StatusChip(status.label, hostStatusTone(status.kind))
          }
          Text(status.detail, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
          FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
            // Opening a site drills into it (P4): its own sidebar, landing on its Home.
            if (!current) {
              Button(onClick = { context.selectSite(hostId); context.navigate("shell.home") }, modifier = Modifier.testTag("site-switch")) {
                Text("Open site")
              }
            }
            // The site as the console the app talks to reaches it: a local console opens the local tenant.
            (custom ?: platform)?.let { com.aglyn.core.SiteLiveUrl.home(doc.string("subdomain"), custom, context.api.origin) }?.let { link ->
              OutlinedButton(
                onClick = {
                  // In preview or maintenance the site is entered as the team (the console's `SiteVisitButton`, AGL-4086).
                  if (!com.aglyn.core.SiteVisit.entersAsTeam(doc.data)) runCatching { uri.openUri(link) }
                  else visitScope.launch { runCatching { uri.openUri(com.aglyn.core.SiteVisit.url(true, hostId, link, context.api)) } }
                },
                modifier = Modifier.testTag("site-visit"),
              ) {
                Icon(AglynIcons.named("open_in_new"), contentDescription = null)
                Text("Visit site", Modifier.padding(start = space(1f)))
              }
            }
          }
        }
        SectionCard("Addresses") {
          DetailRow("Platform address", platform)
          DetailRow("Custom domain", custom, placeholder = "None connected")
          DetailRow("Published pages", status.publishedPages.toString())
          DetailRow("Created", (doc.data["createdAt"] as? com.aglyn.core.FirestoreTimestamp)?.let { relativeTime(it.epochMillis, now) })
        }
        if (current) {
          SectionCard("Manage") {
            SiteAreas.entries.forEachIndexed { index, area ->
              if (index > 0) HorizontalDivider()
              AglynListItem(
                title = area.title,
                supporting = area.supporting,
                icon = AglynIcons.named(area.icon),
                trailing = { Icon(AglynIcons.named("chevron_right"), contentDescription = null) },
                onClick = { context.navigate(area.screen) },
                modifier = Modifier.testTag("site-area-${area.screen}"),
              )
            }
          }
        } else {
          NoticeBanner("Open this site to manage its pages, media and setup.", StatusTone.INFO)
        }
      }
    }
  }
}

/**
 * Whether Create site offers the marketplace's starters: a plugin fills the zone, and `release_site_starters` is on for the
 * workspace or the person is staff. The picker's first answer then decides, as the route is the judge.
 */
private suspend fun siteStartersOffered(context: NativePluginContext, orgId: String): Boolean {
  if (context.slotWidgets(StarterPickerZone.SLOT).isEmpty()) return false
  val staff = context.isStaff()
  val org = if (staff) null else runCatching { context.firestore.get("orgs/$orgId")?.data }.getOrNull()
  return releaseFlagOn("release_site_starters", org, orgId, staff)
}

/**
 * Create a site, as the console's Create site: a name, an address the route checks, the addresses it suggests when the one
 * asked for is taken, an optional logo, dark logo and favicon held until the site exists (AGL-4119), and what the site starts
 * from (AGL-4049), which the person must pick: the style, or a starter where the marketplace's are offered to the workspace.
 * Nothing is chosen for them, so Create site stays off until one is. The header and its button stay put while the rest scrolls.
 */
@Composable
private fun CreateSiteDialog(context: NativePluginContext, orgId: String, close: () -> Unit) {
  val scope = rememberCoroutineScope()
  val runner = remember { ActionRunner(scope) }
  var name by remember { mutableStateOf("") }
  var subdomain by remember { mutableStateOf("") }
  var edited by remember { mutableStateOf(false) }
  var suggestions by remember { mutableStateOf(emptyList<String>()) }
  var style by remember { mutableStateOf<String?>(null) }
  var brandFiles by remember { mutableStateOf(emptyMap<String, PickedFile>()) }
  var brandErrors by remember { mutableStateOf(emptyMap<String, String>()) }
  // A site made with a file that did not make it: the sheet stays to say so, once, then opens it.
  var missed by remember { mutableStateOf<Pair<String, String>?>(null) }
  // Whether the marketplace's starters are offered to this workspace, null until it is read; then the picker's own answer,
  // false handing back to the styles, as the console's dialog does for a workspace with nothing to offer.
  val offered by produceState<Boolean?>(null, orgId) { value = siteStartersOffered(context, orgId) }
  var pickerShown by remember { mutableStateOf<Boolean?>(null) }
  var starterMode by remember { mutableStateOf(SiteStarterMode.BASE) }
  var starterSearch by remember { mutableStateOf("") }
  var settledSearch by remember { mutableStateOf("") }
  var pick by remember { mutableStateOf<SiteStarterSummary?>(null) }
  // "Start in preview" (AGL-4086): only the team sees the site until it is made public; off for a starter site, as the
  // console's default (`sitePreviewStartsOn`).
  var startInPreview by remember { mutableStateOf(sitePreviewStartsOn("starter")) }
  val usingStarters = offered == true && pickerShown != false
  val usingStyles = offered == false || pickerShown == false
  LaunchedEffect(starterSearch) {
    delay(300)
    settledSearch = starterSearch
  }
  val uri = LocalUriHandler.current
  val list = rememberLazyListState()
  // A refusal is read where it is: the button stays in view however far the styles have scrolled.
  LaunchedEffect(runner.error) { if (runner.error != null) list.animateScrollToItem(0) }
  val options = remember(context.api.origin) {
    SiteStyles.all.map { OptionCardItem(it.id, it.name, it.blurb, mediaPreviewUrl(it.preview, context.api.origin, null, 480), it.alt) }
  }
  // The site opens as a row of the list does: its own sidebar, on its Home (AGL-4129).
  fun openNewSite(hostId: String) {
    context.selectSite(hostId)
    context.navigate("shell.home")
    close()
  }
  missed?.let { (hostId, notice) ->
    ActionDialog(
      title = "Create a site",
      body = notice,
      icon = "public",
      confirmLabel = "Open site",
      dismissLabel = "Close",
      onConfirm = { openNewSite(hostId) },
      onDismiss = { openNewSite(hostId) },
      modifier = Modifier.testTag("create-site-missed"),
    )
    return
  }
  PanelSheet(
    title = "Create a site",
    onDismiss = { if (!runner.busy) close() },
    closeLabel = "Cancel",
    scroll = false,
    modifier = Modifier.testTag("create-site-sheet"),
    action = {
      Button(
        shape = controlShape(),
        enabled = (if (usingStarters) canCreateSiteFromStarter(name, subdomain, pick) else canCreateSite(name, subdomain, style)) && !runner.busy,
        modifier = Modifier.testTag("create-site-confirm"),
        onClick = {
          val start = if (usingStarters) pick?.let { SiteStart.Starter(it.listingId) } else style?.let { SiteStart.Style(it) }
          if (start == null) return@Button
          runner.run {
            when (val result = createSite(context.api, orgId, name, subdomain, start, startInPreview)) {
              is CreateSiteResult.Created -> {
                // The logo, dark logo and favicon go in now the site has a library. A file that does not make it never
                // costs the site: it is said once, here, before the site opens.
                val outcome = saveSiteBrand(context.api, result.hostId, brandFiles)
                val notice = siteBrandMissedNotice(outcome.missed)
                if (notice != null) missed = result.hostId to notice else openNewSite(result.hostId)
              }
              is CreateSiteResult.Refused -> {
                suggestions = result.suggestions
                runner.error = result.message
              }
              is CreateSiteResult.PickRefused -> {
                // A price still asked keeps the pick, which offers to buy it; anything else clears it, with the reason.
                pick = if (result.refused.keep) pick?.copy(owned = false) else null
                runner.error = result.refused.message
              }
            }
          }
        },
      ) { Text(if (runner.busy) "Creating…" else "Create site") }
    },
  ) {
    Column(Modifier.fillMaxSize()) {
      Box(Modifier.weight(1f)) {
        OptionCardList("Style of site", if (usingStyles) options else emptyList(), style, { style = it }, state = list) {
      runner.error?.let { NoticeBanner(it, StatusTone.ERROR, Modifier.testTag("create-site-error")) }
      OutlinedTextField(
        name,
        { next ->
          name = next.take(80)
          if (!edited) subdomain = suggestSubdomain(next)
        },
        label = { Text("Site name") },
        singleLine = true,
        modifier = Modifier.fillMaxWidth().testTag("site-name"),
      )
      OutlinedTextField(
        subdomain,
        { next ->
          edited = true
          subdomain = next.lowercase().filter { it.isLetterOrDigit() || it == '-' }.take(30)
        },
        label = { Text("Address") },
        suffix = { Text(".${com.aglyn.core.DEFAULT_TENANT_APEX}") },
        supportingText = { Text("3 to 30 letters, numbers or hyphens.") },
        isError = subdomain.isNotEmpty() && !SUBDOMAIN_PATTERN.matches(subdomain),
        singleLine = true,
        modifier = Modifier.fillMaxWidth().testTag("site-subdomain"),
      )
      Text("You can connect your own domain later.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      com.aglyn.ui.SwitchRow(
        "Start in preview", startInPreview, { startInPreview = it },
        supporting = startInPreviewCaption(startInPreview), enabled = !runner.busy, modifier = Modifier.testTag("site-start-in-preview"),
      )
      if (suggestions.isNotEmpty()) {
        Text("Try one of these:", style = MaterialTheme.typography.labelLarge)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
          suggestions.forEach { suggestion ->
            SuggestionChip(onClick = { subdomain = suggestion; edited = true }, label = { Text(suggestion) })
          }
        }
      }
      Column(Modifier.padding(top = space(1f)).testTag("site-brand"), verticalArrangement = Arrangement.spacedBy(space(1f))) {
        Text("Logo and favicon (optional)", Modifier.semantics { heading() }, style = MaterialTheme.typography.titleMedium)
        // All three optional, none ever in the way of Create site; what a route would refuse is said on the field.
        SiteBrandFiles.slots.forEach { spec ->
          ImageFileField(
            label = spec.label,
            file = brandFiles[spec.slot],
            ground = when (spec.slot) {
              "logo" -> ImageFileGround.LIGHT
              "logoDark" -> ImageFileGround.DARK
              else -> null
            },
            helper = if (spec.slot == "favicon") "Leave this blank to use your logo." else null,
            error = brandErrors[spec.slot],
            enabled = !runner.busy,
            onChoose = { file ->
              val refusal = siteBrandFileRefusal(file, spec.slot)
              brandErrors = if (refusal != null) brandErrors + (spec.slot to refusal) else brandErrors - spec.slot
              if (refusal == null) brandFiles = brandFiles + (spec.slot to file)
            },
            onRemove = {
              brandFiles = brandFiles - spec.slot
              brandErrors = brandErrors - spec.slot
            },
            modifier = Modifier.testTag("site-brand-${spec.slot}"),
          )
        }
        Text(SiteBrandFiles.HINT, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      if (usingStarters) {
        // The console's "Choose your starter": its words, the marketplace's starters through the zone a plugin fills, and
        // whichever starters and AI starters it offers. Nothing is picked until a row is.
        Column(Modifier.padding(top = space(1f)), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
          Text(SiteStarterSearch.TITLE, Modifier.semantics { heading() }, style = MaterialTheme.typography.titleMedium)
          val lede = MaterialTheme.typography.bodyMedium
          val quiet = MaterialTheme.colorScheme.onSurfaceVariant
          Text(SiteStarterSearch.LEDE, style = lede, color = quiet)
          starterStillNeeded(pick, starterMode)?.let { Text(it, Modifier.testTag("site-starter-required"), style = lede, color = quiet) }
        }
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().testTag("starter-mode")) {
          listOf(SiteStarterMode.BASE to "Starters", SiteStarterMode.AI to "AI starters").forEachIndexed { index, (mode, label) ->
            SegmentedButton(
              selected = mode == starterMode,
              // Another kind of starter is another list: what was picked in this one is not carried across.
              onClick = { starterMode = mode; pick = null; runner.error = null },
              shape = SegmentedButtonDefaults.itemShape(index, 2),
              icon = {},
              modifier = Modifier.testTag("starter-mode-${mode.wire}"),
            ) { Text(label, maxLines = 1) }
          }
        }
        SearchField(starterSearch, { starterSearch = it }, "Search starters", Modifier.testTag("starter-search"))
        CompositionLocalProvider(
          LocalStarterPickerZone provides StarterPickerZone(
            orgId = orgId,
            mode = starterMode,
            search = settledSearch,
            selected = pick,
            onPick = { pick = it; runner.error = null },
            ready = { pickerShown = it },
          ),
        ) { SlotWidgets(context, StarterPickerZone.SLOT) }
      } else if (usingStyles) {
        Column(Modifier.padding(top = space(1f)), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
          Text("Choose a style", Modifier.semantics { heading() }, style = MaterialTheme.typography.titleMedium)
          val lede = MaterialTheme.typography.bodyMedium
          val quiet = MaterialTheme.colorScheme.onSurfaceVariant
          Text("Your site starts with a home page, a header and a footer in the style you choose. You can change everything later.", style = lede, color = quiet)
          if (style == null) Text("Choose a style to create your site.", Modifier.testTag("site-style-required"), style = lede, color = quiet)
        }
      }
    }
      }
      // What the pick needs next, held at the foot of the sheet so it is beside whichever row was tapped, however long the list.
      if (usingStarters) {
        siteStarterPickNote(pick)?.let { note ->
          HorizontalDivider()
          NoticeBanner(
            note.message,
            if (note.webAction == null && !note.storeLine) StatusTone.SUCCESS else StatusTone.INFO,
            Modifier.padding(space(2f)).testTag("starter-note"),
          ) {
            // A store build's paid pick: the one store line (the owner's decision of 2026-11-19).
            if (note.storeLine) com.aglyn.ui.StoreBillingLine()
            note.webAction?.let { label ->
              Button(
                shape = controlShape(),
                modifier = Modifier.testTag("starter-web"),
                onClick = {
                  // The console's own Create site, on this pick: where it is bought, or where an AI starter's questions are asked.
                  siteCreateWebUrl(context.api.origin, context.orgSlug, pick?.listingId.orEmpty())?.let { address ->
                    close()
                    uri.openUri(address)
                  }
                },
              ) { Text(label) }
            }
          }
        }
      }
    }
  }
}

/** Why Create site is off, in the console's words (`CreateHostDialog`), until a pick it can create from. */
private fun starterStillNeeded(pick: SiteStarterSummary?, mode: SiteStarterMode): String? = when (siteStarterPickBlock(pick)) {
  SiteStarterPickBlock.NONE -> if (mode == SiteStarterMode.BASE) "Choose a starter to create your site." else "Choose an AI starter to continue."
  // A store build (the owner's decision of 2026-11-19) does not ask anyone to buy the starter.
  SiteStarterPickBlock.PURCHASE -> if (!com.aglyn.core.StoreBilling.buying) "This starter is paid, so a site cannot be created from it here." else if (mode == SiteStarterMode.BASE) "Buy this starter to create your site from it." else "Buy this starter to continue with it."
  null -> if (mode == SiteStarterMode.BASE) null else "Continue on the web to answer this starter's questions."
}

/** The picked site's own overview screen. */
@Composable
fun CurrentSiteScreen(context: NativePluginContext, params: Map<String, String>) {
  val hostId = params["site"] ?: context.hostId
  if (hostId == null) {
    EmptyState("Pick a site first", icon = AglynIcons.named("public"))
  } else {
    SiteOverview(context, hostId)
  }
}

