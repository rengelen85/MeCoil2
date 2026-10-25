package com.mecoilmobile

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.view.Surface
import android.view.WindowManager
import android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Streams the phone's orientation for single-player AR target practice
 * (src/lib/arOrientation.ts). Emits "arOrientation" events with the
 * device-to-world rotation quaternion (x, y, z, w) and the current display
 * rotation in degrees, matching the web client's deviceorientation +
 * screen.orientation.angle inputs to shared/arGame.js.
 *
 * Uses the game rotation vector (gyro + accelerometer, no magnetometer) so the
 * aim doesn't jump near the gun's motor or other metal. Its yaw reference is
 * arbitrary, which is fine: targets are placed relative to where you aim.
 *
 * While running it also keeps the screen on, like the web client's wake lock.
 */
class ArOrientationModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext), SensorEventListener {

  private val sensorManager =
    reactContext.getSystemService(Context.SENSOR_SERVICE) as SensorManager
  private val quaternion = FloatArray(4)
  private var running = false
  private var lastEmitNs = 0L

  override fun getName() = "ArOrientation"

  private fun sensor(): Sensor? =
    sensorManager.getDefaultSensor(Sensor.TYPE_GAME_ROTATION_VECTOR)
      ?: sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)

  @ReactMethod
  fun start() {
    if (running) return
    val s = sensor() ?: return
    running = sensorManager.registerListener(this, s, SensorManager.SENSOR_DELAY_GAME)
    setKeepScreenOn(true)
  }

  @ReactMethod
  fun stop() {
    if (!running) return
    sensorManager.unregisterListener(this)
    running = false
    setKeepScreenOn(false)
  }

  private fun setKeepScreenOn(on: Boolean) {
    val activity = reactContext.currentActivity ?: return
    activity.runOnUiThread {
      if (on) activity.window.addFlags(FLAG_KEEP_SCREEN_ON)
      else activity.window.clearFlags(FLAG_KEEP_SCREEN_ON)
    }
  }

  @ReactMethod
  fun isAvailable(promise: com.facebook.react.bridge.Promise) {
    promise.resolve(sensor() != null)
  }

  // Required by NativeEventEmitter on the JS side.
  @ReactMethod fun addListener(@Suppress("UNUSED_PARAMETER") eventName: String) {}

  @ReactMethod fun removeListeners(@Suppress("UNUSED_PARAMETER") count: Int) {}

  override fun invalidate() {
    stop()
    super.invalidate()
  }

  override fun onSensorChanged(event: SensorEvent) {
    // Cap at ~60 events/s; the JS render loop doesn't need more.
    if (event.timestamp - lastEmitNs < 16_000_000L) return
    lastEmitNs = event.timestamp
    SensorManager.getQuaternionFromVector(quaternion, event.values)
    val payload = Arguments.createMap().apply {
      putDouble("w", quaternion[0].toDouble())
      putDouble("x", quaternion[1].toDouble())
      putDouble("y", quaternion[2].toDouble())
      putDouble("z", quaternion[3].toDouble())
      putInt("screenAngle", displayRotationDegrees())
    }
    if (reactContext.hasActiveReactInstance()) {
      reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("arOrientation", payload)
    }
  }

  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

  @Suppress("DEPRECATION")
  private fun displayRotationDegrees(): Int {
    val rotation =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        reactContext.currentActivity?.display?.rotation ?: Surface.ROTATION_0
      } else {
        (reactContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager)
          .defaultDisplay.rotation
      }
    return when (rotation) {
      Surface.ROTATION_90 -> 90
      Surface.ROTATION_180 -> 180
      Surface.ROTATION_270 -> 270
      else -> 0
    }
  }
}
