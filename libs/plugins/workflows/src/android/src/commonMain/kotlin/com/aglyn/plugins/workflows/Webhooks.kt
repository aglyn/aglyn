package com.aglyn.plugins.workflows

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.aglyn.contracts.WEBHOOK_MAX_PER_HOST
import com.aglyn.core.Live
import com.aglyn.core.secureRandomHex
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.MenuAction
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SelectField
import com.aglyn.ui.SelectOption
import com.aglyn.ui.StatusTone
import com.aglyn.ui.rememberCopyToClipboard
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/*
 * A site's webhooks, as the console's Webhooks card keeps them: outbound
 * targets and inbound endpoints, their URL and secret copied to the
 * clipboard, a new one added with a fresh secret, and delete. The console
 * edits, switches and rotates none of them, so neither does this.
 */

/** The site roles that may read and manage webhooks (the rules' own). */
private val WEBHOOK_ROLES = setOf("admin", "editor")

@Composable
fun WebhooksSection(context: NativePluginContext, hostId: String, entitlements: Entitlements?, open: (AutomationTarget) -> Unit) {
  val api = remember(context.api, context.writer) { AutomationApi(context.api, context.writer) }
  val scope = rememberCoroutineScope()
  val copy = rememberCopyToClipboard()
  val host = liveDoc(context, "hosts/$hostId")
  val role = ((host as? Live.Ready)?.value?.data?.get("memberRoles") as? Map<*, *>)?.get(context.uid) as? String
  val allowed = role == null || role in WEBHOOK_ROLES
  val live = liveQuery(context, remember(hostId, allowed) { if (allowed) ceilingQuery(webhooksPath(hostId), WEBHOOK_CEILING) else null })
  val siteBase = hostPublicOrigin((host as? Live.Ready)?.value?.data) ?: ""
  var notice by remember { mutableStateOf<Pair<String, StatusTone>?>(null) }
  var deleting by remember { mutableStateOf<WebhookRow?>(null) }

  SectionList(
    testTag = "webhooks-section",
    live = if (allowed) live else Live.Ready(emptyList()),
    rows = { docs -> visibleWebhooks(windowOf(docs, WEBHOOK_CEILING).rows) },
    key = { it.id },
    emptyText = null,
    header = {
      Intro("Send signed JSON to outside systems from the actions builder, or accept calls that run a workflow. Business plans.")
      if (!allowed) NoticeBanner("Each site’s webhooks are listed for its admins and editors.", StatusTone.INFO)
      AutomationNoticeBanner()
      notice?.let { (message, tone) -> NoticeBanner(message, tone, action = { TextButton(onClick = { notice = null }) { Text("Dismiss") } }) }
    },
    footer = { docs, rows ->
      if (windowOf(docs, WEBHOOK_CEILING).truncated) {
        NoticeBanner("Showing the first $WEBHOOK_CEILING webhook documents on this site, ordered by id. There are more, so a hook may be missing from this list.", StatusTone.INFO)
      }
      if (allowed) {
        AddButton("Add webhook", "add-webhook") {
          when {
            entitlements != null && !entitlements.has("webhooks") -> notice = "Webhooks require a Business plan — see Billing to upgrade" to StatusTone.WARNING
            rows.size >= WEBHOOK_MAX_PER_HOST -> notice = "Webhooks are capped at $WEBHOOK_MAX_PER_HOST per site" to StatusTone.WARNING
            else -> open(AutomationTarget.Webhook)
          }
        }
      }
    },
  ) { hook ->
    AutomationRow(
      title = hook.name,
      caption = hook.caption(siteBase, hostId),
      testTag = "webhook-${hook.id}",
      actions = buildList {
        if (hook.inbound) {
          add(MenuAction("Copy URL", "link") {
            copy(hook.endpoint(siteBase, hostId))
            notice = "Endpoint URL copied — send the secret in x-aglyn-secret" to StatusTone.SUCCESS
          })
        }
        add(MenuAction("Secret", "key") {
          copy(hook.secret)
          notice = "Secret copied" to StatusTone.SUCCESS
        })
        add(MenuAction("Delete", "delete", destructive = true) { deleting = hook })
      },
    )
  }

  deleting?.let { hook ->
    ActionDialog(
      title = "Delete this webhook?",
      body = "\"${hook.name}\" stops ${if (hook.inbound) "accepting calls" else "delivering"} immediately.",
      confirmLabel = "Delete",
      destructive = true,
      icon = "delete",
      dismissLabel = "Cancel",
      onDismiss = { deleting = null },
      onConfirm = {
        deleting = null
        scope.launch {
          try {
            api.deleteWebhook(hostId, hook.id)
          } catch (error: CancellationException) {
            throw error
          } catch (error: Throwable) {
            notice = failureMessage(error) to StatusTone.ERROR
          }
        }
      },
    )
  }
}

/** "Add webhook": a name, which way it goes, its URL or the workflow it runs, and its secret. */
@Composable
fun WebhookEditor(context: NativePluginContext, hostId: String, onDone: (String?) -> Unit) {
  val api = remember(context.api, context.writer) { AutomationApi(context.api, context.writer) }
  val scope = rememberCoroutineScope()
  val workflowsLive = liveQuery(context, remember(hostId) { ceilingQuery(workflowsPath(hostId), EDITOR_OPTION_CEILING) })
  val workflowWindow = windowOf(workflowsLive.docsOrEmpty(), EDITOR_OPTION_CEILING)
  val workflowNames = workflowWindow.rows.filter { it.data["deletedAt"] == null }.mapNotNull { (it.data["name"] as? String)?.ifEmpty { null } }.sorted()
  var draft by remember { mutableStateOf(WebhookDraft(secret = secureRandomHex(24))) }
  var busy by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }
  EditorFrame(
    title = "Add webhook",
    saveLabel = "Save webhook",
    saveEnabled = draft.name.isNotBlank(),
    busy = busy,
    error = error,
    onCancel = { onDone(null) },
    onSave = {
      webhookDraftProblem(draft)?.let {
        error = it
        return@EditorFrame
      }
      busy = true
      error = null
      scope.launch {
        try {
          api.createWebhook(hostId, draft)
          onDone("Webhook saved")
        } catch (caught: CancellationException) {
          throw caught
        } catch (caught: Throwable) {
          error = failureMessage(caught)
        } finally {
          busy = false
        }
      }
    },
    modifier = Modifier.testTag("webhook-editor"),
  ) {
    Field("Name", draft.name, { draft = draft.copy(name = it) }, modifier = Modifier.testTag("webhook-name"))
    SelectField(
      "Direction",
      listOf(SelectOption("outbound", "Outbound — send data to a URL"), SelectOption("inbound", "Inbound — receive data, run a workflow")),
      draft.direction,
      { draft = draft.copy(direction = it) },
      Modifier.fillMaxWidth().testTag("webhook-direction"),
    )
    if (draft.direction == "outbound") {
      Field("Delivery URL", draft.url, { draft = draft.copy(url = it) }, placeholder = "https://example.com/hooks/aglyn")
    } else {
      SelectField(
        "Workflow to run",
        workflowNames.map { SelectOption(it, it) },
        draft.workflowName.ifEmpty { null },
        { draft = draft.copy(workflowName = it) },
        Modifier.fillMaxWidth(),
        supportingText = if (workflowWindow.truncated) {
          "Showing $EDITOR_OPTION_CEILING workflows, ordered by id. This site has more, so one of them is not offered here."
        } else {
          null
        },
      )
    }
    Field(
      "Secret",
      draft.secret,
      {},
      readOnly = true,
      helper = if (draft.direction == "outbound") "Signs deliveries (X-Aglyn-Signature, HMAC-SHA256)" else "Callers send this in the x-aglyn-secret header",
    )
  }
}
