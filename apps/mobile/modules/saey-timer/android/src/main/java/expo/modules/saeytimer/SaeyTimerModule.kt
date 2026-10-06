package expo.modules.saeytimer

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * إشعار ثابت في الستارة أثناء جلسة المؤقت، فيه عدّاد تنازلي يحدّثه أندرويد بنفسه
 * (لا يحتاج التطبيق مفتوحاً)، ويختفي تلقائياً عند انتهاء الوقت.
 */
class SaeyTimerModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("React context is not available")

  override fun definition() = ModuleDefinition {
    Name("SaeyTimer")

    Function("show") { title: String, body: String, endsAt: Double, color: String ->
      show(title, body, endsAt.toLong(), color)
    }

    Function("cancel") {
      manager().cancel(NOTIFICATION_ID)
    }
  }

  private fun manager() = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  private fun show(title: String, body: String, endsAt: Long, color: String) {
    val nm = manager()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(CHANNEL_ID, "المؤقت الجاري", NotificationManager.IMPORTANCE_LOW).apply {
        description = "العد التنازلي لجلسة الدراسة الحالية"
        setShowBadge(false)
        setSound(null, null)
        enableVibration(false)
      }
      nm.createNotificationChannel(channel)
    }

    // الضغط على الإشعار يفتح شاشة المؤقت
    val open = Intent(Intent.ACTION_VIEW, Uri.parse("saey://timer")).apply {
      setPackage(context.packageName)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
    val pending = PendingIntent.getActivity(
      context, 4107, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    val builder = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
      .setContentTitle(title)
      .setContentText(body)
      .setWhen(endsAt)
      .setShowWhen(true)
      .setUsesChronometer(true)
      .setChronometerCountDown(true)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setContentIntent(pending)

    try {
      builder.setColor(Color.parseColor(color))
    } catch (_: IllegalArgumentException) {
    }

    val left = endsAt - System.currentTimeMillis()
    if (left <= 0) {
      nm.cancel(NOTIFICATION_ID)
      return
    }
    builder.setTimeoutAfter(left)

    try {
      nm.notify(NOTIFICATION_ID, builder.build())
    } catch (_: SecurityException) {
      // الإشعارات غير مسموحة: المنبّه المجدول يبقى يعمل إن سُمح لاحقاً
    }
  }

  companion object {
    private const val CHANNEL_ID = "timer-live"
    private const val NOTIFICATION_ID = 4107
  }
}
