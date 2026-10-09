package com.aglyn.plugins.workflows

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.InputChip
import androidx.compose.material3.InputChipDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.ACTION_MAX_STEPS
import com.aglyn.contracts.MAX_SCOPE_HOSTS
import com.aglyn.contracts.ORG_AUTOMATION_STEP_TYPES
import com.aglyn.contracts.ORG_AUTOMATION_TRIGGER_EVENTS
import com.aglyn.contracts.OrgAutomationRead
import com.aglyn.contracts.hostEventLabel
import com.aglyn.contracts.hostEventPayloadHint
import com.aglyn.contracts.readOrgAutomation
import com.aglyn.contracts.stepLabel
import com.aglyn.contracts.stepRunsAfterWait
import com.aglyn.contracts.str
import com.aglyn.contracts.triggerFilterProblem
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.Live
import com.aglyn.core.OrgAccess
import com.aglyn.core.OrgRole
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.EmptyState
import com.aglyn.ui.MenuAction
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SelectField
import com.aglyn.ui.SelectOption
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusTone
import com.aglyn.ui.SwitchRow
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.space
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/*
 * THE ORGANIZATION'S AUTOMATION HUB (org-automations-card, its editor and
 * org-site-automation-list): automations written once and placed on the
 * sites chosen, switched on and off, paused per site, and every site's own
 * workflows, actions and webhooks listed side by side, each row opening in
 * its own site.
 */

private val ORG_STEP_KINDS = ORG_AUTOMATION_STEP_TYPES.map { SelectOption(it, stepLabel(it)) }

/** The workspace's sites this person holds, by name: the switcher's own read. */
@Composable
fun rememberOrgSites(context: NativePluginContext, orgId: String): Live<List<OrgSite>> {
  val live = liveQuery(
    context,
    remember(context.uid, orgId) {
      FirestoreQuery(
        "users/${context.uid}/hostMemberships",
        filters = listOf(FirestoreFilter("orgId", FilterOp.EQ, orgId)),
        orderBy = listOf(FirestoreOrder("nameLower")),
        limit = 100,
      )
    },
  )
  return when (live) {
    is Live.Ready -> Live.Ready(
      live.value.map { doc ->
        val subdomain = doc.data["subdomain"] as? String ?: ""
        OrgSite(doc.id, (doc.data["displayName"] as? String)?.ifEmpty { null } ?: subdomain.ifEmpty { doc.id }, subdomain)
      },
    )
    is Live.Failed -> live
    Live.Loading -> Live.Loading
  }
}

/** Whether this member may manage the workspace's automations: any role but viewer. */
@Composable
fun rememberOrgCanEdit(context: NativePluginContext, orgId: String): Boolean {
  val member = liveDoc(context, "orgs/$orgId/members/${context.uid}")
  val access = (member as? Live.Ready)?.let { OrgAccess.fromMember(it.value) } ?: return false
  return access.role != null && access.role != OrgRole.VIEWER
}

/**
 * The org hub's body. [section] null stacks every part (a site's
 * "Organization" section); otherwise one part.
 */
@Composable
fun OrgHub(context: NativePluginContext, orgId: String, section: String?, open: (AutomationTarget) -> Unit, selectedId: String?) {
  val sites = rememberOrgSites(context, orgId)
  val canEdit = rememberOrgCanEdit(context, orgId)
  val entitlements = rememberEntitlements(context, null, orgId)
  val siteList = (sites as? Live.Ready)?.value ?: emptyList()
  LazyColumn(Modifier.fillMaxSize().testTag("org-hub")) {
    item {
      Column(Modifier.fillMaxWidth().padding(space(2f)), verticalArrangement = Arrangement.spacedBy(space(2f))) {
        AutomationNoticeBanner()
        if (section == null || section == "automations") {
          OrgAutomationsCard(context, orgId, siteList, canEdit, entitlements, open, selectedId)
        }
        for (kind in SiteListKind.entries) {
          if (section != null && section != kind.key) continue
          if (kind != SiteListKind.WEBHOOKS) {
            RunQuotaLine(context, if (kind == SiteListKind.WORKFLOWS) RunCounter.WORKFLOW_RUNS else RunCounter.ACTION_RUNS, orgId, null, entitlements)
          }
          OrgSiteList(context, kind, sites, canRead = kind != SiteListKind.WEBHOOKS || canEdit)
        }
      }
    }
  }
}

/** "Org automations": every live one, switched, placed, paused per site, edited and deleted. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun OrgAutomationsCard(
  context: NativePluginContext,
  orgId: String,
  sites: List<OrgSite>,
  canEdit: Boolean,
  entitlements: Entitlements?,
  open: (AutomationTarget) -> Unit,
  selectedId: String?,
) {
  val api = remember(context.api, context.writer) { AutomationApi(context.api, context.writer) }
  val scope = rememberCoroutineScope()
  val live = liveQuery(context, remember(orgId) { orgAutomationsQuery(orgId) })
  val docs = (live as? Live.Ready)?.value ?: emptyList()
  val rows = sortedOrgAutomations(docs)
  var notice by remember { mutableStateOf<Pair<String, StatusTone>?>(null) }
  var deleting by remember { mutableStateOf<OrgAutomationRow?>(null) }
  var pauseFor by remember { mutableStateOf<OrgAutomationRow?>(null) }
  var page by remember { mutableStateOf(0) }
  var pageSize by remember { mutableStateOf(PAGE_SIZES.first()) }

  fun call(action: suspend () -> Unit) {
    scope.launch {
      try {
        action()
      } catch (error: CancellationException) {
        throw error
      } catch (error: Throwable) {
        notice = (error.message ?: "The request could not be completed") to StatusTone.WARNING
      }
    }
  }

  SectionCard("Org automations", Modifier.fillMaxWidth().testTag("org-automations")) {
    Intro(
      "Write an automation once and run it on every site you choose. Each run is that site’s own: its email goes from that site, it counts on that site’s action runs, and the site can pause it for itself. Pro plans and up.",
    )
    notice?.let { (message, tone) -> NoticeBanner(message, tone, action = { TextButton(onClick = { notice = null }) { Text("Dismiss") } }) }
    when (live) {
      Live.Loading -> SkeletonList(rows = 2)
      is Live.Failed -> NoticeBanner("Org automations could not be loaded: ${failureMessage(live.error)}", StatusTone.ERROR)
      is Live.Ready -> {
        if (rows.isEmpty()) Caption("No org automations yet.", Modifier.testTag("org-automations-empty"))
        val shown = rows.drop(page * pageSize).take(pageSize)
        for (row in shown) {
          val placed = placedSiteIds(row, sites)
          val pausable = placed.filter { it !in row.pausedHostIds }
          AutomationRow(
            title = row.name,
            caption = row.caption,
            extra = placementLine(row, sites),
            selected = row.id == selectedId,
            testTag = "org-automation-${row.id}",
            onClick = if (canEdit) ({ open(AutomationTarget.OrgAutomation(row.id)) }) else null,
            leading = {
              Switch(
                checked = row.enabled,
                enabled = canEdit,
                onCheckedChange = { on -> call { api.setOrgAutomationEnabled(orgId, row.id, on) } },
                modifier = Modifier.semantics { contentDescription = "Switch ${row.name} on or off" },
              )
            },
            below = if (row.pausedHostIds.isNotEmpty()) {
              {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(space(0.5f))) {
                  for (hostId in row.pausedHostIds) {
                    InputChip(
                      selected = false,
                      onClick = { if (canEdit) call { api.pause(hostId, row.id, false) } },
                      label = { Text("Paused on ${orgSiteName(sites, hostId)}", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                      trailingIcon = if (canEdit) {
                        { Icon(AglynIcons.named("close"), contentDescription = "Resume on ${orgSiteName(sites, hostId)}", Modifier.size(InputChipDefaults.IconSize)) }
                      } else {
                        null
                      },
                      colors = InputChipDefaults.inputChipColors(labelColor = com.aglyn.ui.LocalAglynPalette.current.warning.text),
                    )
                  }
                }
              }
            } else {
              null
            },
            actions = if (canEdit) {
              listOf(
                MenuAction("edit", "Edit", "edit") { open(AutomationTarget.OrgAutomation(row.id)) },
                MenuAction("pause-on", "Pause on…", "pause", enabled = pausable.isNotEmpty()) { pauseFor = row },
                MenuAction("delete", "Delete", "delete", destructive = true) { deleting = row },
              )
            } else {
              emptyList()
            },
          )
        }
        if (rows.isNotEmpty()) {
          com.aglyn.ui.ListPager(page, pageSize, shown.size, { page = it }, { pageSize = it; page = 0 }, count = rows.size)
        }
        if (docs.size > com.aglyn.contracts.ORG_AUTOMATIONS_MAX) {
          NoticeBanner("Showing ${com.aglyn.contracts.ORG_AUTOMATIONS_MAX} org automations, the most an organization holds.", StatusTone.INFO)
        }
      }
    }
    if (canEdit) {
      AddButton("Add org automation", "add-org-automation") {
        if (entitlements != null && !entitlements.has("actions")) {
          notice = "Org automations are built from the actions builder, which requires a Pro plan — see Billing to upgrade" to StatusTone.WARNING
        } else {
          open(AutomationTarget.OrgAutomation(null))
        }
      }
    }
  }

  pauseFor?.let { row ->
    com.aglyn.ui.ChoiceDialog(
      title = "Pause on…",
      options = placedSiteIds(row, sites).filter { it !in row.pausedHostIds }.map { SelectOption(it, "Pause on ${orgSiteName(sites, it)}") },
      onPick = { hostId ->
        pauseFor = null
        call { api.pause(hostId, row.id, true) }
      },
      onDismiss = { pauseFor = null },
    )
  }
  deleting?.let { row ->
    ActionDialog(
      title = "Delete this org automation?",
      body = "\"${row.name}\" stops running on every site it is placed on, and anyone waiting inside it stops too.",
      confirmLabel = "Delete",
      destructive = true,
      icon = "delete",
      dismissLabel = "Cancel",
      onDismiss = { deleting = null },
      onConfirm = {
        deleting = null
        call { api.deleteOrgAutomation(orgId, row.id) }
      },
    )
  }
}

/** One of "Workflows / Actions / Webhooks on every site": the first sites' rows, each opening in its site. */
@Composable
fun OrgSiteList(context: NativePluginContext, kind: SiteListKind, sites: Live<List<OrgSite>>, canRead: Boolean) {
  var expanded by remember { mutableStateOf(false) }
  SectionCard(kind.header, Modifier.fillMaxWidth().testTag("org-list-${kind.key}")) {
    Intro(kind.intro)
    when {
      !canRead -> NoticeBanner("Each site’s ${kind.plural} are listed for its admins and editors.", StatusTone.INFO)
      sites is Live.Loading -> SkeletonList(rows = 2)
      sites is Live.Failed -> NoticeBanner("The workspace's sites could not be loaded.", StatusTone.ERROR)
      sites is Live.Ready && sites.value.isEmpty() -> Caption("This organization has no sites yet.")
      sites is Live.Ready -> {
        val reachable = sites.value.take(ORG_SITE_LIST_MAX_SITES)
        val shown = if (expanded) reachable else reachable.take(ORG_SITE_LIST_OPEN_SITES)
        Row(Modifier.fillMaxWidth().padding(vertical = space(0.5f)), horizontalArrangement = Arrangement.spacedBy(space(1f))) {
          listOf("Name" to 1.4f, "Site" to 1f, (if (kind == SiteListKind.WEBHOOKS) "Direction" else "Trigger") to 1.2f, "Status" to 0.6f).forEach { (label, weight) ->
            Text(label, Modifier.weight(weight), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
          }
        }
        HorizontalDivider()
        for (site in shown) SiteRows(context, kind, site)
        val folded = reachable.size - shown.size
        if (folded > 0) {
          TextButton(onClick = { expanded = true }, modifier = Modifier.testTag("org-list-more")) {
            Text("Show $folded more ${if (folded == 1) "site" else "sites"}")
          }
        }
        if (sites.value.size > ORG_SITE_LIST_MAX_SITES) {
          NoticeBanner("Listing the first $ORG_SITE_LIST_MAX_SITES sites. Open a site’s own Automation for the ${kind.plural} of the rest.", StatusTone.INFO)
        }
      }
    }
  }
}

@Composable
private fun SiteRows(context: NativePluginContext, kind: SiteListKind, site: OrgSite) {
  val live = liveQuery(context, remember(site.id, kind) { ceilingQuery("hosts/${site.id}/${kind.key}", ORG_SITE_LIST_ROWS) })
  val docs = (live as? Live.Ready)?.value ?: return
  val window = windowOf(docs, ORG_SITE_LIST_ROWS)
  fun openSite() {
    PendingSection.key = kind.key
    context.selectSite(site.id)
  }
  for (row in siteListRows(kind, window.rows)) {
    Row(
      Modifier.fillMaxWidth().clickable(onClick = ::openSite).padding(vertical = space(1f)).testTag("org-row-${site.id}-${row.id}"),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(space(1f)),
    ) {
      Text(row.name, Modifier.weight(1.4f), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.primary, maxLines = 2, overflow = TextOverflow.Ellipsis)
      Text(site.name, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
      Text(row.trigger, Modifier.weight(1.2f), style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
      Text(row.status, Modifier.weight(0.6f), style = MaterialTheme.typography.bodySmall)
    }
    HorizontalDivider()
  }
  if (window.truncated) {
    TextButton(onClick = ::openSite) { Text("${site.name} has more than $ORG_SITE_LIST_ROWS — open the site to see them all") }
  }
}

/** The org automation editor ("Add org automation" / "Edit org automation"). */
@Composable
fun OrgAutomationEditor(context: NativePluginContext, orgId: String, id: String?, onDone: (String?) -> Unit) {
  val api = remember(context.api, context.writer) { AutomationApi(context.api, context.writer) }
  val scope = rememberCoroutineScope()
  val stored = liveDoc(context, id?.let { "${orgAutomationsPath(orgId)}/$it" })
  val sites = rememberOrgSites(context, orgId)

  if (id != null && stored is Live.Loading) return SkeletonList(rows = 4)
  if (id != null && stored is Live.Failed) return EmptyState("Could not load this org automation", body = "Check the connection and try again.", icon = AglynIcons.named("error"))
  val seed = (stored as? Live.Ready)?.value
  if (id != null && (seed == null || seed.data["deletedAt"] != null)) return EmptyState("This org automation is gone", icon = AglynIcons.named("workspaces"))

  var draft by remember(id, seed != null) { mutableStateOf(seed?.let { orgAutomationDraftOf(it.data, it.id) } ?: OrgAutomationDraft(id = null)) }
  var busy by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }
  val pickers = rememberOrgPickers(context, orgId, draftPlacement(draft))

  EditorFrame(
    title = if (draft.id != null) "Edit org automation" else "Add org automation",
    saveLabel = if (busy) "Saving…" else "Save org automation",
    saveEnabled = draft.name.isNotBlank(),
    busy = busy,
    error = error,
    onCancel = { onDone(null) },
    onSave = {
      val body = orgAutomationBody(draft)
      val read = readOrgAutomation(body)
      if (read is OrgAutomationRead.Refused) {
        error = read.problem
        return@EditorFrame
      }
      busy = true
      error = null
      scope.launch {
        try {
          api.saveOrgAutomation(orgId, draft.id, body)
          onDone("Org automation saved")
        } catch (caught: CancellationException) {
          throw caught
        } catch (caught: Throwable) {
          error = caught.message ?: "The request could not be completed"
        } finally {
          busy = false
        }
      }
    },
    modifier = Modifier.testTag("org-automation-editor"),
  ) {
    Intro("Runs on every site you place it on, as that site: its email goes from that site, its runs count on that site’s action runs, and the site can pause it for itself.")
    if (pickers.truncated.isNotEmpty()) {
      NoticeBanner(
        "Offering the first $EDITOR_OPTION_CEILING rows, ordered by id, for: ${pickers.truncated.joinToString(", ")}. The organization has more, so a step target may not be listed below.",
        StatusTone.INFO,
      )
    }
    Field("Name", draft.name, { draft = draft.copy(name = it) }, modifier = Modifier.testTag("org-automation-name"))
    SelectField(
      "Trigger event",
      ORG_AUTOMATION_TRIGGER_EVENTS.map { SelectOption(it, hostEventLabel(it)) },
      draft.event,
      { draft = draft.copy(event = it.orEmpty()) },
      Modifier.fillMaxWidth().testTag("org-automation-trigger"),
    )
    val problem = triggerFilterProblem(draft.filter)
    Field("Filter (optional)", draft.filter, { draft = draft.copy(filter = it) }, placeholder = "subscribe", helper = problem ?: hostEventPayloadHint(draft.event), error = problem != null)
    ConditionRowsEditor(draft.conditionRows, draft.combinator, { draft = draft.copy(conditionRows = it) }, { draft = draft.copy(combinator = it) })
    Overline("Runs on")
    ChoiceChipRow(
      options = listOf(ChipOption("org", "Every site"), ChipOption("sites", "Chosen sites")),
      selected = draft.placement,
      onSelect = { draft = draft.copy(placement = it) },
      modifier = Modifier.testTag("org-automation-placement"),
    )
    if (draft.placement == "sites") {
      when (sites) {
        Live.Loading -> Caption("…")
        is Live.Failed -> NoticeBanner("The workspace's sites could not be loaded.", StatusTone.ERROR)
        is Live.Ready -> if (sites.value.isEmpty()) {
          Caption("This organization has no sites yet.")
        } else {
          Column {
            for (site in sites.value) {
              val checked = site.id in draft.siteIds
              Row(
                Modifier.fillMaxWidth().clickable {
                  draft = draft.copy(siteIds = if (checked) draft.siteIds - site.id else draft.siteIds + site.id)
                }.testTag("site-choice-${site.id}"),
                verticalAlignment = Alignment.CenterVertically,
              ) {
                Checkbox(checked = checked, onCheckedChange = null)
                Text(site.name.ifEmpty { site.subdomain.ifEmpty { site.id } }, style = MaterialTheme.typography.bodyLarge)
              }
            }
          }
        }
      }
      if (draft.siteIds.size > MAX_SCOPE_HOSTS) {
        Caption("Choose $MAX_SCOPE_HOSTS sites or fewer, or run it on every site.", color = MaterialTheme.colorScheme.error)
      }
    }
    Overline("Steps (run in order)")
    draft.steps.forEachIndexed { index, step ->
      StepCard(
        step = step,
        index = index,
        kind = step.str("type") ?: "",
        kinds = ORG_STEP_KINDS,
        stepForKind = ::defaultStep,
        pickers = pickers.pickers,
        onChange = { next -> draft = draft.copy(steps = draft.steps.mapIndexed { i, it -> if (i == index) next else it }) },
        onRemove = { draft = draft.copy(steps = draft.steps.filterIndexed { i, _ -> i != index }) },
        replyContext = ReplyContext(draft.event, stepRunsAfterWait(draft.steps, index)),
      )
    }
    OutlinedButton(
      onClick = { draft = draft.copy(steps = draft.steps + defaultStep("sendEmail")) },
      enabled = draft.steps.size < ACTION_MAX_STEPS,
      modifier = Modifier.testTag("add-step"),
    ) {
      Icon(AglynIcons.named("add"), contentDescription = null, Modifier.size(18.dp))
      Text("Add step", Modifier.padding(start = space(0.5f)))
    }
    SwitchRow("Switched on", draft.enabled, { draft = draft.copy(enabled = it) }, modifier = Modifier.testTag("org-automation-enabled"))
  }
}

/** The org editor's pickers: the workspace's datasets, lists and campaigns, those that reach the placement. */
@Composable
fun rememberOrgPickers(context: NativePluginContext, orgId: String, placement: List<String>): SitePickers {
  val datasets = windowOf(liveQuery(context, remember(orgId) { ceilingQuery(datasetsPath(orgId), EDITOR_OPTION_CEILING) }).docsOrEmpty(), EDITOR_OPTION_CEILING)
  val lists = windowOf(liveQuery(context, remember(orgId) { ceilingQuery(listsPath(orgId), EDITOR_OPTION_CEILING) }).docsOrEmpty(), EDITOR_OPTION_CEILING)
  val campaigns = windowOf(liveQuery(context, remember(orgId) { ceilingQuery(campaignsPath(orgId), EDITOR_OPTION_CEILING) }).docsOrEmpty(), EDITOR_OPTION_CEILING)
  val covers = { visibleTo: Any? -> scopeCovers((visibleTo as? List<*>)?.filterIsInstance<String>(), placement) }
  return SitePickers(
    StepPickers(
      datasets = datasetOptions(datasets.rows.filter { covers(it.data["visibleTo"] ?: emptyList<String>()) }),
      lists = listOptions(lists.rows),
      campaigns = campaignOptions(campaigns.rows.filter { covers(it.data["visibleTo"]) }),
    ),
    listOfNotNull(
      if (datasets.truncated) "datasets" else null,
      if (lists.truncated) "audiences" else null,
      if (campaigns.truncated) "campaigns" else null,
    ),
  )
}
