package com.aglyn.site

import com.aglyn.site.pages.pageDeleteBody
import com.aglyn.site.pages.pageUnpublishBody
import kotlin.test.Test
import kotlin.test.assertEquals

/** A page's delete and unpublish confirms name the pages inside it only when it has some. */
class PageDialogWordsTest {
  @Test
  fun aPageWithNoChildrenSaysNothingAboutPagesInsideIt() {
    assertEquals("It is live at /about and stops answering there.", pageDeleteBody("/about", hasChildren = false))
    assertEquals("It is live at /about and stops answering there. Pages inside it keep their addresses.", pageDeleteBody("/about", hasChildren = true))
    assertEquals("It is not published, so no address stops working.", pageDeleteBody(null, hasChildren = false))
    assertEquals("Visitors can no longer reach it.", pageUnpublishBody(false))
    assertEquals("Visitors can no longer reach it. Pages inside it keep their addresses.", pageUnpublishBody(true))
  }
}
