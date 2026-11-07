package com.aglyn.plugins.crm

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.FirestoreDelete
import com.aglyn.core.Live
import com.aglyn.core.ServerTimestamp
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.pluginhost.ScopeSharingChoice
import com.aglyn.pluginhost.rememberWorkspaceSites
import com.aglyn.pluginhost.sharingFromChoice
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.ChoiceRow
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SectionCard
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.space
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull

/*
 * The CRM's default sharing for new records, as the console's DefaultRecordSharingCard has it (AGL-4047): all sites, only
 * the site they came in on, or all sites except some. "All sites except…" is stored as `defaultRecordScope: 'host'` beside
 * `defaultRecordExcept`, so a reader that predates it never shares a new record with a site left out. Saving changes only
 * new records; "Apply to existing records…" asks `crm/sharing` (`default-apply`) to share the ones the workspace has the
 * same way, in passes, and the org document reports the run. The Apple kit's CrmDefaultSharing.swift.
 */

/** A run of "Apply to existing records", as the org document or the route reports it (`readCrmDefaultApplyRun`). */
data class CrmDefaultApplyRun(val status: String, val processed: Int, val changed: Int, val capped: Int, val error: String?) {
  /** The line under the button. */
  val line: String
    get() = when (status) {
      "running" -> "Applying: $processed records checked, $changed changed so far."
      "done" -> "Applied: $processed records checked, $changed changed" +
        (if (capped > 0) ", $capped left as they were because they would reach more than $CRM_DEFAULT_MAX_INCLUDED sites" else "") + "."
      else -> error ?: "Applying stopped."
    }

  companion object {
    fun of(raw: Any?): CrmDefaultApplyRun? {
      val value = raw as? Map<*, *> ?: return null
      val status = (value["status"] as? String).takeIf { it == "done" || it == "failed" } ?: "running"
      fun count(key: String) = (value[key] as? Number)?.toInt() ?: 0
      return CrmDefaultApplyRun(status, count("processed"), count("changed"), count("capped"), value["error"] as? String)
    }

    fun of(json: JsonObject): CrmDefaultApplyRun {
      val stored = (json["status"] as? JsonPrimitive)?.contentOrNull
      fun count(key: String) = (json[key] as? JsonPrimitive)?.intOrNull ?: 0
      return CrmDefaultApplyRun(
        if (stored == "done" || stored == "failed") stored else "running",
        count("processed"), count("changed"), count("capped"), (json["error"] as? JsonPrimitive)?.contentOrNull,
      )
    }
  }
}

@Composable
fun CrmDefaultSharingCard(context: NativePluginContext, scope: CrmScope) {
  val coroutines = rememberCoroutineScope()
  val canManage = scope.canManage
  val storedMode = crmDefaultSharingOf(scope.org) ?: "org"
  val storedExcept = crmDefaultExceptOf(scope.org).orEmpty()
  val sitesLive = rememberWorkspaceSites(context)
  val sites = (sitesLive as? Live.Ready)?.value.orEmpty()
  val sitesReady = sitesLive is Live.Ready
  val siteIds = sites.map { it.id }
  var mode by remember { mutableStateOf(storedMode) }
  var except by remember { mutableStateOf(storedExcept) }
  var busy by remember { mutableStateOf(false) }
  var applying by remember { mutableStateOf(false) }
  var pass by remember { mutableStateOf<CrmDefaultApplyRun?>(null) }
  var confirmApply by remember { mutableStateOf(false) }
  var notice by remember { mutableStateOf<Pair<String, StatusTone>?>(null) }
  LaunchedEffect(storedMode, storedExcept) {
    mode = storedMode
    except = storedExcept
  }

  val exceptOff = when {
    !canManage -> null
    !sitesReady -> "Reading this workspace’s sites…"
    sites.size < 2 -> "This workspace has one site, so there is nothing to leave out."
    sites.size > CRM_DEFAULT_MAX_INCLUDED -> "This works up to $CRM_DEFAULT_MAX_INCLUDED sites, and this workspace has ${sites.size}. Choose another option."
    else -> null
  }
  val problem = if (mode == "allExcept" && sitesReady) sharingFromChoice(ScopeSharingChoice.AllExcept(except), siteIds, null, emptyList()).second else null
  val changed = mode != storedMode || (mode == "allExcept" && except.toSet() != storedExcept.toSet())
  val canSave = canManage && !busy && changed && problem == null && (mode != "allExcept" || exceptOff == null)
  val run = pass ?: CrmDefaultApplyRun.of((scope.org["crm"] as? Map<*, *>)?.get("defaultApplyRun"))
  val applyOff = when {
    storedMode != "allExcept" -> "Choose All sites except… and save it first."
    changed -> "Save the default first."
    applying || run?.status == "running" -> "Applying now."
    else -> null
  }
  val editable = canManage && !busy

  fun save() {
    if (!canSave) return
    val allExcept = mode == "allExcept"
    busy = true
    coroutines.launch {
      try {
        context.writer.merge(
          "orgs/${scope.orgId}",
          mapOf(
            "crm" to mapOf(
              "defaultRecordScope" to if (mode == "org") "org" else "host",
              "defaultRecordExcept" to if (allExcept) except.filter { it in siteIds } else FirestoreDelete,
              "defaultRecordExceptAt" to if (allExcept) ServerTimestamp else FirestoreDelete,
            ),
          ),
        )
        notice = "Default sharing updated" to StatusTone.SUCCESS
      } catch (failure: Throwable) {
        if (failure is kotlinx.coroutines.CancellationException) throw failure
        mode = storedMode
        except = storedExcept
        notice = "The setting could not be saved" to StatusTone.ERROR
      } finally {
        busy = false
      }
    }
  }

  suspend fun call(action: String): JsonObject? {
    val answer = context.api.request(
      "/api/crm/sharing", ApiMethod.POST,
      JsonObject(mapOf("orgId" to JsonPrimitive(scope.orgId), "action" to JsonPrimitive(action))),
    ) as? JsonObject
    (answer?.get("applyRun") as? JsonObject)?.let { pass = CrmDefaultApplyRun.of(it) }
    return answer
  }

  fun apply(action: String) {
    applying = true
    coroutines.launch {
      try {
        var answer = call(action)
        while ((answer?.get("more") as? JsonPrimitive)?.booleanOrNull == true) answer = call("default-apply-continue")
        if (pass?.status == "done") notice = "The default sharing is applied to existing records" to StatusTone.SUCCESS
      } catch (failure: Throwable) {
        if (failure is kotlinx.coroutines.CancellationException) throw failure
        val reason = (((failure as? ConsoleApiError)?.body as? JsonObject)?.get("error") as? JsonPrimitive)?.contentOrNull
        notice = (reason ?: "The sharing could not be saved.") to StatusTone.ERROR
      } finally {
        applying = false
      }
    }
  }

  SectionCard("Default sharing for new records", Modifier.fillMaxWidth().testTag("crm-default-sharing")) {
    Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
      notice?.let { (text, tone) -> NoticeBanner(text, tone) }
      Text("New contacts, companies, deals and tasks are shared with", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
      ChoiceRow("All sites in the organization", mode == "org", { mode = "org" }, Modifier.testTag("crm-default-org"), enabled = editable)
      ChoiceRow(
        "Only the site they came in on", mode == "host", { mode = "host" }, Modifier.testTag("crm-default-host"),
        supporting = "Keeps clients apart, for agencies.", enabled = editable,
      )
      ChoiceRow(
        "All sites except…", mode == "allExcept",
        {
          if (mode != "allExcept" && storedMode != "allExcept") except = emptyList()
          mode = "allExcept"
        },
        Modifier.testTag("crm-default-allExcept"),
        supporting = exceptOff ?: "Every site but the ones you leave out, including sites added later. The site a person came in on always keeps them.",
        enabled = editable && (exceptOff == null || storedMode == "allExcept"),
      )
      if (mode == "allExcept") {
        Text("Sites to leave out", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        val stillIn = siteIds.filter { it !in except }
        for (site in sites) {
          val locked = stillIn.size == 1 && stillIn[0] == site.id
          val enabled = editable && !locked
          Row(
            Modifier.fillMaxWidth()
              .toggleable(value = site.id in except, enabled = enabled, role = Role.Checkbox) { on -> except = if (on) except + site.id else except - site.id }
              .alpha(if (enabled) 1f else 0.5f)
              .testTag("crm-default-site-${site.id}"),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(space(1f)),
          ) {
            Checkbox(site.id in except, onCheckedChange = null, enabled = enabled)
            Column {
              Text(site.name, style = MaterialTheme.typography.bodyLarge)
              if (locked) Text("At least one site has to stay in.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
          }
        }
      }
      problem?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
      Text(
        "Only affects records created from now on. Datasets and media have defaults of their own, on the organization Data and Media pages.",
        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
      Button(onClick = ::save, enabled = canSave, modifier = Modifier.testTag("crm-default-save")) { Text("Save") }
      Text("Records you already have", style = MaterialTheme.typography.titleSmall)
      Text(
        "Saving changes only new records. To share the ones you already have the same way, apply it to them. The site that captured each person keeps them.",
        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
      Row(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalAlignment = Alignment.CenterVertically) {
        OutlinedButton(onClick = { confirmApply = true }, enabled = canManage && applyOff == null, modifier = Modifier.testTag("crm-default-apply")) {
          Text("Apply to existing records…")
        }
        if (run?.status == "failed" && storedMode == "allExcept" && !applying) {
          TextButton(onClick = { apply("default-apply-continue") }, enabled = canManage) { Text("Resume") }
        }
      }
      if (canManage && applyOff != null) Text(applyOff, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      run?.let {
        Text(
          it.line, style = MaterialTheme.typography.bodySmall,
          color = if (it.status == "failed") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
          modifier = Modifier.testTag("crm-default-run"),
        )
      }
    }
  }
  if (confirmApply) {
    val names = sites.associate { it.id to it.name }
    ActionDialog(
      title = "Apply to existing records?",
      confirmLabel = "Apply to existing records",
      onConfirm = {
        confirmApply = false
        apply("default-apply")
      },
      onDismiss = { confirmApply = false },
      body = "Every contact, lead, company, deal, task and logged activity this workspace has is shared with every site except " +
        "${storedExcept.joinToString(", ") { names[it] ?: it }}. The site that captured a person keeps them. Sites left out stop seeing the rest. " +
        "Records shared by hand or by a sharing rule keep those shares.",
    )
  }
}
