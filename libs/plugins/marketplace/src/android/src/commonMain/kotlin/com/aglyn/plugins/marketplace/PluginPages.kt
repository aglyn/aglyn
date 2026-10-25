package com.aglyn.plugins.marketplace

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.InstallTarget
import com.aglyn.core.ApiMethod
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.Live
import com.aglyn.core.jsonBody
import com.aglyn.pluginhost.ActionRunner
import com.aglyn.pluginhost.LocalSlotParams
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.space
import kotlinx.coroutines.flow.flowOf

/*
 * What the workspace's plugin pages (the console's `[orgSlug]/plugins` and `[orgSlug]/plugins/[pluginRef]`) show of the
 * marketplace, in the slots those pages hand to the plugin that installs: the plugins installed from the marketplace
 * (every site's pins, with a chip where a newer version is on offer), and, on one plugin's page, whether it is current,
 * where it runs (the whole workspace or named sites, each with its version) and the update, install and remove
 * controls the console's `PluginSiteSet` has, then what it may do (capabilities and network). The Apple plugin's
 * PluginPages.swift draws the same.
 */

/** The site list the pages name: the workspace's sites the person belongs to, by the name the console shows. */
fun siteChoices(docs: List<FirestoreDoc>): List<SiteChoice> = docs.map { doc ->
  val name = doc.string("displayName")?.trim().orEmpty()
  val subdomain = doc.string("subdomain")?.trim().orEmpty()
  SiteChoice(doc.id, name.ifEmpty { subdomain.ifEmpty { doc.id } })
}

private fun sitesQuery(uid: String, orgId: String) =
  FirestoreQuery("users/$uid/hostMemberships", filters = listOf(FirestoreFilter("orgId", FilterOp.EQ, orgId)), limit = 100)

private fun pinVersion(doc: FirestoreDoc) = PinVersion(versionText(doc.data["version"]))

@Suppress("UNCHECKED_CAST")
private fun manifestOf(doc: FirestoreDoc?): Map<String, Any?>? = doc?.data?.get("manifest") as? Map<String, Any?>

/* ---- The plugins installed from the marketplace ---- */

/** One listing installed in the workspace: at the workspace level, on some sites, or both (`Installation`). */
data class PluginInstallation(val id: String, val name: String, val version: String?, val siteLabels: List<String>, val orgWide: Boolean, val status: UpdateStatus) {
  val caption: String get() = installedPluginCaption(version, orgWide, siteLabels)
}

/** "Installed from the marketplace": the plugins this workspace runs that came from it (the console's `OrgPluginInstallsCard`). */
@Composable
fun OrgPluginInstallsCard(context: NativePluginContext) {
  val orgId = context.orgId
  val orgInstalls by remember(orgId, context.firestore) {
    if (orgId != null) context.firestore.observe(FirestoreQuery("orgs/$orgId/installs", limit = 100)) else flowOf(Live.Ready(emptyList()))
  }.collectAsState(Live.Loading)
  val sitesLive by remember(orgId, context.firestore) {
    if (orgId != null) context.firestore.observe(sitesQuery(context.uid, orgId)) else flowOf(Live.Ready(emptyList()))
  }.collectAsState(Live.Loading)
  val rows by produceState<List<PluginInstallation>?>(null, orgInstalls, sitesLive) {
    val org = (orgInstalls as? Live.Ready)?.value ?: return@produceState
    val sites = (sitesLive as? Live.Ready)?.value?.let(::siteChoices) ?: if (sitesLive is Live.Failed) emptyList() else return@produceState
    val byListing = linkedMapOf<String, Triple<FirestoreDoc, MutableList<String>, Boolean>>()
    for (doc in org) byListing[doc.id] = Triple(doc, mutableListOf(), true)
    for (site in sites) {
      val pins = runCatching { context.firestore.page(FirestoreQuery("hosts/${site.id}/installs", limit = 100)).docs }.getOrDefault(emptyList())
      for (pin in pins) {
        val existing = byListing[pin.id]
        if (existing != null) existing.second += site.label else byListing[pin.id] = Triple(pin, mutableListOf(site.label), false)
      }
    }
    value = byListing.map { (id, entry) ->
      val listing = runCatching { context.firestore.get("$LISTINGS/$id") }.getOrNull()
      val revocation = runCatching { context.firestore.get("revocations/$id") }.getOrNull()
      val offered = pluginOfferedVersion(versionText(listing?.data?.get("latestApprovedVersion")), Revoked.from(revocation?.data))
      val pin = entry.first
      PluginInstallation(
        id, pin.string("displayName") ?: pin.string("pluginId") ?: id, versionText(pin.data["version"]), entry.second, entry.third,
        pluginUpdateStatus(UpdateComparablePin(pin.data), offered),
      )
    }
  }
  Column(Modifier.fillMaxWidth().testTag("org-plugin-installs"), verticalArrangement = Arrangement.spacedBy(space(1f))) {
    Text("Installed from the marketplace", style = MaterialTheme.typography.titleMedium)
    val list = rows
    when {
      list == null && (orgInstalls is Live.Failed) -> NoticeBanner("The installed plugins could not be loaded.", StatusTone.ERROR)
      list == null -> SkeletonList(rows = 2)
      list.isEmpty() -> NoticeBanner("Nothing installed from the marketplace yet — browse it to add one.", StatusTone.INFO)
      else -> list.forEach { row ->
        AglynListItem(
          title = row.name,
          supporting = row.caption,
          icon = AglynIcons.named("extension"),
          trailing = {
            when (row.status.state) {
              UpdateState.UPDATE_AVAILABLE -> StatusChip("v${row.status.availableVersion} available", StatusTone.INFO)
              UpdateState.UNKNOWN -> StatusChip("Unknown", StatusTone.NEUTRAL)
              else -> Unit
            }
          },
          onClick = { context.navigate("core.plugin", mapOf("pluginId" to row.id)) },
          modifier = Modifier.testTag("installed-${row.id}"),
        )
      }
    }
  }
}

/* ---- One plugin's installs ---- */

private class PendingUpdate(val hostIds: List<String>?, val label: String)

private class PendingRemoval(val scope: InstallTarget, val hostId: String?, val targets: List<UninstallTarget>)

/** A plugin's installation: whether it is current, where it runs and how to change that, and what it may do. */
@Composable
fun PluginInstallationCard(context: NativePluginContext) {
  val listingId = LocalSlotParams.current["pluginId"].orEmpty()
  val scope = rememberCoroutineScope()
  val api = remember(context.api) { MarketplaceApi(context.api) }
  val runner = remember(listingId) { ActionRunner(scope, roleHint = "an owner, admin or editor") }
  val orgId = context.orgId
  val orgPinLive by remember(orgId, listingId, context.firestore) {
    if (orgId != null && listingId.isNotEmpty()) context.firestore.observeDoc("orgs/$orgId/installs/$listingId") else flowOf(Live.Ready(null))
  }.collectAsState(Live.Loading)
  val listing by remember(listingId, context.firestore) {
    if (listingId.isNotEmpty()) context.firestore.observeDoc("$LISTINGS/$listingId") else flowOf(Live.Ready(null))
  }.collectAsState(Live.Loading)
  val revocation by remember(listingId, context.firestore) {
    if (listingId.isNotEmpty()) context.firestore.observeDoc("revocations/$listingId") else flowOf(Live.Ready(null))
  }.collectAsState(Live.Loading)
  val sitesLive by remember(orgId, context.firestore) {
    if (orgId != null) context.firestore.observe(sitesQuery(context.uid, orgId)) else flowOf(Live.Ready(emptyList()))
  }.collectAsState(Live.Loading)
  val sites = (sitesLive as? Live.Ready)?.value?.let(::siteChoices).orEmpty()
  var nonce by remember(listingId) { mutableIntStateOf(0) }
  val hostPins by produceState<Map<String, FirestoreDoc>?>(null, listingId, sites.map { it.id }, nonce, sitesLive is Live.Ready) {
    if (sitesLive !is Live.Ready) return@produceState
    value = sites.mapNotNull { site -> runCatching { context.firestore.get("hosts/${site.id}/installs/$listingId") }.getOrNull()?.let { site.id to it } }.toMap()
  }
  val orgPin = (orgPinLive as? Live.Ready)?.value
  val listingDoc = (listing as? Live.Ready)?.value
  val revocationDoc = (revocation as? Live.Ready)?.value
  var updating by remember { mutableStateOf<PendingUpdate?>(null) }
  var removing by remember { mutableStateOf<PendingRemoval?>(null) }
  val addHostIds = remember(listingId) { mutableStateListOf<String>() }
  val canChange = context.orgRole in INSTALL_ROLES
  val actingHostId = sites.firstOrNull()?.id.orEmpty()

  val pins = hostPins
  if (pins == null || orgPinLive is Live.Loading) {
    SkeletonList(rows = 3)
    return
  }
  val summary = resolveOrgInstallSummary(sites, pins.mapValues { pinVersion(it.value) }, orgPin?.let(::pinVersion))
  val offered = pluginOfferedVersion(versionText(listingDoc?.data?.get("latestApprovedVersion")), Revoked.from(revocationDoc?.data))
  val pin = orgPin ?: sites.firstNotNullOfOrNull { pins[it.id] }
  val status = pluginUpdateStatus(pin?.let { UpdateComparablePin(it.data) }, offered)
  val name = pin?.string("displayName") ?: listingDoc?.string("displayName") ?: "This plugin"
  val pluginId = listingDoc?.string("pluginId") ?: pin?.string("pluginId") ?: (manifestOf(pin)?.get("id") as? String).orEmpty()

  fun viewListing() = context.navigate(MARKETPLACE_LISTING_SCREEN, mapOf("listing" to listingId))

  fun change(block: suspend () -> Unit) = runner.run {
    block()
    nonce += 1
    addHostIds.clear()
  }

  /** Installs (or moves) the pin at each step, one after another, and says how it went (`installPlan`). */
  fun install(steps: List<Pair<InstallTarget, String?>>, updatingPins: Boolean, version: String?) {
    if (steps.isEmpty()) return
    change {
      var installed = 0
      val errors = mutableListOf<String>()
      val warnings = mutableListOf<String>()
      for ((target, hostId) in steps) {
        try {
          val outcome = api.installPlugin(listingId, if (target == InstallTarget.HOST) hostId.orEmpty() else actingHostId, target)
          installed += 1
          outcome.warning?.let { warnings += it }
        } catch (failure: kotlin.coroutines.cancellation.CancellationException) {
          throw failure
        } catch (failure: Throwable) {
          errors += runner.describe(failure)
        }
      }
      val outcome = installPlanOutcome(name, installed, errors, steps.any { it.first == InstallTarget.ORG }, updatingPins, version)
      if (outcome.tone == "error") runner.error = outcome.text else runner.notice = (listOf(outcome.text) + warnings).joinToString(" ")
    }
  }

  Column(Modifier.fillMaxWidth().testTag("plugin-installation"), verticalArrangement = Arrangement.spacedBy(space(2f))) {
    runner.error?.let { NoticeBanner(it, StatusTone.ERROR, action = { TextButton(onClick = runner::clear) { Text("Dismiss") } }) }
    runner.notice?.let { NoticeBanner(it, StatusTone.SUCCESS, action = { TextButton(onClick = runner::clear) { Text("Dismiss") } }) }
    if (!summary.installedAnywhere) {
      NoticeBanner(
        "This plugin is not installed in this organization. Install it from its marketplace listing.",
        StatusTone.INFO,
        action = { TextButton(onClick = ::viewListing) { Text("View listing") } },
      )
      Text("Not installed on any site in this organization.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      return@Column
    }

    // Whether it is current.
    val tone = when (status.state) {
      UpdateState.CURRENT -> StatusTone.SUCCESS
      UpdateState.UPDATE_AVAILABLE -> StatusTone.INFO
      else -> StatusTone.WARNING
    }
    NoticeBanner(
      updateStateLabel(status),
      tone,
      action = if (status.state == UpdateState.UPDATE_AVAILABLE) ({ TextButton(onClick = ::viewListing) { Text("View listing") } }) else null,
    )

    // Where it runs.
    val stale = offered?.let { staleSites(summary.sites, it) }.orEmpty()
    SectionCard("Where it runs") {
      Column(Modifier.fillMaxWidth().padding(space(2f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
        Text(pluginSiteSetSummary(summary, sites.size), style = MaterialTheme.typography.bodyMedium)
        summary.sites.forEach { site ->
          Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
            Text(site.label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, maxLines = 1)
            Text("v${site.version ?: "—"}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (site.shadowed) StatusChip("Overrides org")
          }
          if (site.pinnedBy == InstallTarget.HOST) {
            Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
              if (offered != null && stale.any { it.hostId == site.hostId }) {
                TextButton(onClick = { updating = PendingUpdate(listOf(site.hostId), site.label) }, enabled = canChange && !runner.busy, modifier = Modifier.testTag("update-${site.hostId}")) {
                  Text("Update to v$offered")
                }
              }
              TextButton(
                onClick = { removing = PendingRemoval(InstallTarget.HOST, site.hostId, resolveUninstallTargets(summary, InstallTarget.HOST, site.hostId)) },
                enabled = canChange && !runner.busy,
                modifier = Modifier.testTag("remove-${site.hostId}"),
              ) { Text("Remove") }
            }
          }
        }
        if (offered != null && stale.isNotEmpty()) {
          val all = pluginUpdateAll(summary, stale, offered)
          if (summary.orgWide) NoticeBanner(PLUGIN_ORG_WIDE_UPDATE_NOTE, StatusTone.INFO)
          OutlinedButton(onClick = { updating = PendingUpdate(all.hostIds, all.target) }, enabled = canChange && !runner.busy, modifier = Modifier.testTag("update-all")) { Text(all.label) }
        }
        if (!summary.orgWide && summary.availableHostIds.isNotEmpty()) {
          Text("Add to more sites", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
          summary.availableHostIds.forEach { hostId ->
            Row(verticalAlignment = Alignment.CenterVertically) {
              Checkbox(hostId in addHostIds, { on -> if (on) addHostIds += hostId else addHostIds -= hostId })
              Text(sites.firstOrNull { it.id == hostId }?.label ?: hostId, style = MaterialTheme.typography.bodyMedium)
            }
          }
          OutlinedButton(
            onClick = { install(summary.availableHostIds.filter { it in addHostIds }.map { InstallTarget.HOST to it }, false, null) },
            enabled = canChange && !runner.busy && addHostIds.isNotEmpty(),
            modifier = Modifier.testTag("add-selected"),
          ) { Text("Add to selected") }
        }
        HorizontalDivider()
        if (summary.orgWide) {
          OutlinedButton(
            onClick = {
              val hostIds = sites.map { it.id }
              change {
                for (hostId in hostIds) api.installPlugin(listingId, hostId, InstallTarget.HOST)
                api.uninstall(listingId, actingHostId, InstallTarget.ORG)
                runner.notice = "Installed \"$name\" on ${hostIds.size} site${if (hostIds.size == 1) "" else "s"}"
              }
            },
            enabled = canChange && !runner.busy && sites.isNotEmpty(),
            modifier = Modifier.fillMaxWidth(),
          ) { Text("Split into per-site installs") }
          Text(
            "Pins each site separately so you can update them one at a time. Sites you add later will not get this plugin automatically.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
          TextButton(
            onClick = { removing = PendingRemoval(InstallTarget.ORG, null, resolveUninstallTargets(summary, InstallTarget.ORG)) },
            enabled = canChange && !runner.busy,
            modifier = Modifier.testTag("uninstall-org"),
          ) { Text("Uninstall org-wide") }
        } else {
          OutlinedButton(
            onClick = {
              change {
                val outcome = api.installPlugin(listingId, actingHostId, InstallTarget.ORG)
                for (hostId in summary.hostPinnedIds) api.uninstall(listingId, hostId, InstallTarget.HOST)
                runner.notice = "Installed \"$name\" for the whole organization" + (outcome.warning?.let { " $it" } ?: "")
              }
            },
            enabled = canChange && !runner.busy,
            modifier = Modifier.fillMaxWidth().testTag("install-org"),
          ) { Text("Install for the whole organization") }
        }
        if (!canChange) {
          Text("Installing needs the owner, admin or editor role in the workspace.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
    }

    // Its own settings, where its manifest declares any.
    val manifestJson = pin?.let { com.aglyn.core.jsonValue(it.data["manifest"]) }
    if (manifestSettingsFields(manifestJson) != null) {
      SectionCard("Settings") {
        AglynListItem(
          title = "$name settings",
          supporting = "How it behaves for this workspace",
          icon = AglynIcons.named("settings"),
          trailing = { androidx.compose.material3.Icon(AglynIcons.named("chevron_right"), contentDescription = null) },
          onClick = { context.navigate(MARKETPLACE_PLUGIN_SETTINGS_SCREEN, mapOf("listing" to listingId)) },
          modifier = Modifier.testTag("plugin-settings"),
        )
      }
    }

    // What it may do.
    val manifest = manifestOf(pin)
    val capabilities = (manifest?.get("capabilities") as? List<*>)?.filterIsInstance<String>().orEmpty()
    val network = ((manifest?.get("network") as? List<*>) ?: (manifest?.get("networkHosts") as? List<*>))?.filterIsInstance<String>().orEmpty()
    SectionCard("Permissions & data") {
      Column(Modifier.fillMaxWidth().padding(space(2f)), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
        Text("Capabilities", style = MaterialTheme.typography.titleSmall)
        Text(
          if (capabilities.isEmpty()) "None declared — it cannot reach host data directly." else capabilities.joinToString(", "),
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text("Network allowlist", style = MaterialTheme.typography.titleSmall)
        Text(
          if (network.isEmpty()) "No network origins declared; its CSP blocks outbound requests." else network.joinToString(", "),
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
    }
  }

  updating?.let { pending ->
    UpdateDialog(
      api, listingId, name, offered.orEmpty(), pending.label, pending.hostIds?.size == 1, runner.busy,
      onConfirm = {
        updating = null
        install(pending.hostIds?.map { InstallTarget.HOST to it } ?: listOf(InstallTarget.ORG to null), true, offered)
      },
      onDismiss = { updating = null },
    )
  }
  removing?.let { pending ->
    UninstallImpactDialog(
      context, name, pluginId, pending.scope, pending.targets, runner.busy,
      onConfirm = {
        removing = null
        change {
          api.uninstall(listingId, pending.hostId ?: actingHostId, pending.scope)
          runner.notice = "Removed \"$name\""
        }
      },
      onDismiss = { removing = null },
    )
  }
}

/** "Update to vX?": the version pair, the publisher's changelog and which sites take it. */
@Composable
private fun UpdateDialog(
  api: MarketplaceApi,
  listingId: String,
  name: String,
  latestVersion: String,
  label: String,
  singleSite: Boolean,
  busy: Boolean,
  onConfirm: () -> Unit,
  onDismiss: () -> Unit,
) {
  val prompt = pluginUpdatePrompt(name, latestVersion, label, singleSite)
  val changelog by produceState<Pair<Boolean, String?>>(false to null, listingId, latestVersion) {
    value = true to api.versions(listingId).firstOrNull { it.version == latestVersion }?.changelog
  }
  ActionDialog(
    title = prompt.title,
    confirmLabel = "Update",
    onConfirm = onConfirm,
    onDismiss = onDismiss,
    body = prompt.body,
    busy = busy,
    dismissLabel = "Cancel",
  ) {
    Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
      prompt.others?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
      Text("What's new", style = MaterialTheme.typography.titleSmall)
      Text(
        if (!changelog.first) "Loading the changelog…" else changelog.second ?: "The publisher did not describe this version.",
        style = MaterialTheme.typography.bodyMedium,
      )
      Text(prompt.note, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
  }
}

/** What removing the plugin would break, before it happens (`UninstallImpactDialog`). */
@Composable
private fun UninstallImpactDialog(
  context: NativePluginContext,
  name: String,
  pluginId: String,
  scope: InstallTarget,
  targets: List<UninstallTarget>,
  busy: Boolean,
  onConfirm: () -> Unit,
  onDismiss: () -> Unit,
) {
  var typed by remember { mutableStateOf("") }
  var failed by remember { mutableStateOf(false) }
  val impact by produceState<UninstallImpact?>(null, targets.map { it.hostId }) {
    failed = false
    value = null
    if (pluginId.isEmpty() || targets.none { !it.stillCovered }) return@produceState
    try {
      val answer = context.api.request(
        "/api/hosts/plugin-impact",
        ApiMethod.POST,
        jsonBody("pluginId" to pluginId, "hostIds" to targets.map { it.hostId }, "stillCoveredHostIds" to targets.filter { it.stillCovered }.map { it.hostId }),
      )
      val parsed = uninstallImpactFrom(answer)
      if (parsed == null) failed = true else value = parsed
    } catch (failure: kotlin.coroutines.cancellation.CancellationException) {
      throw failure
    } catch (_: Throwable) {
      failed = true
    }
  }
  val view = uninstallImpactView(name, scope, pluginId, targets, impact, failed)
  ActionDialog(
    title = view.title,
    confirmLabel = view.confirmLabel,
    onConfirm = onConfirm,
    onDismiss = onDismiss,
    body = view.note,
    busy = busy,
    confirmEnabled = !view.scanning && (!view.needsAcknowledgement || typed.trim().uppercase() == UNINSTALL_ACKNOWLEDGEMENT),
    destructive = true,
    dismissLabel = "Cancel",
  ) {
    Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
      if (view.scanning) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
          CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
          Text("Checking what this would break…", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
      view.alerts.forEach { alert ->
        NoticeBanner(alert.text, if (alert.tone == "error") StatusTone.ERROR else if (alert.tone == "warning") StatusTone.WARNING else StatusTone.INFO)
      }
      view.sites.forEach { site ->
        Column {
          Text(site.label, style = MaterialTheme.typography.titleSmall)
          Text(site.pages, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
          Text(site.chips.joinToString(" · "), style = MaterialTheme.typography.bodySmall)
        }
      }
      if (view.needsAcknowledgement) {
        OutlinedTextField(
          typed,
          { typed = it },
          label = { Text("Type $UNINSTALL_ACKNOWLEDGEMENT to confirm") },
          singleLine = true,
          keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
          modifier = Modifier.fillMaxWidth().testTag("uninstall-acknowledgement"),
        )
      }
    }
  }
}

/* ---- A marketplace plugin's settings ---- */

/** The pin the page reads a plugin's manifest off: the workspace's own, else the first site's that holds one. */
suspend fun findListingPin(context: NativePluginContext, listingId: String): FirestoreDoc? {
  val orgId = context.orgId ?: return null
  if (listingId.isEmpty()) return null
  runCatching { context.firestore.get("orgs/$orgId/installs/$listingId") }.getOrNull()?.let { return it }
  val sites = runCatching { context.firestore.page(sitesQuery(context.uid, orgId)).docs }.getOrDefault(emptyList())
  for (site in sites) runCatching { context.firestore.get("hosts/${site.id}/installs/$listingId") }.getOrNull()?.let { return it }
  return null
}

/**
 * A marketplace plugin's workspace settings, drawn from the fields its manifest declares as the built-in plugins' are
 * (`manifestSettingsScreen`): a form saved to `orgs/{org}/pluginSettings/{plugin}`.
 */
@Composable
fun PluginSettingsScreen(context: NativePluginContext, listingId: String) {
  val state by produceState<Pair<Boolean, com.aglyn.screens.ScreenSpec?>>(false to null, listingId) {
    val pin = findListingPin(context, listingId)
    val name = pin?.string("displayName") ?: pin?.string("pluginId") ?: listingId
    val pluginId = pin?.string("pluginId") ?: (manifestOf(pin)?.get("id") as? String) ?: listingId
    val screen = manifestSettingsScreen(pluginId, name, pin?.let { com.aglyn.core.jsonValue(it.data["manifest"]) })
    value = true to screen?.let { com.aglyn.screens.ScreenSpec.parse(it) }
  }
  val (loaded, spec) = state
  when {
    !loaded -> SkeletonList(rows = 4)
    spec == null -> com.aglyn.ui.EmptyState("No settings", body = "This plugin does not declare any settings.", icon = AglynIcons.named("settings"))
    else -> com.aglyn.screens.SpecScreen(spec, context)
  }
}
