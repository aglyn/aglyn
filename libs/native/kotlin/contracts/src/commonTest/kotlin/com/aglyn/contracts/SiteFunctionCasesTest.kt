package com.aglyn.contracts

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Replays the site-functions cases in function-cases.generated.json: the TypeScript's own answers. */
class SiteFunctionCasesTest {
  private val functions = ContractJsonFormat.parseToJsonElement(ContractCaseJson.functionCases).jsonObject.getValue("functions").jsonObject

  private fun cases(name: String): List<Pair<JsonArray, JsonElement>> =
    functions.getValue(name).jsonObject.getValue("cases").jsonArray.map {
      it.jsonObject.getValue("args").jsonArray to it.jsonObject.getValue("result")
    }

  private fun str(element: JsonElement?): String? = (element as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content

  @Test
  fun everyCaseFamilyIsPresent() {
    for (name in listOf("evaluateExpression", "expressionSyntaxError", "evaluateHostFunction", "runWorkflow", "hostEventLabel", "hostEventPayloadHint", "hostEventRecipientActed")) {
      assertTrue(cases(name).isNotEmpty(), name)
    }
  }

  @Test
  fun contractValuesMatchThePort() {
    assertEquals(Contracts.functionBuiltinNames, FUNCTION_BUILTIN_NAMES)
    assertEquals(Contracts.functionMaxOperations, FUNCTION_MAX_OPERATIONS.toLong())
    assertEquals(Contracts.workflowMaxSteps, WORKFLOW_MAX_STEPS.toLong())
    assertEquals(Contracts.crossMaxDepth, CROSS_MAX_DEPTH.toLong())
    assertTrue(hostEventTypes.isNotEmpty())
    assertEquals(hostEventsInOrder.map { it.order }, hostEventsInOrder.map { it.order }.sorted())
  }

  @Test
  fun evaluateExpressionCases() = cases("evaluateExpression").forEach { (args, result) ->
    val value = evaluateExpression(args[0].jsonPrimitive.content, scopeOf(args[1]))
    assertEquals(expected(result), comparable(value), args.toString())
  }

  @Test
  fun expressionSyntaxErrorCases() = cases("expressionSyntaxError").forEach { (args, result) ->
    assertEquals(str(result), expressionSyntaxError(args[0].jsonPrimitive.content), args.toString())
  }

  private fun functionOf(element: JsonElement) = hostFunctionOf(plainOf(element) as Map<*, *>)

  @Test
  fun evaluateHostFunctionCases() = cases("evaluateHostFunction").forEach { (args, result) ->
    @Suppress("UNCHECKED_CAST")
    val callArgs = plainOf(args[1]) as Map<String, Any?>
    val globals = (args.getOrNull(2) as? JsonObject)?.get("globals")?.let(::scopeOf) ?: emptyMap()
    val run = evaluateHostFunction(functionOf(args[0]), callArgs, globals)
    val actual = when (run) {
      is FunctionRunResult.Ok -> mapOf("ok" to true, "scope" to run.scope, "value" to run.value)
      is FunctionRunResult.Failed -> mapOf("error" to run.error, "ok" to false)
    }
    assertEquals(expected(result), comparable(actual), args.toString())
  }

  @Test
  fun runWorkflowCases() = cases("runWorkflow").forEach { (args, result) ->
    val workflow = workflowDefinitionOf(plainOf(args[0]) as Map<*, *>)
    val functions = args[1].jsonObject.mapValues { (_, value) -> functionOf(value) }
    val variables = args[2].jsonObject.mapValues { (_, value) -> hostVariableOf(plainOf(value) as Map<*, *>) }
    val extra = args.getOrNull(3)?.let(::scopeOf) ?: emptyMap()
    val actual = when (val run = runWorkflow(workflow, functions, variables, extra)) {
      is WorkflowRunResult.Ok -> mapOf("ok" to true, "results" to run.results.toMap(), "value" to run.value)
      is WorkflowRunResult.Failed -> buildMap<String, Any> {
        put("error", run.error)
        put("ok", false)
        run.step?.let { put("step", it) }
      }
    }
    assertEquals(expected(result), comparable(actual), args.toString())
  }

  @Test
  fun hostEventCases() {
    cases("hostEventLabel").forEach { (args, result) -> assertEquals(str(result), hostEventLabel(str(args[0])), args.toString()) }
    cases("hostEventPayloadHint").forEach { (args, result) -> assertEquals(str(result), hostEventPayloadHint(str(args[0])), args.toString()) }
    cases("hostEventRecipientActed").forEach { (args, result) ->
      assertEquals(result.jsonPrimitive.content.toBoolean(), hostEventRecipientActed(str(args[0])), args.toString())
    }
  }

  @Test
  fun testRunLineReadsAsTheConsole() {
    assertEquals("Result: 22 (d=10, step2=22)", workflowTestRunLine(WorkflowRunResult.Ok(22.0, listOf("d" to 10.0, "step2" to 22.0))))
    assertEquals("Error: Step 1: Unknown name \"nope\"", workflowTestRunLine(WorkflowRunResult.Failed("Step 1: Unknown name \"nope\"", 1)))
  }

  @Test
  fun jsConversions() {
    assertEquals("1e+21", jsNumberString(1e21))
    assertEquals("0.000001", jsNumberString(1e-6))
    assertEquals("1e-7", jsNumberString(1e-7))
    assertEquals("123456789012", jsNumberString(123456789012.0))
    assertEquals(255.0, jsStringToNumber(" 0xff "))
    assertTrue(jsStringToNumber("12px").isNaN())
    assertEquals("-1,234.50", formatEnUs(-1234.5, 2))
    assertEquals("1,000", formatEnUs(999.6, 0))
    assertEquals(listOf("2", "10", "b", "a"), jsObjectOrder(linkedMapOf("b" to 1, "10" to 2, "a" to 3, "2" to 4)).map { it.first })
  }
}
