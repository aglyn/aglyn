package com.aglyn.shell

import com.aglyn.core.AglynAppId
import com.aglyn.core.AglynConfig
import com.aglyn.core.AglynEnv
import kotlin.test.Test
import kotlin.test.assertEquals

class HelpLinksTest {
  @Test
  fun helpLinksComeFromTheBuildsOwnDocsAndLegalOrigins() {
    val ours = AglynConfig.read(AglynEnv(consoleUrl = "https://app.example.com", firebaseProjectId = "demo-test"), AglynAppId.AGLYN)
    assertEquals(
      listOf(
        "https://docs.aglyn.com/", "https://docs.aglyn.com/whats-new", "https://aglyn.com/legal/terms", "https://aglyn.com/legal/privacy",
      ),
      helpLinks(ours).map { it.url },
    )
    val theirs = AglynConfig.read(
      AglynEnv(consoleUrl = "https://app.example.com", docsOrigin = "https://help.example.com", legalOrigin = "https://example.com"),
      AglynAppId.AGLYN,
    )
    assertEquals("https://help.example.com/whats-new", helpLinks(theirs).first { it.id == "whats-new" }.url)
    assertEquals("https://example.com/legal/privacy", helpLinks(theirs).first { it.id == "privacy" }.url)
  }

  @Test
  fun aWebPageIsPushedOverWhatIsShowingAndBackLeavesIt() {
    val navigator = ShellNavigator()
    navigator.push(Route.Screen("site.sites"))
    navigator.openWeb("https://juniper-street.aglyn.app/")
    assertEquals(Route.Web("https://juniper-street.aglyn.app/"), navigator.current)
    assertEquals(true, navigator.back())
    assertEquals(Route.Screen("site.sites"), navigator.current)
  }
}
