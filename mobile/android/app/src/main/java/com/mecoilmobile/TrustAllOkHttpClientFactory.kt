package com.mecoilmobile

import com.facebook.react.modules.network.OkHttpClientFactory
import com.facebook.react.modules.network.OkHttpClientProvider
import okhttp3.OkHttpClient
import java.security.SecureRandom
import java.security.cert.X509Certificate
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

/**
 * OkHttp factory that accepts self-signed TLS certificates.
 *
 * MeCoil servers are self-hosted (laptop / Raspberry Pi on the LAN) and almost
 * always present a self-signed certificate generated with mkcert. The default
 * OkHttp trust manager validates against the system CA store and rejects those,
 * which would make every `wss://` connection fail. Installed via
 * [OkHttpClientProvider.setOkHttpClientFactory] in MainApplication, this factory
 * replaces the trust manager and hostname verifier used by React Native's
 * networking layer (JS `fetch` and `WebSocket`) so the app can reach those hosts.
 *
 * SECURITY NOTE: this disables TLS certificate and hostname verification for all
 * traffic the app makes. That is an acceptable trade-off here because the app
 * only talks to a user-specified game server and public OSM map tiles, and the
 * alternative (asking every player to install a per-deployment root CA on their
 * phone) defeats the point of the native app. Do not copy this into an app that
 * handles sensitive data over the public internet.
 */
class TrustAllOkHttpClientFactory : OkHttpClientFactory {
  override fun createNewNetworkModuleClient(): OkHttpClient {
    val trustAllCerts = arrayOf<TrustManager>(
      object : X509TrustManager {
        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
        override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
        override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
      }
    )

    val sslContext = SSLContext.getInstance("TLS")
    sslContext.init(null, trustAllCerts, SecureRandom())

    return OkHttpClientProvider.createClientBuilder()
      .sslSocketFactory(sslContext.socketFactory, trustAllCerts[0] as X509TrustManager)
      .hostnameVerifier { _, _ -> true }
      .build()
  }
}
