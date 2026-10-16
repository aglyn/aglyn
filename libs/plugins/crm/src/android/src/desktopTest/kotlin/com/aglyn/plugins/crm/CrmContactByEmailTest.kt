// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.plugins.crm

import com.aglyn.contracts.ListFilterRequest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** The Contacts list asked to open one person by address (`contactsListSeed`, `?email=`). */
class CrmContactByEmailTest {
  @Test
  fun theAddressNarrowsTheListToThatOnePerson() {
    val filter = contactEmailFilter("  Jane@Example.com ")
    assertEquals(CONTACT_EMAIL_FILTER_KEY, filter?.key)
    assertEquals(listOf(ListFilterRequest("email", "equals", "jane@example.com")), filter?.clauses)
    assertNull(contactEmailFilter(null))
    assertNull(contactEmailFilter("not an address"))
  }
}
