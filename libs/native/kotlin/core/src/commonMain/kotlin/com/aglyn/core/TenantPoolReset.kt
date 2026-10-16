package com.aglyn.core

/** One instance field of an auth SDK, as the platform reaches it (AGL-3844). */
interface InstanceSlot {
  fun read(): Any?
  fun write(value: Any?)
}

/**
 * Points an auth instance back at the project pool after a single sign-on (AGL-3844).
 *
 * An SSO account lives in its workspace's GCIP tenant, so the console hand-off aims the shared instance at that tenant before it
 * exchanges the custom token. The Firebase Android SDK can aim an instance at a tenant and never back (`setTenantId` refuses an
 * empty value), and `signOut` leaves the tenant set, so after signing out of an SSO account every email, Google, Apple and
 * passkey sign-in went to the tenant and was refused until the app was reopened.
 *
 * The SDK keeps the tenant in one private field that every request reads when it is made. This finds that field by its VALUE
 * (exactly one of [slots] holds what [currentTenant] reports), clears it, and checks that the instance now reports the project
 * pool. Matching by value rather than by the obfuscated name keeps it honest across SDK versions: anything unexpected (no match,
 * more than one, a getter that still answers the tenant) changes nothing, restores what it touched, and returns false, and the
 * caller keeps refusing with the reopen-the-app message as before.
 *
 * @return true when the instance is on the project pool afterwards (including when it already was).
 */
fun returnToProjectPool(currentTenant: () -> String?, slots: List<InstanceSlot>): Boolean {
  val tenant = currentTenant() ?: return true
  val holding = slots.filter { runCatching { it.read() }.getOrNull() == tenant }
  if (holding.size != 1) return false
  val slot = holding.single()
  if (runCatching { slot.write(null) }.isFailure) return false
  if (currentTenant() == null) return true
  runCatching { slot.write(tenant) }
  return false
}
