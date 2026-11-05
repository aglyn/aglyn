package com.aglyn.screens

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals

/** `only` keeps a route's subset of a catalog, with each group's heading on its first kept row. */
class FieldsFromOnlyTest {
  private val context = Json.parseToJsonElement(
    """{"app":{"catalog":[
      {"key":"a","label":"A","group":"g1","groupLabel":"One","first":true},
      {"key":"b","label":"B","group":"g1","groupLabel":"One","first":false},
      {"key":"c","label":"C","group":"g2","groupLabel":"Two","first":true}
    ]},"data":{"perms":{"keys":["b","c"],"defaults":{"b":true,"c":false},"stored":{"c":true}}}}""",
  )
  private val entry = Json.parseToJsonElement(
    """{"fieldsFrom":{"items":"app.catalog","only":"data.perms.keys","each":[
      {"if":"item.first","key":"h.{item.group}","label":"{item.groupLabel}","kind":"heading"},
      {"if":"data.perms.defaults[@item.key]","key":"p.{item.key}","label":"{item.label}","help":"allowed","initial":"{data.perms.stored[@item.key]}"},
      {"if":"!data.perms.defaults[@item.key]","key":"p.{item.key}","label":"{item.label}","help":"not allowed","initial":"{data.perms.stored[@item.key]}"}
    ]}}""",
  ).jsonObject

  @Test
  fun keepsTheRoutesKeysAndTheirHeadings() {
    val fields = FieldSpec.parseAll(listOf(entry), context)
    assertEquals(listOf("h.g1", "p.b", "h.g2", "p.c"), fields.map { it.key })
    assertEquals(listOf(null, "allowed", null, "not allowed"), fields.map { it.help })
    assertEquals("true", fields[3].initial)
  }
}
