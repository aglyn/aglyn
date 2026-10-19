package com.aglyn.core

import com.aglyn.contracts.ContractJsonFormat
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.OneBoxGroup
import com.aglyn.contracts.OneBoxResponse
import com.aglyn.contracts.isSearchableQuery

/**
 * The one box's server half (AGL-3943): `GET /api/search` with the person's ID token answers workspaces, sites, pages,
 * orders, contacts, emails and every plugin's records, grouped, in the order the box shows them. The screens-and-settings
 * group is the app's own ([com.aglyn.contracts.searchNavScreens]) and never comes from here.
 */
class OneBoxSearch(private val api: ConsoleApiClient) {
  /**
   * One search where the person stands ([orgId] and [hostId] optional; a site needs its workspace). Null for a query too
   * short to send. Throws [ConsoleApiError] with the route's words (a 429 says to slow down).
   */
  suspend fun search(query: String, orgId: String?, hostId: String?, limit: Int = Contracts.oneBoxRowsDefault.toInt()): OneBoxResponse? {
    val q = query.trim().take(Contracts.oneBoxQueryMax.toInt())
    if (!isSearchableQuery(q)) return null
    val answer = api.request(
      Contracts.oneBoxSearchPath,
      query = buildMap {
        put("q", q)
        orgId?.let { put("orgId", it) }
        if (orgId != null) hostId?.let { put("hostId", it) }
        put("limit", limit)
      },
    ) ?: return null
    return ContractJsonFormat.decodeFromJsonElement(OneBoxResponse.serializer(), answer)
  }

  /** The next page of one group ("Show more"), from the cursor its last page gave. */
  suspend fun more(query: String, orgId: String?, hostId: String?, group: OneBoxGroup): OneBoxGroup? {
    val cursor = group.nextCursor ?: return null
    val answer = api.request(
      Contracts.oneBoxSearchPath,
      query = buildMap {
        put("q", query.trim().take(Contracts.oneBoxQueryMax.toInt()))
        orgId?.let { put("orgId", it) }
        if (orgId != null) hostId?.let { put("hostId", it) }
        put("limit", Contracts.oneBoxRowsMax)
        put("group", group.group)
        put("cursor", cursor)
      },
    ) ?: return null
    return ContractJsonFormat.decodeFromJsonElement(OneBoxResponse.serializer(), answer).groups.firstOrNull { it.group == group.group }
  }
}
