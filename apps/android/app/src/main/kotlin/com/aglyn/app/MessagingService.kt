package com.aglyn.app

import com.aglyn.shell.AglynMessagingService

class MessagingService : AglynMessagingService() {
  override val services get() = (application as AglynApplication).services
  override val launchActivity: Class<*> = MainActivity::class.java
}
