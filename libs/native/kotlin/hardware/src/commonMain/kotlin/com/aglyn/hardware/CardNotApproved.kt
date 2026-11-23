package com.aglyn.hardware

/**
 * A local notification for a card that was not approved while the app was not on screen, or a card taken offline that
 * the bank declined once it was sent (Apple 5.12; the same words as Apple's `CardNotApprovedNotification`).
 */
class CardNotApprovedNotification(amount: String, place: String?) {
  val title: String = "Card not approved"
  val body: String = "$amount${place?.let { " at $it" } ?: ""} was not charged. Open the sale to take the payment another way."

  override fun equals(other: Any?) = other is CardNotApprovedNotification && other.title == title && other.body == body

  override fun hashCode() = 31 * title.hashCode() + body.hashCode()

  override fun toString() = "CardNotApprovedNotification($title: $body)"
}

/** Posts [CardNotApprovedNotification]s; a platform entry point binds it, and it stays quiet while the app is on screen. */
interface CardNotApprovedNotifier {
  fun notifyIfAway(note: CardNotApprovedNotification)
}
