package com.aglyn.screens

import com.aglyn.ui.StatusTone
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** A spec screen's refusal stays to be read; a success goes on its own (AGL-3851 D8). */
class SpecNoticeTest {
  @Test
  fun refusalsAndWarningsStaySuccessesGo() {
    assertTrue(noticeStays(StatusTone.ERROR))
    assertTrue(noticeStays(StatusTone.WARNING))
    assertFalse(noticeStays(StatusTone.SUCCESS))
    assertFalse(noticeStays(StatusTone.INFO))
  }
}
