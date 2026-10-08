package com.aglyn.plugins.workflows

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.Live
import com.aglyn.pluginhost.NativeParams
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.EmptyState
import com.aglyn.ui.ListPager
import com.aglyn.ui.MenuAction
import com.aglyn.ui.OverflowMenu
import com.aglyn.ui.SectionItem
import com.aglyn.ui.SectionNav
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.WidthClass
import com.aglyn.ui.currentWidthClass
import com.aglyn.ui.space

/*
 * THE AUTOMATION PAGE, natively. With a site picked: its Workflows, Actions
 * and Webhooks, and the organization's own hub one section further. With no
 * site: the organization's hub (its org automations and every site's
 * workflows, actions and webhooks side by side). Sections run down the side
 * on large windows and across the top otherwise; on wide windows a picked
 * row's editor or run history opens beside the list, and on phones on its
 * own screen.
 */

/** What a list opens: an editor, a new webhook, or a run history. */
sealed interface AutomationTarget {
  data class Workflow(val id: String?) : AutomationTarget
  data class Action(val id: String?) : AutomationTarget
  data object Webhook : AutomationTarget
  data class OrgAutomation(val id: String?) : AutomationTarget
  /** [siteScope]: an org automation's runs on this site ("Recent runs on this site"). */
  data class Runs(val targetId: String, val name: String, val siteScope: Boolean) : AutomationTarget
}

const val NEW_ID = "new"

/** The screen and params a target opens on its own. */
fun screenFor(target: AutomationTarget): Pair<String, NativeParams> = when (target) {
  is AutomationTarget.Workflow -> WORKFLOW_SCREEN to mapOf("id" to (target.id ?: NEW_ID))
  is AutomationTarget.Action -> ACTION_SCREEN to mapOf("id" to (target.id ?: NEW_ID))
  AutomationTarget.Webhook -> WEBHOOK_SCREEN to emptyMap()
  is AutomationTarget.OrgAutomation -> ORG_AUTOMATION_SCREEN to mapOf("id" to (target.id ?: NEW_ID))
  is AutomationTarget.Runs -> RUNS_SCREEN to buildMap {
    put("targetId", target.targetId)
    put("name", target.name)
    if (target.siteScope) put("hostScope", "site")
  }
}

/** A section a link from another site's row asks for once the site has switched. */
internal object PendingSection {
  var key: String? = null
}

private val SITE_SECTIONS = listOf(
  SectionItem("workflows", "Workflows", "account_tree"),
  SectionItem("actions", "Actions", "bolt"),
  SectionItem("webhooks", "Webhooks", "webhook"),
  SectionItem("organization", "Organization", "workspaces"),
)

private val ORG_SECTIONS = listOf(
  SectionItem("automations", "Org automations", "workspaces"),
  SectionItem("workflows", "Workflows", "account_tree"),
  SectionItem("actions", "Actions", "bolt"),
  SectionItem("webhooks", "Webhooks", "webhook"),
)

@Composable
fun AutomationScreen(context: NativePluginContext, params: NativeParams) {
  val hostId = context.hostId
  val orgId = context.orgId
  val sections = if (hostId != null) SITE_SECTIONS else ORG_SECTIONS
  var section by remember(hostId) {
    val asked = PendingSection.key ?: params["section"]
    PendingSection.key = null
    mutableStateOf(sections.firstOrNull { it.key == asked }?.key ?: sections.first().key)
  }
  val wide = currentWidthClass() >= WidthClass.EXPANDED
  var target by remember(hostId, section) { mutableStateOf<AutomationTarget?>(null) }
  val entitlements = rememberEntitlements(context, hostId, if (hostId == null) orgId else null)
  fun open(next: AutomationTarget) {
    if (wide) {
      target = next
    } else {
      val (screen, screenParams) = screenFor(next)
      context.navigate(screen, screenParams)
    }
  }
  val selectedId = (target as? AutomationTarget.Workflow)?.id ?: (target as? AutomationTarget.Action)?.id
    ?: (target as? AutomationTarget.OrgAutomation)?.id ?: (target as? AutomationTarget.Runs)?.targetId

  if (orgId == null) {
    EmptyState("Pick a workspace first", body = "Automation belongs to a workspace and its sites.", icon = AglynIcons.named("workspaces"))
    return
  }
  SectionNav(
    sections = sections,
    selected = section,
    onSelect = { section = it },
    sideFrom = WidthClass.LARGE,
    modifier = Modifier.testTag("automation-hub"),
  ) {
    val body: @Composable () -> Unit = {
      when {
        hostId != null && section == "workflows" -> WorkflowsSection(context, hostId, entitlements, ::open, selectedId)
        hostId != null && section == "actions" -> ActionsSection(context, hostId, entitlements, ::open, selectedId)
        hostId != null && section == "webhooks" -> WebhooksSection(context, hostId, entitlements, ::open)
        hostId != null -> OrgHub(context, orgId, null, ::open, selectedId)
        else -> OrgHub(context, orgId, section, ::open, selectedId)
      }
    }
    if (wide) {
      Row(Modifier.fillMaxSize()) {
        Box(Modifier.weight(0.46f).fillMaxHeight()) { body() }
        VerticalDivider()
        Box(Modifier.weight(0.54f).fillMaxHeight().testTag("automation-detail")) {
          val current = target
          if (current == null) {
            EmptyState("Pick one to see it here", body = "Its editor or its run history opens beside the list.", icon = AglynIcons.named("bolt"))
          } else {
            TargetPane(context, current) { message ->
              target = null
              message?.let { AutomationNotice.post(it) }
            }
          }
        }
      }
    } else {
      body()
    }
  }
}

/** A target's editor or history; [onDone] leaves it, with what to tell the list. */
@Composable
fun TargetPane(context: NativePluginContext, target: AutomationTarget, onDone: (String?) -> Unit) {
  val hostId = context.hostId
  val orgId = context.orgId
  when (target) {
    is AutomationTarget.Workflow -> if (hostId != null) WorkflowEditor(context, hostId, target.id, onDone) else NeedsSite()
    is AutomationTarget.Action -> if (hostId != null) ActionEditor(context, hostId, target.id, onDone) else NeedsSite()
    AutomationTarget.Webhook -> if (hostId != null) WebhookEditor(context, hostId, onDone) else NeedsSite()
    is AutomationTarget.OrgAutomation -> if (orgId != null) OrgAutomationEditor(context, orgId, target.id, onDone) else NeedsSite()
    is AutomationTarget.Runs -> if (hostId != null) RunHistory(context, hostId, target.targetId, target.name, target.siteScope) else NeedsSite()
  }
}

@Composable
private fun NeedsSite() = EmptyState("Pick a site first", body = "This page shows one site's data.", icon = AglynIcons.named("public"))

/** A target opened on its own screen: done goes back to the list, leaving its notice there. */
@Composable
fun StandaloneTarget(context: NativePluginContext, target: AutomationTarget) {
  TargetPane(context, target) { message ->
    message?.let { AutomationNotice.post(it) }
    context.back()
  }
}

// ── List parts ────────────────────────────────────────────────────────────

/**
 * A section's list: what sits above it, its rows a page at a time, and what
 * sits below. Loading shows skeleton rows; a failed read says so.
 */
@Composable
fun <T> SectionList(
  testTag: String,
  live: Live<List<FirestoreDoc>>,
  rows: (List<FirestoreDoc>) -> List<T>,
  key: (T) -> String,
  emptyText: String?,
  header: @Composable ColumnScope.() -> Unit,
  footer: @Composable ColumnScope.(docs: List<FirestoreDoc>, rows: List<T>) -> Unit,
  failedText: String = "Could not load this list",
  row: @Composable (T) -> Unit,
) {
  var page by remember { mutableStateOf(0) }
  var pageSize by remember { mutableStateOf(PAGE_SIZES.first()) }
  val docs = (live as? Live.Ready)?.value ?: emptyList()
  val all = remember(docs) { rows(docs) }
  val shown = all.drop(page * pageSize).take(pageSize)
  LazyColumn(Modifier.fillMaxSize().testTag(testTag)) {
    item {
      Column(Modifier.fillMaxWidth().padding(horizontal = space(2f), vertical = space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
        header()
      }
    }
    when (live) {
      Live.Loading -> item { SkeletonList(rows = 4) }
      is Live.Failed -> item {
        EmptyState(failedText, body = failureMessage(live.error), icon = AglynIcons.named("error"), modifier = Modifier.padding(vertical = space(2f)))
      }
      is Live.Ready -> {
        if (all.isEmpty() && emptyText != null) {
          item { Caption(emptyText, Modifier.padding(horizontal = space(2f), vertical = space(1f)).testTag("$testTag-empty")) }
        }
        items(shown, key = key) { row(it) }
        if (all.isNotEmpty()) {
          item {
            ListPager(
              page = page,
              pageSize = pageSize,
              rowCount = shown.size,
              count = all.size,
              onPage = { page = it },
              onPageSize = { pageSize = it; page = 0 },
              modifier = Modifier.padding(horizontal = space(1f)),
            )
          }
        }
      }
    }
    item {
      Column(Modifier.fillMaxWidth().padding(horizontal = space(2f), vertical = space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
        footer(docs, all)
      }
    }
  }
}

/** A row of an automation list: its name, its caption lines, a leading control, and its actions behind "more". */
@Composable
fun AutomationRow(
  title: String,
  caption: String,
  testTag: String,
  actions: List<MenuAction>,
  modifier: Modifier = Modifier,
  selected: Boolean = false,
  warning: String? = null,
  extra: String? = null,
  leading: (@Composable () -> Unit)? = null,
  badge: (@Composable () -> Unit)? = null,
  below: (@Composable () -> Unit)? = null,
  onClick: (() -> Unit)? = null,
) {
  Column(modifier.testTag(testTag)) {
    ListItem(
      modifier = if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier,
      leadingContent = leading,
      headlineContent = { Text(title.ifEmpty { "Untitled" }, maxLines = 2, overflow = TextOverflow.Ellipsis) },
      supportingContent = {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
          Text(caption, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
          extra?.let { Text(it, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall) }
          warning?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = com.aglyn.ui.LocalAglynPalette.current.warning.text) }
          below?.invoke()
        }
      },
      trailingContent = {
        Row(verticalAlignment = Alignment.CenterVertically) {
          badge?.invoke()
          if (actions.isNotEmpty()) OverflowMenu(actions, contentDescription = "Actions for ${title.ifEmpty { "this row" }}")
        }
      },
      colors = ListItemDefaults.colors(containerColor = if (selected) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent),
    )
    HorizontalDivider(Modifier.padding(start = space(2f)))
  }
}

/** A list's add button. */
@Composable
fun AddButton(label: String, testTag: String, enabled: Boolean = true, onClick: () -> Unit) {
  Button(onClick = onClick, enabled = enabled, modifier = Modifier.testTag(testTag)) {
    Icon(AglynIcons.named("add"), contentDescription = null, Modifier.size(18.dp))
    Text(label, Modifier.padding(start = space(1f)))
  }
}

/** A section's short description, above its list. */
@Composable
fun Intro(text: String) {
  Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
}
