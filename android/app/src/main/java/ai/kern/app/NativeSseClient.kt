package ai.kern.app

import android.util.Log
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

/**
 * Native SSE client that bypasses WebView's EventSource.
 * Reads the SSE stream on a background thread and delivers
 * parsed events via a callback on the calling thread.
 */
class NativeSseClient {

    @Volatile private var running = false
    private var thread: Thread? = null

    fun interface EventListener {
        fun onEvent(data: String)
    }

    fun connect(url: String, token: String?, listener: EventListener) {
        close()
        running = true
        thread = Thread {
            while (running) {
                try {
                    val conn = URL(url).openConnection() as HttpURLConnection
                    conn.setRequestProperty("Accept", "text/event-stream")
                    if (!token.isNullOrBlank()) {
                        conn.setRequestProperty("Authorization", "Bearer $token")
                    }
                    conn.connectTimeout = 10_000
                    conn.readTimeout = 0 // no read timeout for SSE
                    conn.doInput = true

                    val code = conn.responseCode
                    if (code != 200) {
                        Log.e("NativeSse", "SSE connect failed: HTTP $code, url=$url, hasAuth=${conn.getRequestProperty("Authorization") != null}")
                        Thread.sleep(3000)
                        continue
                    }

                    Log.d("NativeSse", "SSE connected to $url")
                    listener.onEvent("""{"type":"__sse_connected"}""")

                    val reader = BufferedReader(InputStreamReader(conn.inputStream, Charsets.UTF_8))
                    var line: String?
                    while (running) {
                        line = reader.readLine()
                        if (line == null) break // stream closed
                        if (line.startsWith("data: ")) {
                            val data = line.substring(6)
                            listener.onEvent(data)
                        }
                        // SSE comments (":") and empty lines are ignored
                    }
                    reader.close()
                    conn.disconnect()
                } catch (e: Exception) {
                    if (!running) break
                    Log.e("NativeSse", "SSE error: ${e.message}")
                }

                if (running) {
                    listener.onEvent("""{"type":"__sse_disconnected"}""")
                    try { Thread.sleep(2000) } catch (_: InterruptedException) { break }
                }
            }
        }.apply {
            isDaemon = true
            name = "kern-sse"
            start()
        }
    }

    fun close() {
        running = false
        thread?.interrupt()
        thread = null
    }
}
