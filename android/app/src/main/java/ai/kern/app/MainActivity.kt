package ai.kern.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.android.material.textfield.TextInputEditText

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var setupScreen: View
    private lateinit var speech: SpeechService

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        setupScreen = findViewById(R.id.setupScreen)
        speech = SpeechService(this)
        speech.initTts()

        setupWebView()

        // Handle deep link: kern://connect?url=...&token=...
        intent?.data?.let { uri -> handleDeepLink(uri) } ?: showSetupOrReconnect()

        // Setup screen connect button
        findViewById<Button>(R.id.connectBtn).setOnClickListener { onConnectClicked() }
    }

    private fun showSetupOrReconnect() {
        val savedUrl = ConnectionConfig.getUrl(this)
        if (savedUrl != null) {
            connect(savedUrl, ConnectionConfig.getToken(this))
        } else {
            showSetup()
        }
    }

    private fun handleDeepLink(uri: Uri) {
        val url = uri.getQueryParameter("url") ?: return showSetup()
        val token = uri.getQueryParameter("token")
        ConnectionConfig.save(this, url, token)
        connect(url, token)
    }

    private fun onConnectClicked() {
        val urlInput = findViewById<TextInputEditText>(R.id.serverUrlInput)
        val tokenInput = findViewById<TextInputEditText>(R.id.tokenInput)
        val url = urlInput.text?.toString()?.trim() ?: return
        if (url.isEmpty()) return
        val token = tokenInput.text?.toString()?.trim()?.ifEmpty { null }

        ConnectionConfig.save(this, url, token)
        connect(url, token)
    }

    private fun showSetup() {
        webView.visibility = View.GONE
        setupScreen.visibility = View.VISIBLE

        // Pre-fill saved values
        ConnectionConfig.getUrl(this)?.let {
            findViewById<TextInputEditText>(R.id.serverUrlInput).setText(it)
        }
        ConnectionConfig.getToken(this)?.let {
            findViewById<TextInputEditText>(R.id.tokenInput).setText(it)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // Keep navigation inside the WebView for same-origin
                return false
            }

            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                injectNativeBridgeUi()
            }
        }

        webView.webChromeClient = WebChromeClient()

        // Attach the native bridge
        val bridge = NativeBridge(webView, speech) { runOnUiThread { disconnect() } }
        webView.addJavascriptInterface(bridge, "KernNative")
    }

    private fun connect(url: String, token: String?) {
        ensureMicPermission()
        setupScreen.visibility = View.GONE
        webView.visibility = View.VISIBLE
        webView.loadUrl(ConnectionConfig.buildWebUrl(url, token))
    }

    private fun disconnect() {
        webView.loadUrl("about:blank")
        ConnectionConfig.clear(this)
        showSetup()
    }

    /**
     * Inject a mic button and TTS toggle into the web UI's input row.
     * Only runs if KernNative bridge is detected.
     */
    private fun injectNativeBridgeUi() {
        val js = """
        (function() {
            if (!window.KernNative || document.getElementById('kern-mic-btn')) return;

            var inputRow = document.querySelector('.input-row');
            if (!inputRow) return;
            var sendBtn = inputRow.querySelector('button');
            var inputEl = document.getElementById('input');

            // --- Mic button ---
            var micBtn = document.createElement('button');
            micBtn.id = 'kern-mic-btn';
            micBtn.textContent = '\uD83C\uDF99';
            micBtn.title = 'Voice input';
            micBtn.style.cssText = 'background:transparent;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:18px;cursor:pointer;margin-right:4px;color:var(--text);';
            inputRow.insertBefore(micBtn, inputEl);

            var listening = false;
            micBtn.addEventListener('click', function() {
                if (listening) {
                    KernNative.stopListening();
                    micBtn.style.borderColor = 'var(--border)';
                    micBtn.style.background = 'transparent';
                    listening = false;
                } else {
                    KernNative.startListening();
                    micBtn.style.borderColor = 'var(--red)';
                    micBtn.style.background = 'rgba(248,81,73,0.1)';
                    listening = true;
                }
            });

            window.onKernSpeechResult = function(text) {
                inputEl.value = text;
                inputEl.dispatchEvent(new Event('input'));
            };
            window.onKernSpeechError = function(msg) {
                micBtn.style.borderColor = 'var(--border)';
                micBtn.style.background = 'transparent';
                listening = false;
            };

            // --- TTS toggle ---
            var ttsBtn = document.createElement('button');
            ttsBtn.id = 'kern-tts-btn';
            ttsBtn.textContent = '\uD83D\uDD07';
            ttsBtn.title = 'Read responses aloud';
            ttsBtn.style.cssText = 'background:transparent;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:18px;cursor:pointer;color:var(--text);position:absolute;right:8px;top:8px;';

            var header = document.querySelector('.header');
            if (header) {
                header.style.position = 'relative';
                header.appendChild(ttsBtn);
            }

            window._kernTtsEnabled = false;
            ttsBtn.addEventListener('click', function() {
                window._kernTtsEnabled = !window._kernTtsEnabled;
                ttsBtn.textContent = window._kernTtsEnabled ? '\uD83D\uDD0A' : '\uD83D\uDD07';
                ttsBtn.style.borderColor = window._kernTtsEnabled ? 'var(--green)' : 'var(--border)';
                if (!window._kernTtsEnabled) KernNative.stopSpeaking();
            });

            // Hook into message rendering to auto-speak assistant responses
            var origAddMessage = window.addMessage;
            if (origAddMessage) {
                window.addMessage = function(type, text, meta) {
                    origAddMessage(type, text, meta);
                    if (type === 'assistant' && window._kernTtsEnabled && text) {
                        KernNative.speak(text);
                    }
                };
            }
        })();
        """.trimIndent()
        webView.evaluateJavascript(js, null)
    }

    private fun ensureMicPermission() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.RECORD_AUDIO), 1)
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.visibility == View.VISIBLE && webView.canGoBack()) {
            webView.goBack()
        } else {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        speech.destroy()
        webView.destroy()
        super.onDestroy()
    }
}
