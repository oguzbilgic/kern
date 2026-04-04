package ai.kern.app

import android.content.Context
import android.content.SharedPreferences

/**
 * Persists the web server URL to SharedPreferences.
 */
object ConnectionConfig {
    private const val PREFS = "kern_connection"
    private const val KEY_URL = "server_url"

    private fun prefs(ctx: Context): SharedPreferences =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun getUrl(ctx: Context): String? = prefs(ctx).getString(KEY_URL, null)

    fun save(ctx: Context, url: String) {
        prefs(ctx).edit().putString(KEY_URL, url).apply()
    }

    fun clear(ctx: Context) {
        prefs(ctx).edit().clear().apply()
    }
}
