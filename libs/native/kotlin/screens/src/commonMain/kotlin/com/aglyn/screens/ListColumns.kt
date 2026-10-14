package com.aglyn.screens

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive

/**
 * One column of a list block (`columns`): a fact each row can show, which the person can turn on and off, and which can order the
 * list. The console's grid has the same: a column picker, and a header that sorts.
 *
 * `{ id, label, value, show, always, sort: { route | page, type, first } }`. `value` is the cell's template over the row. A `route`
 * sort is the staff route's own order over every row (`sort=<path>:<dir>` on the load); a `page` sort orders the rows already on the
 * screen by a path over the row, as the console does for the columns a query cannot order by. `type` is how a `page` sort compares
 * (`text`, `number` or `date`); `first` is the direction the first tap asks for.
 */
class ListColumn(json: JsonElement) {
  val id: String = json.str("id").orEmpty()
  val label: String = json.str("label") ?: id
  val value: String = json.str("value").orEmpty()
  val show: Boolean = (json.obj("show") as? JsonPrimitive)?.content != "false"
  /** Shown whether or not it is picked, and not offered in the picker: the row's own name. */
  val always: Boolean = json.isTrue("always")
  val route: String? = json.obj("sort")?.str("route")
  val page: String? = json.obj("sort")?.str("page")
  val type: String = json.obj("sort")?.str("type") ?: "text"
  val first: String = if (json.obj("sort")?.str("first") == "desc") "desc" else "asc"
  val sortable: Boolean get() = route != null || page != null
}

/** The order a list was asked for: one column, ascending or descending. Nothing asked is the route's own default order. */
data class ListOrder(val column: String, val descending: Boolean)

internal object ListColumns {
  /** The columns a list block declares, then the ones plugins contribute to its `columnsZone`. */
  fun columns(block: BlockSpec): List<ListColumn> {
    val own = block.raw.arr("columns").filter { it.str("id") != null }.map { ListColumn(it) }
    val contributed = block.string("columnsZone")?.let { zone ->
      ScreenCatalog.zone(zone).mapNotNull { it.raw.obj("column")?.takeIf { column -> column.str("id") != null }?.let(::ListColumn) }
    }.orEmpty()
    return own + contributed
  }

  /** The key a list's choices are kept under: its load, else its items. */
  fun key(block: BlockSpec): String = block.string("load") ?: block.string("items") ?: block.id

  /** The next order a tap on [column] asks for, like a grid header: its first direction, then the other, then the default again. */
  fun next(current: ListOrder?, column: ListColumn): ListOrder? {
    if (current == null || current.column != column.id) return ListOrder(column.id, column.first == "desc")
    return if (current.descending == (column.first == "desc")) ListOrder(column.id, !current.descending) else null
  }

  /** The route's `sort` value (`path:dir`) for an order on a `route` column. */
  fun routeValue(order: ListOrder?, columns: List<ListColumn>): String? {
    val column = order?.let { asked -> columns.firstOrNull { it.id == asked.column } } ?: return null
    val route = column.route ?: return null
    return "$route:${if (order.descending) "desc" else "asc"}"
  }

  /**
   * The rows by a `page` column, in the order asked: numbers as numbers, dates as moments, anything else as text; a row without the
   * value goes last whichever way it is read, and equal rows keep the order they came in.
   */
  fun sorted(rows: List<JsonElement>, column: ListColumn, descending: Boolean, context: JsonElement): List<JsonElement> {
    val path = column.page ?: return rows
    fun missing(value: JsonElement?) = value == null || value is JsonNull || (value is JsonPrimitive && value.isString && value.content.isEmpty())
    val keyed = rows.mapIndexed { index, row -> Triple(index, row, ScreenValues.lookup(path, ScreenContext.withItem(context, row))) }
    fun compare(a: JsonElement?, b: JsonElement?): Int {
      val result = when (column.type) {
        "number" -> (ScreenValues.number(a) ?: 0.0).compareTo(ScreenValues.number(b) ?: 0.0)
        "date" -> (ScreenValues.epochMillis(a) ?: 0L).compareTo(ScreenValues.epochMillis(b) ?: 0L)
        else -> ScreenValues.text(a).compareTo(ScreenValues.text(b), ignoreCase = true)
      }
      return if (descending) -result else result
    }
    return keyed.sortedWith { a, b ->
      val left = missing(a.third)
      val right = missing(b.third)
      when {
        left != right -> if (left) 1 else -1
        !left && compare(a.third, b.third) != 0 -> compare(a.third, b.third)
        else -> a.first.compareTo(b.first)
      }
    }.map { it.second }
  }

  /** A row's visible columns as one line: `Label value`, joined, skipping what the row has nothing for. */
  fun line(columns: List<ListColumn>, shown: Set<String>, scope: JsonElement): String =
    columns.filter { !it.always && it.id in shown }.mapNotNull { column ->
      val text = ScreenValues.render(column.value, scope)
      if (text.isEmpty() || text == "—") null else "${column.label} $text"
    }.joinToString(" · ")
}
