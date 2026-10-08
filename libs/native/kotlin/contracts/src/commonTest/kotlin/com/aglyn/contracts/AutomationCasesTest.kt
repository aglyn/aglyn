package com.aglyn.contracts

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals

/** Replays every case in automation-cases.generated.json: the console's own automation rules. */
class AutomationCasesTest {
  private val root = ContractJsonFormat.parseToJsonElement(ContractCaseJson.automationCases).jsonObject
  private val values = root.getValue("values").jsonObject
  private val functions = root.getValue("functions").jsonObject

  private fun cases(name: String): List<Pair<JsonArray, JsonElement>> =
    functions.getValue(name).jsonArray.map { it.jsonObject.getValue("args").jsonArray to it.jsonObject.getValue("result") }

  private fun str(element: JsonElement?): String? = (element as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content

  @Suppress("UNCHECKED_CAST")
  private fun doc(element: JsonElement): Doc = plainOf(element) as Doc

  @Test
  fun everyFunctionIsReplayed() {
    assertEquals(
      setOf(
        "validateHostAction", "validateWorkflowSteps", "readOrgAutomation", "triggerFilterProblem", "siteInteractionDocument",
        "sendEmailReplyIneligibility", "stepRunsAfterWait", "workflowFunctionCalls", "interactionPlaceholders",
        "describeInteractionPlaceholder", "runTriggeredByLabel", "actionRunResult", "actionRunSummary",
        "orgAutomationRunsOnHost", "orgAutomationStopReason",
      ),
      functions.keys,
    )
  }

  @Test
  fun valuesMatch() {
    assertEquals(expected(values.getValue("HOST_ACTION_STEP_LABELS")), comparable(HOST_ACTION_STEP_LABELS))
    assertEquals(
      values.getValue("HOST_ACTION_STEP_LABELS").jsonObject.keys.toList(),
      HOST_ACTION_STEP_LABELS.keys.toList(),
      "the Do picker's order",
    )
    assertEquals(expected(values.getValue("WORKFLOW_ACTION_STEP_TYPES")), WORKFLOW_ACTION_STEP_TYPES)
    assertEquals(expected(values.getValue("CLIENT_ACTION_STEP_TYPES")), CLIENT_ACTION_STEP_TYPES.sorted())
    assertEquals(expected(values.getValue("SITE_EVENT_TYPES")), SITE_EVENT_TYPES)
    assertEquals(expected(values.getValue("ELEMENT_SCOPED_SITE_EVENTS")), ELEMENT_SCOPED_SITE_EVENTS)
    assertEquals(expected(values.getValue("ORG_AUTOMATION_TRIGGER_EVENTS")), ORG_AUTOMATION_TRIGGER_EVENTS)
    assertEquals(expected(values.getValue("ORG_AUTOMATION_STEP_TYPES")), ORG_AUTOMATION_STEP_TYPES)
    assertEquals(expected(values.getValue("SEND_EMAIL_REPLY_INELIGIBLE_REASONS")), comparable(SEND_EMAIL_REPLY_INELIGIBLE_REASONS))
  }

  @Test
  fun validateHostActionCases() = cases("validateHostAction").forEach { (args, result) ->
    assertEquals(str(result), validateHostAction(doc(args[0])), args.toString())
  }

  @Test
  fun validateWorkflowStepsCases() = cases("validateWorkflowSteps").forEach { (args, result) ->
    assertEquals(str(result), validateWorkflowSteps(plainOf(args[0]) as List<*>), args.toString())
  }

  @Test
  fun readOrgAutomationCases() = cases("readOrgAutomation").forEach { (args, result) ->
    val actual = when (val read = readOrgAutomation(plainOf(args[0]))) {
      is OrgAutomationRead.Ok -> mapOf("ok" to true, "value" to read.value)
      is OrgAutomationRead.Refused -> mapOf("ok" to false, "problem" to read.problem)
    }
    assertEquals(expected(result), comparable(actual), args.toString())
  }

  @Test
  fun triggerFilterProblemCases() = cases("triggerFilterProblem").forEach { (args, result) ->
    val remedy = str(args[1].jsonObject["remedy"])
    assertEquals(str(result), triggerFilterProblem(args[0].jsonPrimitive.content, remedy), args.toString())
  }

  @Test
  fun siteInteractionDocumentCases() = cases("siteInteractionDocument").forEach { (args, result) ->
    assertEquals(expected(result), comparable(siteInteractionDocument(doc(args[0]))), args.toString())
  }

  @Test
  fun sendEmailReplyIneligibilityCases() = cases("sendEmailReplyIneligibility").forEach { (args, result) ->
    val context = args[1].jsonObject
    assertEquals(
      str(result),
      sendEmailReplyIneligibility(doc(args[0]), str(context["event"]), context.getValue("afterWait").jsonPrimitive.content.toBoolean()),
      args.toString(),
    )
  }

  @Test
  fun stepRunsAfterWaitCases() = cases("stepRunsAfterWait").forEach { (args, result) ->
    assertEquals(
      result.jsonPrimitive.content.toBoolean(),
      stepRunsAfterWait(plainOf(args[0]) as List<*>, args[1].jsonPrimitive.content.toInt()),
      args.toString(),
    )
  }

  @Test
  fun workflowFunctionCallsCases() = cases("workflowFunctionCalls").forEach { (args, result) ->
    assertEquals(expected(result), comparable(workflowFunctionCalls(doc(args[0]))), args.toString())
  }

  @Test
  fun placeholderCases() {
    cases("interactionPlaceholders").forEach { (args, result) ->
      val actual = interactionPlaceholders(doc(args[0])).map { mapOf("step" to it.step, "field" to it.field, "names" to it.names, "text" to it.text) }
      assertEquals(expected(result), comparable(actual), args.toString())
    }
    cases("describeInteractionPlaceholder").forEach { (args, result) ->
      val input = doc(args[0])
      val placeholder = InteractionPlaceholder((input["step"] as? Number)?.toInt(), "", input.str("names")!!, input.str("text")!!)
      assertEquals(str(result), describeInteractionPlaceholder(placeholder), args.toString())
    }
  }

  @Test
  fun runWordsCases() {
    cases("runTriggeredByLabel").forEach { (args, result) -> assertEquals(str(result), runTriggeredByLabel(doc(args[0])), args.toString()) }
    cases("actionRunResult").forEach { (args, result) -> assertEquals(str(result), actionRunResult(doc(args[0])), args.toString()) }
    cases("actionRunSummary").forEach { (args, result) -> assertEquals(str(result), actionRunSummary(doc(args[0])), args.toString()) }
  }

  @Test
  fun orgAutomationPlacementCases() {
    cases("orgAutomationRunsOnHost").forEach { (args, result) ->
      assertEquals(result.jsonPrimitive.content.toBoolean(), orgAutomationRunsOnHost(doc(args[0]), args[1].jsonPrimitive.content), args.toString())
    }
    cases("orgAutomationStopReason").forEach { (args, result) ->
      assertEquals(str(result), orgAutomationStopReason(doc(args[0]), args[1].jsonPrimitive.content), args.toString())
    }
  }
}
