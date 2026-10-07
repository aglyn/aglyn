package com.aglyn.pos

import com.aglyn.shell.AglynMessagingService

class MessagingService : AglynMessagingService() {
  override val services get() = (application as AglynPosApplication).services
  override val launchActivity: Class<*> = MainActivity::class.java
}
