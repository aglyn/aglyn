// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.plugins.crm

import com.aglyn.contracts.Contracts
import com.aglyn.ui.FieldCurrency
import com.aglyn.ui.fieldDisplay
import com.aglyn.ui.fieldProblems
import java.util.Locale
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * A currency field (AGL-3971) shows and stores its own currency's minor units: USD cents, whole yen, BHD fils. A JPY
 * value stored as 1500 reads ¥1,500, never ¥15.
 */
class CrmCurrencyFieldTest {
  private fun field(code: String?) = customFields(
    CrmKind.CONTACT,
    listOf(CustomFieldDefinition("f", "budget", "Budget", "currency", emptyList(), false, 0, false, "contact", code)),
  ).single()

  @Test
  fun aCurrencyFieldUsesItsOwnCurrencysMinorUnit() {
    val usd = field("usd")
    val jpy = field("jpy")
    val bhd = field("bhd")
    assertEquals(Stored.MINOR, usd.stored)
    assertEquals(FieldCurrency("JPY", 0), jpy.spec.currency)
    assertEquals(FieldCurrency("BHD", 3), bhd.spec.currency)
    assertEquals("USD", field(null).spec.currency?.code)

    assertEquals("1250.50", displayValue(usd, 125050L))
    assertEquals("1500", displayValue(jpy, 1500L))
    assertEquals("1.250", displayValue(bhd, 1250L))

    assertEquals(125050L, storedValue(usd, "$1,250.50"))
    assertEquals(1500L, storedValue(jpy, "¥1,500"))
    assertEquals(1250L, storedValue(bhd, "1.25"))
    assertNull(storedValue(usd, "abc"))

    val before = Locale.getDefault()
    Locale.setDefault(Locale.US)
    try {
      assertEquals("¥1,500", fieldDisplay(jpy.spec, "1500"))
      assertEquals("$1,250.50", fieldDisplay(usd.spec, "1250.50"))
      assertTrue(fieldDisplay(bhd.spec, "1.250").orEmpty().endsWith("1.250"))
    } finally {
      Locale.setDefault(before)
    }
    assertTrue(fieldProblems(listOf(jpy.spec), mapOf(jpy.spec.key to "¥1,500")).isEmpty())
    assertEquals("Enter an amount", fieldProblems(listOf(jpy.spec), mapOf(jpy.spec.key to "lots"))[jpy.spec.key])
  }

  /** The field drawer's types and currencies are the console's (`CONTACT_FIELD_TYPES`, the deal currencies). */
  @Test
  fun theFieldEditorOffersTheConsolesTypesAndCurrencies() {
    assertEquals("currency", Contracts.nativeCrmFieldTypes.last())
    assertEquals("Currency", Contracts.nativeCrmFieldTypeLabels["currency"])
    assertTrue("jpy" in Contracts.nativeCrmFieldCurrencies)
    assertEquals("usd", Contracts.nativeCrmFieldDefaultCurrency)
    val def = CustomFieldDefinition("f", "budget", "Budget", "currency", emptyList(), true, 0, false, "contact", "jpy")
    assertEquals("budget · Currency · JPY · Required", fieldSubtitle(def))
  }
}
