package com.aglyn.screens

import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** The Quotes settings card (AGL-4206): what every new quote starts with, written to the store document as the console writes it. */
class CommerceQuoteSettingsSpecsTest : SpecTestBase() {
  @Test
  fun quoteDefaultsAreReadAndWrittenAsTheConsoleDoes() {
    val writer = RecordingWriter()
    val fresh = withWriter(spec("commerce", "commerce.quoteSettings"), emptyMap(), """{"store":{"currency":"USD"}}""", writer)
    val fields = fresh.fieldsShown("quotes").associateBy { it.key }
    assertEquals(
      3,
      (ScreenValues.resolve(fields.getValue("approvalStatements").initial!!, fresh.context) as kotlinx.serialization.json.JsonArray).size,
      "the suggested statements until the store writes its own",
    )
    assertFalse(ScreenValues.truthy(ScreenValues.resolve(fields.getValue("requireProofApproval").initial!!, fresh.context)))
    val save = fresh.form("quotes")
    val form = """{"requireProofApproval":true,"requireProofSignIn":false,"approvalStatements":["I checked it."]}"""
    assertFalse(ScreenValues.condition(save.disabledWhen, ScreenContext.with(fresh.context, "form", json(form))))
    assertTrue(ScreenValues.condition(save.disabledWhen, ScreenContext.with(fresh.context, "form", json("""{"approvalStatements":[]}"""))))
    runBlocking { fresh.run(save, ScreenContext.with(fresh.context, "form", json(form))) }
    assertEquals(listOf("merge hosts/h1/settings/store {quotes={requireProofApproval=true, requireProofSignIn=false, approvalStatements=[I checked it.]}}"), writer.calls)
    val own = screen(spec("commerce", "commerce.quoteSettings"), emptyMap(), """{"store":{"quotes":{"requireProofApproval":true,"approvalStatements":["Mine."]}}}""")
    val ownFields = own.fieldsShown("quotes").associateBy { it.key }
    assertEquals("Mine.", ScreenValues.text((ScreenValues.resolve(ownFields.getValue("approvalStatements").initial!!, own.context) as kotlinx.serialization.json.JsonArray)[0]))
    assertTrue(ScreenValues.truthy(ScreenValues.resolve(ownFields.getValue("requireProofApproval").initial!!, own.context)))
  }
}
