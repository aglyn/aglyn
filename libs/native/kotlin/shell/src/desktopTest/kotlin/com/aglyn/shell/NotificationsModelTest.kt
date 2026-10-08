package com.aglyn.shell

import com.aglyn.contracts.NotificationChannel
import com.aglyn.contracts.NotificationScope
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDelete
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.notificationAnswerWrite
import kotlin.test.Test
import kotlin.test.assertEquals

class NotificationsModelTest {
  @Test
  fun theFeedFiltersOnTheQueryWithAProbeRow() {
    val all = notificationFeedQuery("u1", NotificationFilter(), 25)
    assertEquals("users/u1/notifications", all.collectionPath)
    assertEquals(emptyList(), all.filters)
    assertEquals(26, all.limit)
    val one = notificationFeedQuery("u1", NotificationFilter(NotificationStatusFilter.NEW, setOf("content.order")), 25)
    assertEquals(listOf(FirestoreFilter("type", FilterOp.EQ, "content.order"), FirestoreFilter("read", FilterOp.EQ, false)), one.filters)
    val many = notificationFeedQuery("u1", NotificationFilter(NotificationStatusFilter.READ, setOf("b", "a")), 25)
    assertEquals(listOf(FirestoreFilter("type", FilterOp.IN, listOf("a", "b")), FirestoreFilter("read", FilterOp.EQ, true)), many.filters)
  }

  @Test
  fun markAllSettlesOnlyTheUnread() {
    val docs = listOf(
      FirestoreDoc("a", "p/a", mapOf("read" to false)),
      FirestoreDoc("b", "p/b", mapOf("read" to true, "readAt" to 1)),
      FirestoreDoc("c", "p/c", mapOf()),
    )
    assertEquals(listOf("a", "c"), unreadIds(docs))
  }

  @Test
  fun clearingAnAnswerDeletesItsKeyAndAnEmptiedCell() {
    val settings = mapOf(
      "orgs" to mapOf("o1" to mapOf("content" to mapOf("console" to false, "email" to true))),
      "hostTypes" to mapOf("h1" to mapOf("content.order" to mapOf("email" to true))),
    )
    assertEquals(
      mapOf("notificationSettings" to mapOf("orgs" to mapOf("o1" to mapOf("content" to mapOf("console" to FirestoreDelete))))),
      notificationAnswerWrite(settings, NotificationScope.Org("o1"), "content", false, NotificationChannel.CONSOLE, null),
    )
    assertEquals(
      mapOf("notificationSettings" to mapOf("hostTypes" to mapOf("h1" to mapOf("content.order" to FirestoreDelete)))),
      notificationAnswerWrite(settings, NotificationScope.Host("h1"), "content.order", true, NotificationChannel.EMAIL, null),
    )
    assertEquals(
      mapOf("notificationSettings" to mapOf("account" to mapOf("billing" to mapOf("email" to true)))),
      notificationAnswerWrite(settings, NotificationScope.Account, "billing", false, NotificationChannel.EMAIL, true),
    )
  }
}
