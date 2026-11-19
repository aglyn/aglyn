package com.aglyn.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Replays the console's own answers for where a site is live (`siteLiveUrlForSlug`, function-cases.generated.json). */
class SiteLiveUrlTest {
  private val functions = Json.parseToJsonElement(
    File(System.getProperty("aglyn.contractsDir"), "function-cases.generated.json").readText(),
  ).jsonObject.getValue("functions").jsonObject

  private fun cases(name: String) = functions.getValue(name).jsonObject.getValue("cases").jsonArray.map {
    it.jsonObject.getValue("args").jsonArray to it.jsonObject.getValue("result")
  }.also { assertTrue(it.isNotEmpty(), "no cases for $name") }

  @Test
  fun theLiveUrlIsTheConsoles() = cases("siteLiveUrlForSlug").forEach { (args, result) ->
    val host = args[0] as? JsonObject
    val answer = host?.let {
      SiteLiveUrl.forSlug(
        subdomain = (it["subdomain"] as? JsonPrimitive)?.contentOrNull,
        cname = (it["cname"] as? JsonPrimitive)?.contentOrNull,
        slug = args[1].jsonPrimitive.content,
        consoleHostname = args[2].jsonPrimitive.contentOrNull,
      )
    }
    assertEquals(result.jsonPrimitive.contentOrNull, answer, args.toString())
  }

  @Test
  fun localAndPreviewConsolesAreTheConsoles() {
    cases("isLocalConsole").forEach { (args, result) ->
      assertEquals(result.jsonPrimitive.booleanOrNull, SiteLiveUrl.isLocalConsole(args[0].jsonPrimitive.content), args.toString())
    }
    cases("isPreviewConsole").forEach { (args, result) ->
      assertEquals(result.jsonPrimitive.booleanOrNull, SiteLiveUrl.isPreviewConsole(args[0].jsonPrimitive.content), args.toString())
    }
  }

  /** Visit site from the console the app is configured with: the local stack opens the local tenant, never production. */
  @Test
  fun visitSiteFollowsTheConfiguredConsole() {
    assertEquals("http://localhost:4500/?tenantHost=juniper-street", SiteLiveUrl.home("juniper-street", "juniperbakery.example", "http://10.0.2.2:4610"))
    assertEquals("http://localhost:4500/?tenantHost=juniper-street", SiteLiveUrl.home("juniper-street", null, "http://localhost:4610/"))
    assertEquals("https://aglyn-tenant-git-main-aglyn.vercel.app/?tenantHost=juniper-street", SiteLiveUrl.home("juniper-street", null, "https://aglyn-console-git-x-aglyn.vercel.app"))
    assertEquals("https://juniperbakery.example/", SiteLiveUrl.home("juniper-street", "juniperbakery.example", "https://app.aglyn.com"))
    assertEquals("https://juniper-street.aglyn.app/", SiteLiveUrl.home("juniper-street", null, null))
    assertNull(SiteLiveUrl.home(null, "only-custom.example", "http://localhost:4610"))
    assertEquals("[::1]", SiteLiveUrl.consoleHostname("http://[::1]:4610"))
  }
}
