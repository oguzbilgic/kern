package ai.kern.app

import android.content.Context
import android.content.SharedPreferences

/**
 * Persists server URL and auth token to SharedPreferences.
 */
object ConnectionConfig {
    private const val PREFS = "kern_connection"
    private const val KEY_URL = "server_url"
    private const val KEY_TOKEN = "auth_token"

    private fun prefs(ctx: Context): SharedPreferences =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun getUrl(ctx: Context): String? = prefs(ctx).getString(KEY_URL, null)
    fun getToken(ctx: Context): String? = prefs(ctx).getString(KEY_TOKEN, null)

    fun save(ctx: Context, url: String, token: String?) {
        prefs(ctx).edit()
            .putString(KEY_URL, url)
            .putString(KEY_TOKEN, token)
            .apply()
    }

    fun clear(ctx: Context) {
        prefs(ctx).edit().clear().apply()
    }

    /**
     * Build the full web UI URL with embedded token query param.
     */
    fun buildWebUrl(url: String, token: String?): String {
        val base = url.trimEnd('/')
        val params = mutableListOf<String>()
        if (!token.isNullOrBlank()) params.add("token=$token")
        return if (params.isEmpty()) base else "$base?${params.joinToString("&")}"
    }
}
