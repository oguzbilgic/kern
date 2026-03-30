package ai.kern.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.util.Log
import android.view.View
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.android.material.textfield.TextInputEditText

class MainActivity : AppCompatActivity() {

    companion object {
        const val BUILD = 35
    }

    private lateinit var webView: WebView
    private lateinit var setupScreen: View
    private lateinit var speech: SpeechService
    private val sseClient = NativeSseClient()
    // Current agent SSE connection info (set by switchAgent bridge call)
    private var agentUrl: String? = null
    private var agentToken: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        setupScreen = findViewById(R.id.setupScreen)
        speech = SpeechService(this)
        speech.initTts()

        setupWebView()

        // Deep link: kern://connect?url=https://...
        intent?.data?.let { uri ->
            uri.getQueryParameter("url")?.let { url ->
                ConnectionConfig.save(this, url)
                connect(url)
            } ?: showSetup()
        } ?: run {
            // Auto-reconnect to saved URL
            val savedUrl = ConnectionConfig.getUrl(this)
            if (savedUrl != null) connect(savedUrl) else showSetup()
        }

        findViewById<Button>(R.id.connectBtn).setOnClickListener {
            val url = findViewById<TextInputEditText>(R.id.serverUrlInput).text?.toString()?.trim() ?: return@setOnClickListener
            if (url.isEmpty()) return@setOnClickListener
            ConnectionConfig.save(this, url)
            connect(url)
        }
    }

    private fun showSetup() {
        sseClient.close()
        webView.visibility = View.GONE
        setupScreen.visibility = View.VISIBLE
        ConnectionConfig.getUrl(this)?.let {
            findViewById<TextInputEditText>(R.id.serverUrlInput).setText(it)
        }
    }

    /**
     * JS bridge script injected after page loads.
     * Intercepts EventSource and AgentClient.connect so native SSE handles streaming.
     * Adds voice input, TTS, and UI enhancements.
     */
    private fun bridgeScript(): String = """
// --- kern native bridge (build $BUILD) ---
(function() {
    // Kill EventSource — native SSE handles all streaming
    window.EventSource = function(url) {
        console.log('[kern-native] EventSource blocked: ' + url);
        this.close = function(){};
        this.readyState = 2;
    };
    window.EventSource.CONNECTING = 0;
    window.EventSource.OPEN = 1;
    window.EventSource.CLOSED = 2;

    window._kernNativeBuild = $BUILD;

    // Wait for page script to define AgentClient, then patch
    var _patchInterval = setInterval(function() {
        if (!window.AgentClient) return;
        clearInterval(_patchInterval);
        if (window._kernPatched) return;
        window._kernPatched = true;

        // Close any existing SSE connection from page init
        if (window._kern && window._kern.connection) {
            window._kern.connection.close();
            window._kern.connection = { close: function(){} };
        }

        // Track current agent to detect switches vs reconnects
        var _currentAgentUrl = null;

        // Intercept SSE connections — route to native
        window.AgentClient.connect = function(baseUrl, token, opts) {
            console.log('[kern-native] SSE connect: ' + baseUrl);
            window._kernSseOpts = opts;
            if (baseUrl !== _currentAgentUrl) {
                _currentAgentUrl = baseUrl;
                if (window.KernNative && window.KernNative.switchAgent) {
                    KernNative.switchAgent(baseUrl, token || '');
                }
            }
            return { close: function(){} };
        };

        // Allow init() once per agent, skip reconnect loops
        var _origInit = window.init;
        var _initForAgent = null;
        window.init = function() {
            var base = window.BASE_URL || '';
            if (_initForAgent === base) return;
            _initForAgent = base;
            _origInit && _origInit();
        };

        // Strip leading/trailing <br> from rendered markdown
        var _origRM = window.renderMarkdown;
        if (_origRM) {
            window.renderMarkdown = function(text) {
                return _origRM(text).replace(/^(<br>)+/, '').replace(/(<br>)+$/, '');
            };
        }

        // Trim leading newlines + TTS on finish
        var _origHE = window.handleEvent;
        if (_origHE) {
            window.handleEvent = function(ev) {
                if (ev.type === 'text-delta' && ev.text && window._kern && !window._kern.streamingText) {
                    ev.text = ev.text.replace(/^\n+/, '');
                    if (!ev.text) return;
                }
                var textToSpeak = (ev.type === 'finish' && window._kern) ? window._kern.streamingText : '';
                var result = _origHE(ev);
                if (ev.type === 'finish' && window._kernTtsEnabled && textToSpeak) {
                    KernNative.speak(textToSpeak);
                }
                return result;
            };
        }

        // Native SSE callbacks
        window._kernNativeSseReady = function() {
            if (window.setConnected) window.setConnected('connected');
        };
        window._kernNativeSseDisconnected = function() {
            if (window.setConnected) window.setConnected('disconnected');
        };

        // Build number on agent name
        var an = document.getElementById('agent-name');
        if (an) {
            new MutationObserver(function(_, obs) {
                if (an.textContent && an.textContent !== 'kern' && an.textContent.indexOf('b$BUILD') === -1) {
                    an.textContent = an.textContent + ' [b$BUILD]';
                    obs.disconnect();
                }
            }).observe(an, { childList: true, characterData: true, subtree: true });
        }

        // --- Voice: mic button (tap=dictate, hold=voice mode) ---
        var inputRow = document.querySelector('.input-row');
        var inputEl = document.getElementById('input');
        if (inputRow && inputEl && window.KernNative) {
            var micBtn = document.createElement('button');
            micBtn.id = 'kern-mic-btn';
            micBtn.textContent = '\uD83C\uDF99';
            micBtn.style.cssText = 'background:transparent;border:1px solid var(--border);border-radius:6px;padding:6px 7px;font-size:16px;cursor:pointer;margin-right:2px;color:var(--text);flex-shrink:0;-webkit-user-select:none;';
            inputRow.insertBefore(micBtn, inputEl);

            var listening = false, voiceMode = false, longPressTimer = null, wasLongPress = false;

            function setMicUI(active) {
                listening = active;
                micBtn.style.borderColor = voiceMode ? 'var(--green)' : (active ? 'var(--red)' : 'var(--border)');
                micBtn.style.background = voiceMode ? (active ? 'rgba(63,185,80,0.2)' : 'rgba(63,185,80,0.1)') : (active ? 'rgba(248,81,73,0.1)' : 'transparent');
                micBtn.textContent = voiceMode ? (active ? '\uD83C\uDF99' : '\uD83D\uDD0A') : '\uD83C\uDF99';
            }

            function setVoiceMode(active) {
                voiceMode = active;
                window._kernTtsEnabled = active;
                if (active) { startVoiceListening(); } else { KernNative.stopListening(); KernNative.stopSpeaking(); setMicUI(false); }
            }

            function startVoiceListening() { if (!voiceMode) return; setMicUI(true); KernNative.startListening(); }

            var voiceCommands = {
                'stop voice mode': function() { setVoiceMode(false); },
                'stop listening': function() { setVoiceMode(false); },
                'voice off': function() { setVoiceMode(false); },
                'stop': function() { KernNative.stopSpeaking(); setVoiceMode(false); },
            };

            function checkVoiceCommand(text) {
                var lower = (text || '').toLowerCase().replace(/[.,!?;:]/g, '').trim();
                for (var cmd in voiceCommands) { if (lower === cmd || lower.indexOf(cmd) !== -1) { voiceCommands[cmd](); inputEl.value = ''; inputEl.dispatchEvent(new Event('input')); return true; } }
                return false;
            }

            micBtn.addEventListener('touchstart', function(e) { e.preventDefault(); wasLongPress = false; longPressTimer = setTimeout(function() { wasLongPress = true; setVoiceMode(!voiceMode); }, 600); });
            micBtn.addEventListener('touchend', function(e) {
                e.preventDefault(); clearTimeout(longPressTimer); if (wasLongPress) return;
                if (KernNative.isSpeaking()) { KernNative.stopSpeaking(); if (voiceMode) startVoiceListening(); return; }
                if (voiceMode) { setVoiceMode(false); } else if (listening) { KernNative.stopListening(); setMicUI(false); } else { KernNative.startListening(); setMicUI(true); }
            });
            micBtn.addEventListener('touchcancel', function() { clearTimeout(longPressTimer); });

            window.onKernSpeechPartial = function(text) { inputEl.value = text; inputEl.dispatchEvent(new Event('input')); };
            window.onKernSpeechResult = function(text) {
                setMicUI(false);
                if (voiceMode) { if (checkVoiceCommand(text)) return; if (text && text.trim()) { inputEl.value = text.trim(); inputEl.dispatchEvent(new Event('input')); if (window.send) window.send(); } else { startVoiceListening(); } }
                else { inputEl.value = text; inputEl.dispatchEvent(new Event('input')); }
            };
            window.onKernSpeechError = function(msg) { setMicUI(false); if (voiceMode && msg !== 'Microphone permission required') startVoiceListening(); };
            window.onKernTtsDone = function() { if (voiceMode) startVoiceListening(); };
        }

        window._kernTtsEnabled = false;

        console.log('[kern-native] injection complete, build $BUILD');
    }, 50);

    // Mobile overflow: prevent horizontal scroll, wrap long content
    var css = document.createElement('style');
    css.textContent = 'html, body { overflow-x: hidden !important; max-width: 100vw; } pre, code { overflow-x: auto; max-width: calc(100vw - 32px); white-space: pre-wrap; word-break: break-word; }';
    document.head.appendChild(css);

})();
"""

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView.isHorizontalScrollBarEnabled = false
        webView.setOnScrollChangeListener { _, scrollX, _, _, _ ->
            if (scrollX != 0) webView.scrollTo(0, webView.scrollY)
        }
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            cacheMode = android.webkit.WebSettings.LOAD_NO_CACHE
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = false

            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                if (url == "about:blank") return
                Log.d("KernWebView", "onPageFinished: $url")
                view.evaluateJavascript(bridgeScript(), null)
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: android.webkit.WebResourceError) {
                Log.e("KernWebView", "Error: ${request.url}: ${error.description}")
            }

            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
                Log.e("KernWebView", "HTTP ${response.statusCode}: ${request.url}")
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(msg: ConsoleMessage): Boolean {
                Log.d("KernWebView", "${msg.messageLevel()}: ${msg.message()} [${msg.sourceId()}:${msg.lineNumber()}]")
                return true
            }
        }

        val bridge = NativeBridge(webView, speech,
            onDisconnect = { runOnUiThread { disconnect() } },
            onSwitchAgent = { url, token -> runOnUiThread { switchAgentSse(url, token) } }
        )
        webView.addJavascriptInterface(bridge, "KernNative")
    }

    private fun connect(url: String) {
        ensureMicPermission()
        setupScreen.visibility = View.GONE
        webView.visibility = View.VISIBLE
        webView.loadUrl(url.trimEnd('/'))
    }

    private fun disconnect() {
        sseClient.close()
        webView.loadUrl("about:blank")
        ConnectionConfig.clear(this)
        showSetup()
    }

    /** Called by bridge when web UI connects to an agent */
    private fun switchAgentSse(url: String, token: String?) {
        sseClient.close()
        agentUrl = url.trimEnd('/')
        agentToken = if (token.isNullOrBlank()) null else token
        startNativeSse()
    }

    private fun startNativeSse() {
        val base = agentUrl ?: return
        val token = agentToken
        val eventsUrl = if (token != null) "$base/events?token=${Uri.encode(token)}" else "$base/events"

        sseClient.connect(eventsUrl, token) { data ->
            runOnUiThread {
                val b64 = Base64.encodeToString(data.toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
                webView.evaluateJavascript(
                    "(function(){ try { " +
                    "var b=atob('$b64');" +
                    "var bytes=new Uint8Array(b.length);" +
                    "for(var i=0;i<b.length;i++) bytes[i]=b.charCodeAt(i);" +
                    "var json=new TextDecoder().decode(bytes);" +
                    "var ev=JSON.parse(json);" +
                    "if (ev.type === '__sse_connected') { if (window._kernNativeSseReady) window._kernNativeSseReady(); }" +
                    " else if (ev.type === '__sse_disconnected') { if (window._kernNativeSseDisconnected) window._kernNativeSseDisconnected(); }" +
                    " else { if (window.handleEvent) window.handleEvent(ev); }" +
                    " } catch(e) { console.log('SSE inject error: ' + e); } })();",
                    null
                )
            }
        }
    }

    private fun ensureMicPermission() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.RECORD_AUDIO), 1)
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.visibility == View.VISIBLE && webView.canGoBack()) webView.goBack()
        else @Suppress("DEPRECATION") super.onBackPressed()
    }

    override fun onDestroy() {
        sseClient.close()
        speech.destroy()
        webView.destroy()
        super.onDestroy()
    }
}
