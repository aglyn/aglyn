package com.aglyn.plugins.workflows

import com.aglyn.contracts.Doc
import com.aglyn.contracts.siteInteractionDocument
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.FirestoreWriter
import com.aglyn.core.createResourceUid
import com.aglyn.core.firestoreNow
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * The writes and route calls the console's Automation page makes, made the
 * same way: creates and duplicates through `/api/hosts/resources` (the quota
 * and the cap), edits, switches and deletes of workflows, actions and webhooks
 * as the console's own merges, test runs and where-used scans through their
 * routes, and the organization's automations through `automations/manage`
 * and `automations/pause`. None of these routes takes an idempotency key.
 */
class AutomationApi(private val api: ConsoleApiClient, private val writer: FirestoreWriter) {
  suspend fun entitlements(hostId: String?, orgId: String?): Entitlements =
    entitlementsOf(api.request(ENTITLEMENTS_ROUTE, query = if (hostId != null) mapOf("hostId" to hostId) else mapOf("orgId" to orgId)))

  // ── Workflows ──

  /** A new workflow through the quota-checked route; its id. */
  suspend fun createWorkflow(hostId: String, fields: Doc): String? =
    ((api.request(HOST_RESOURCES_ROUTE, ApiMethod.POST, createWorkflowBody(hostId, fields)) as? JsonObject)?.get("id") as? JsonPrimitive)?.contentOrNull

  suspend fun saveWorkflow(hostId: String, id: String, fields: Doc) {
    writer.merge("${workflowsPath(hostId)}/$id", fields + ("updatedAt" to firestoreNow()))
  }

  suspend fun deleteWorkflow(hostId: String, id: String) {
    writer.merge("${workflowsPath(hostId)}/$id", mapOf("deletedAt" to firestoreNow()))
  }

  /** The copy's name as the route gave it. */
  suspend fun duplicateWorkflow(hostId: String, sourceId: String, name: String, attemptKey: String): String {
    val body = api.request(HOST_RESOURCES_ROUTE, ApiMethod.POST, duplicateWorkflowBody(hostId, sourceId, name, attemptKey)) as? JsonObject
    return (body?.get("name") as? JsonPrimitive)?.contentOrNull ?: name
  }

  /** What references a workflow; a scan that fails reads as nothing, as the console's does. */
  suspend fun whereUsed(hostId: String, id: String, name: String): WhereUsed = try {
    whereUsedOf(api.request(WHERE_USED_ROUTE, ApiMethod.POST, whereUsedBody(hostId, id, name)))
  } catch (error: CancellationException) {
    throw error
  } catch (error: Throwable) {
    WhereUsed(emptyList(), 0)
  }

  // ── Actions ──

  /**
   * Saves an action: a new one's shell through the route that holds the
   * per-site cap, then the whole stored shape as a merge (frequency caps and
   * conditions written out, so one switched off does not survive the merge).
   */
  suspend fun saveAction(hostId: String, id: String?, candidate: Doc): String {
    val actionId = id ?: createResourceUid()
    if (id == null) {
      try {
        api.request(HOST_RESOURCES_ROUTE, ApiMethod.POST, createActionShellBody(hostId, actionId, (candidate["name"] as? String) ?: "Untitled action"))
      } catch (error: ConsoleApiError) {
        throw IllegalStateException(error.message.ifEmpty { "Could not create the interaction" })
      }
    }
    val now = firestoreNow()
    writer.merge(
      "${actionsPath(hostId)}/$actionId",
      siteInteractionDocument(candidate) + ("updatedAt" to now) + (if (id == null) mapOf("createdAt" to now) else emptyMap()),
    )
    return actionId
  }

  suspend fun setActionEnabled(hostId: String, id: String, enabled: Boolean) {
    writer.merge("${actionsPath(hostId)}/$id", mapOf("enabled" to enabled))
  }

  suspend fun deleteAction(hostId: String, id: String) {
    writer.merge("${actionsPath(hostId)}/$id", mapOf("deletedAt" to firestoreNow()))
  }

  /** A live test run of an action's server steps; what to tell the person. */
  suspend fun testRun(hostId: String, actionId: String): String = try {
    testRunMessage(api.request(ACTION_TEST_RUN_ROUTE, ApiMethod.POST, testRunBody(hostId, actionId)))
  } catch (error: ConsoleApiError) {
    val sent = ((error.body as? JsonObject)?.get("error") as? JsonPrimitive)?.contentOrNull
    throw IllegalStateException(sent ?: if (error.status == 0) error.message else testRunRefusal(error.status))
  }

  // ── Webhooks ──

  suspend fun createWebhook(hostId: String, draft: WebhookDraft) {
    api.request(
      HOST_RESOURCES_ROUTE,
      ApiMethod.POST,
      createWebhookBody(hostId, createResourceUid(), draft.name, draft.direction, draft.url, draft.workflowName, draft.secret),
    )
  }

  suspend fun deleteWebhook(hostId: String, id: String) {
    writer.merge("${webhooksPath(hostId)}/$id", mapOf("deletedAt" to firestoreNow()))
  }

  // ── Org automations ──

  /** Pauses or resumes one org automation on one site. */
  suspend fun pause(hostId: String, automationId: String, paused: Boolean) {
    orgCall { api.request(ORG_AUTOMATIONS_PAUSE_ROUTE, ApiMethod.POST, pauseBody(hostId, automationId, paused)) }
  }

  suspend fun saveOrgAutomation(orgId: String, id: String?, body: Doc) {
    orgCall {
      api.request(
        ORG_AUTOMATIONS_MANAGE_ROUTE,
        ApiMethod.POST,
        manageBody(orgId, if (id == null) "create" else "update", automationId = id, automation = body),
      )
    }
  }

  suspend fun setOrgAutomationEnabled(orgId: String, id: String, enabled: Boolean) {
    orgCall { api.request(ORG_AUTOMATIONS_MANAGE_ROUTE, ApiMethod.POST, manageBody(orgId, "setEnabled", automationId = id, enabled = enabled)) }
  }

  suspend fun deleteOrgAutomation(orgId: String, id: String) {
    orgCall { api.request(ORG_AUTOMATIONS_MANAGE_ROUTE, ApiMethod.POST, manageBody(orgId, "delete", automationId = id)) }
  }

  /** The org routes' refusal: the server's own `error`, or the console's fallback. */
  private suspend fun orgCall(call: suspend () -> Unit) = try {
    call()
  } catch (error: ConsoleApiError) {
    val sent = ((error.body as? JsonObject)?.get("error") as? JsonPrimitive)?.contentOrNull
    throw IllegalStateException(sent ?: if (error.status == 0) error.message else "The request could not be completed")
  }
}
