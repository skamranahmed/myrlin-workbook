/**
 * build-terminal-html.js - Generate the terminal HTML asset with inlined xterm.js.
 *
 * Reads @xterm/xterm and @xterm/addon-fit from node_modules, inlines them
 * into a self-contained HTML page, and writes it to assets/terminal.html.
 * This avoids CDN dependency for LAN-only setups.
 *
 * Usage: node scripts/build-terminal-html.js
 *
 * The generated HTML must be checked into source control so the app
 * works without running this script during development.
 */

const fs = require('fs');
const path = require('path');

/** Read a file relative to the mobile directory */
function readModule(relativePath) {
  const fullPath = path.join(__dirname, '..', 'node_modules', relativePath);
  return fs.readFileSync(fullPath, 'utf-8');
}

// Read xterm.js dependencies
const xtermJs = readModule('@xterm/xterm/lib/xterm.js');
const xtermCss = readModule('@xterm/xterm/css/xterm.css');
const fitAddonJs = readModule('@xterm/addon-fit/lib/addon-fit.js');

// Terminal page application logic (the bridge protocol handler)
const appScript = `
    // ── Terminal Setup ────────────────────────────────────────
    var term = new Terminal({
      cursorBlink: false,
      disableStdin: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Courier New', monospace",
      scrollback: 5000,
      allowTransparency: false
    });
    var fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(document.getElementById('terminal'));

    var ws = null;

    // ── Bridge: WebView -> React Native ──────────────────────
    function postToRN(msg) {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify(msg));
      }
    }

    // ── Bridge: React Native -> WebView ──────────────────────
    window.handleRNMessage = function(msg) {
      switch (msg.type) {
        case 'write':
          if (ws && ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'input', data: msg.data }));
          }
          break;

        case 'resize':
          term.resize(msg.cols, msg.rows);
          fitAddon.fit();
          if (ws && ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'resize', cols: msg.cols, rows: msg.rows }));
          }
          break;

        case 'setTheme':
          term.options.theme = msg.theme;
          document.body.style.backgroundColor = msg.theme.background || '#1e1e2e';
          document.getElementById('terminal').style.backgroundColor = msg.theme.background || '#1e1e2e';
          break;

        case 'clear':
          term.clear();
          break;

        case 'connect':
          connectWS(msg.wsUrl, msg.token, msg.sessionId);
          break;

        case 'disconnect':
          if (ws) { try { ws.close(); } catch(_){} ws = null; }
          break;

        case 'dispose':
          if (ws) { try { ws.close(); } catch(_){} ws = null; }
          term.dispose();
          break;

        case 'getSelectedText':
          postToRN({ type: 'selectedText', text: term.getSelection() || '' });
          break;

        case 'getVisibleText':
          var buf = term.buffer.active;
          var visText = '';
          for (var i = 0; i < term.rows; i++) {
            var line = buf.getLine(i + buf.viewportY);
            if (line) visText += line.translateToString(true) + '\\n';
          }
          postToRN({ type: 'visibleText', text: visText });
          break;

        case 'getScrollback':
          var active = term.buffer.active;
          var allText = '';
          for (var j = 0; j < active.length; j++) {
            var sLine = active.getLine(j);
            if (sLine) allText += sLine.translateToString(true) + '\\n';
          }
          postToRN({ type: 'scrollback', text: allText });
          break;

        case 'selectAll':
          term.selectAll();
          break;

        case 'scrollToBottom':
          term.scrollToBottom();
          break;

        case 'focus':
          term.focus();
          break;

        case 'blur':
          term.blur();
          break;
      }
    };

    // ── WebSocket Connection ─────────────────────────────────
    function connectWS(url, authToken, sid) {
      if (ws) { try { ws.close(); } catch(_){} }
      var fullUrl = url + '?token=' + encodeURIComponent(authToken) + '&sessionId=' + sid;
      ws = new WebSocket(fullUrl);

      ws.onopen = function() {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      };

      ws.onmessage = function(e) {
        try {
          var parsed = JSON.parse(e.data);
          if (parsed.type === 'exit') {
            postToRN({ type: 'exit', exitCode: parsed.exitCode || 0 });
            return;
          }
        } catch(_) {}
        // Raw PTY output
        term.write(e.data);
      };

      ws.onclose = function() {
        postToRN({ type: 'disconnected' });
      };

      ws.onerror = function() {
        postToRN({ type: 'disconnected' });
      };
    }

    // ── Terminal Events ──────────────────────────────────────
    term.onBell(function() {
      postToRN({ type: 'bell' });
    });

    term.onTitleChange(function(title) {
      postToRN({ type: 'titleChange', title: title });
    });

    // ── Activity Detection ───────────────────────────────────
    // Parse PTY output for Claude Code activity patterns
    var activityTimer = null;
    term.onData(function(data) {
      // Detect common Claude Code activity indicators from terminal output
      clearTimeout(activityTimer);
      activityTimer = setTimeout(function() {
        postToRN({ type: 'activity', kind: 'idle', detail: '' });
      }, 3000);

      if (data.indexOf('Reading') !== -1) {
        postToRN({ type: 'activity', kind: 'reading', detail: 'Reading files' });
      } else if (data.indexOf('Writing') !== -1) {
        postToRN({ type: 'activity', kind: 'writing', detail: 'Writing files' });
      } else if (data.indexOf('Thinking') !== -1) {
        postToRN({ type: 'activity', kind: 'thinking', detail: 'Thinking' });
      }
    });

    // ── ResizeObserver ───────────────────────────────────────
    var resizeObserver = new ResizeObserver(function() {
      try {
        fitAddon.fit();
        postToRN({ type: 'dimensions', cols: term.cols, rows: term.rows });
      } catch(_) {}
    });
    resizeObserver.observe(document.body);

    // ── Init: Double-rAF Fit Pattern ─────────────────────────
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        fitAddon.fit();
        postToRN({ type: 'ready' });
        postToRN({ type: 'dimensions', cols: term.cols, rows: term.rows });
      });
    });
`;

// Build the complete HTML
const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, #terminal { width: 100%; height: 100%; overflow: hidden; background: #1e1e2e; }
    /* Prevent text selection and long-press context menus */
    body { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
  </style>
  <style>${xtermCss}</style>
  <script>${xtermJs}</script>
  <script>${fitAddonJs}</script>
</head>
<body>
  <div id="terminal"></div>
  <script>${appScript}</script>
</body>
</html>`;

// Write to assets directory
const outputPath = path.join(__dirname, '..', 'assets', 'terminal.html');
fs.writeFileSync(outputPath, html, 'utf-8');

const sizeKb = Math.round(html.length / 1024);
console.log('Generated assets/terminal.html (' + sizeKb + 'KB)');
console.log('  xterm.js: ' + Math.round(xtermJs.length / 1024) + 'KB');
console.log('  xterm.css: ' + Math.round(xtermCss.length / 1024) + 'KB');
console.log('  addon-fit: ' + Math.round(fitAddonJs.length / 1024) + 'KB');
console.log('  app logic: ' + Math.round(appScript.length / 1024) + 'KB');
