package com.aglyn.core

enum class OrgRole(val wire: String) {
  OWNER("owner"), ADMIN("admin"), EDITOR("editor"), VIEWER("viewer");

  companion object {
    fun of(value: Any?): OrgRole? = entries.firstOrNull { it.wire == value }
  }
}

/**
 * What a member row (`orgs/{orgId}/members/{uid}`) grants, read the way the
 * console reads it. Navigation only: the security rules are the boundary.
 */
data class OrgAccess(
  val loaded: Boolean,
  val member: FirestoreDoc?,
  val role: OrgRole?,
  /** Owner, admin, every site, or a legacy member with no site list. */
  val orgWide: Boolean,
  /** The scope tokens the rules admit this member's reads by. */
  val tokens: List<String>,
  /** The member's role on each site they were given by name. */
  val hostAccess: Map<String, String>,
) {
  companion object {
    const val ORG_SCOPE_TOKEN = "org"

    val LOADING = OrgAccess(false, null, null, false, emptyList(), emptyMap())

    fun hostScopeToken(hostId: String) = "host:$hostId"

    fun isOrgWideMember(data: Map<String, Any?>?): Boolean {
      if (data == null) return false
      val role = data["role"]
      if (role == "owner" || role == "admin") return true
      if (data["allHosts"] == true) return true
      val scoping = data["hostAccess"] as? Map<*, *>
      return !data.containsKey("allHosts") && scoping.isNullOrEmpty()
    }

    fun memberScopeTokens(data: Map<String, Any?>?): List<String> {
      val stored = (data?.get("scopeTokens") as? List<*>)?.filterIsInstance<String>()
      if (!stored.isNullOrEmpty()) return stored
      if (isOrgWideMember(data)) return listOf(ORG_SCOPE_TOKEN)
      val hostIds = (data?.get("hostAccess") as? Map<*, *>)?.keys?.map { it.toString() } ?: emptyList()
      return listOf(ORG_SCOPE_TOKEN) + hostIds.map(::hostScopeToken)
    }

    fun fromMember(member: FirestoreDoc?): OrgAccess {
      if (member == null) return LOADING.copy(loaded = true)
      val hostAccess = (member.data["hostAccess"] as? Map<*, *>)
        ?.mapNotNull { (k, v) -> if (v is String) k.toString() to v else null }?.toMap() ?: emptyMap()
      return OrgAccess(
        loaded = true,
        member = member,
        role = OrgRole.of(member.data["role"]),
        orgWide = isOrgWideMember(member.data),
        tokens = memberScopeTokens(member.data),
        hostAccess = hostAccess,
      )
    }
  }
}
