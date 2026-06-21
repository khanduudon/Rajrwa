const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors());
const PORT = process.env.PORT || 3000;

// Proxy for .m3u8 playlists
app.get('/proxy', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { url } = req.query;
  if (!url) return res.status(400).send('Missing url parameter');

  try {
    const response = await axios.get(url, {
      headers: {
        "accept": "*/*",
        "Referer": "https://appx-play.akamai.net.in/"
      }
    });

    const base = url.substring(0, url.lastIndexOf('/') + 1);
    const playlist = response.data.replace(
      /^(?!#)([^\r\n]+)$/gm,
      (line) => {
        if (line.startsWith('http') || line.startsWith('#')) return line;
        return `/segment?base=${encodeURIComponent(base)}&file=${encodeURIComponent(line)}`;
      }
    );

    res.setHeader('content-type', 'application/vnd.apple.mpegurl');
    res.send(playlist);
  } catch (err) {
    console.error('Error fetching playlist:', err.message);
    res.status(500).send('Proxy error: ' + err.message);
  }
});

// Proxy for .ts segments
app.get('/segment', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { base, file } = req.query;
  if (!base || !file) return res.status(400).send('Missing base or file parameter');

  const segmentUrl = base + file;
  try {
    const response = await axios.get(segmentUrl, {
      headers: {
        "accept": "*/*",
        "Referer": "https://appx-play.akamai.net.in/"
      },
      responseType: 'stream'
    });

    res.status(response.status);
    for (const [key, value] of Object.entries(response.headers)) {
      res.setHeader(key, value);
    }
    response.data.pipe(res);
  } catch (err) {
    console.error('Error fetching segment:', err.message);
    res.status(500).send('Proxy error: ' + err.message);
  }
});

// ── /pdf → CORS Proxy for PDFs (server-side fetch) ──────────────
app.get('/pdf', async (req, res) => {
  let pdfUrl = req.query.url || '';
  if (!pdfUrl) return res.status(400).send('Missing url parameter');

  // 🔧 Clean control characters (0x00–0x1F) from URL
  pdfUrl = pdfUrl.replace(/[\x00-\x1F]+/g, '').trim();

  try {
    const response = await axios.get(pdfUrl, {
      responseType: 'stream',
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125',
        'Referer': 'https://static-db-v2.appx.co.in/',
        'Accept': 'application/pdf,*/*',
      },
    });

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'public, max-age=86400');

    // Forward relevant headers
    if (response.headers['content-length'])
      res.setHeader('Content-Length', response.headers['content-length']);

    response.data.pipe(res);
  } catch (err) {
    console.error('PDF proxy error:', err.message);
    res.status(502).send('PDF fetch failed: ' + err.message);
  }
});

// ── /pdf-viewer → HTML PDF viewer (uses /pdf proxy) ──────────
app.get('/pdf-viewer', (req, res) => {
  let pdfUrl = req.query.url || '';
  if (!pdfUrl) return res.status(400).send('Missing url parameter');

  // Clean control chars
  pdfUrl = pdfUrl.replace(/[\x00-\x1F]+/g, '').trim();

  // ⚡ Route through /pdf proxy to bypass CORS
  const proxiedUrl = '/pdf?url=' + encodeURIComponent(pdfUrl);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <title>PDF Viewer — RWA</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:100%;height:100%;overflow:hidden;background:#1a1a1a;font-family:system-ui,sans-serif}
    #viewer-container{width:100%;height:100%;display:flex;flex-direction:column}
    #toolbar{
      background:linear-gradient(135deg,#1e1e2e,#2d2d44);
      padding:10px 16px;display:flex;align-items:center;justify-content:space-between;
      box-shadow:0 2px 10px rgba(0,0,0,0.4);z-index:10;flex-shrink:0;
    }
    #toolbar .title{color:#fff;font-size:14px;font-weight:600;display:flex;align-items:center;gap:8px}
    #toolbar .title::before{content:'📄';font-size:16px}
    #toolbar .actions{display:flex;gap:8px}
    #toolbar button{
      background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.15);
      color:#fff;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:13px;
      transition:all 0.2s;display:flex;align-items:center;gap:5px;
    }
    #toolbar button:hover{background:rgba(255,255,255,0.2);transform:translateY(-1px)}
    #loading{
      position:fixed;inset:0;background:rgba(0,0,0,0.85);display:flex;
      flex-direction:column;align-items:center;justify-content:center;
      color:#fff;z-index:100;gap:16px;
    }
    #loading .spinner{
      width:48px;height:48px;border:4px solid rgba(255,255,255,0.15);
      border-top-color:#ff2d55;border-radius:50%;animation:spin 0.8s linear infinite;
    }
    @keyframes spin{to{transform:rotate(360deg)}}
    #loading .msg{font-size:14px;opacity:0.8}
    iframe{flex:1;width:100%;border:none;background:#525659}
    #error{
      position:fixed;inset:0;background:#1a1a1a;color:#ff4444;
      display:none;flex-direction:column;align-items:center;justify-content:center;
      gap:12px;font-size:15px;z-index:200;
    }
    #error .icon{font-size:48px}
  </style>
</head>
<body>
  <div id="loading">
    <div class="spinner"></div>
    <div class="msg">Loading PDF...</div>
  </div>
  <div id="error">
    <div class="icon">⚠️</div>
    <div id="error-msg">Failed to load PDF</div>
    <button onclick="location.reload()" style="margin-top:10px;padding:8px 20px;background:#ff2d55;color:#fff;border:none;border-radius:6px;cursor:pointer">Retry</button>
  </div>

  <div id="viewer-container">
    <div id="toolbar">
      <div class="title">PDF Document</div>
      <div class="actions">
        <button onclick="downloadPdf()">⬇ Download</button>
        <button onclick="openNew()">↗ Open</button>
      </div>
    </div>
    <iframe id="pdf-frame" src="${proxiedUrl}" allowfullscreen></iframe>
  </div>

  <script>
    const frame = document.getElementById('pdf-frame');
    const loading = document.getElementById('loading');
    const errorDiv = document.getElementById('error');
    const errorMsg = document.getElementById('error-msg');
    const pdfUrl = \`${pdfUrl.replace(/'/g, "\\'")}\`;

    frame.onload = () => { loading.style.display = 'none'; };
    frame.onerror = () => { showError('PDF failed to load'); };

    // Timeout fallback
    setTimeout(() => {
      if (loading.style.display !== 'none') {
        try {
          if (!frame.contentWindow.document.body.innerHTML) showError('Timeout');
        } catch(e) { loading.style.display = 'none'; }
      }
    }, 15000);

    function showError(msg) {
      loading.style.display = 'none';
      errorMsg.textContent = msg;
      errorDiv.style.display = 'flex';
    }

    function downloadPdf() {
      const a = document.createElement('a');
      a.href = '/pdf?url=' + encodeURIComponent(pdfUrl);
      a.download = 'document.pdf';
      a.click();
    }

    function openNew() {
      window.open('/pdf?url=' + encodeURIComponent(pdfUrl), '_blank');
    }
  </script>
</body>
</html>`;

  res.send(html);
});

// ==================== GOD-LEVEL PLAYER ====================
app.get('/player', (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).send(`
      <html>
        <body style="background:black;color:white;display:flex;justify-content:center;align-items:center;height:100vh;">
          <h1>Missing URL parameter - Usage: /player?url=STREAM_URL</h1>
        </body>
      </html>
    `);
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Mr. Kagra x RWA</title>
  <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
  <style>
    :root {
      --primary: #ff2d55;
      --text: #ffffff;
      --bg-glass: rgba(20, 20, 20, 0.55);
      --blur: 12px;
      --control-size: 32px;
      --icon-size: 18px;
      --radius: 8px;
    }
    
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      background: #000;
      color: var(--text);
      overflow: hidden;
      height: 100vh;
      width: 100vw;
    }
    
    #player-container {
      position: fixed;
      inset: 0;
      background: #000;
      display: flex;
      justify-content: center;
      align-items: center;
      overflow: hidden;
    }
    
    #video {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    
    #loading {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      color: white;
      font-size: 1rem;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 15px;
      z-index: 10;
      opacity: 0.9;
    }
    
    .spinner {
      animation: spin 1s linear infinite;
      font-size: 2rem;
    }
    
    @keyframes spin { 100% { transform: rotate(360deg); } }
    
    /* Controls Container */
    .controls {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      padding: 12px 16px 16px;
      background: linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 100%);
      backdrop-filter: blur(var(--blur));
      -webkit-backdrop-filter: blur(var(--blur));
      display: flex;
      flex-direction: column;
      gap: 10px;
      z-index: 5;
      transition: opacity 0.3s ease, transform 0.3s ease;
      opacity: 1;
      transform: translateY(0);
    }
    
    .controls.hidden {
      opacity: 0;
      transform: translateY(10px);
      pointer-events: none;
    }
    
    /* Progress */
    .progress-container {
      width: 100%;
      height: 4px;
      background: rgba(255,255,255,0.15);
      cursor: pointer;
      position: relative;
      border-radius: 2px;
      overflow: visible;
    }
    
    #progress-bar {
      height: 100%;
      background: var(--primary);
      width: 0%;
      border-radius: 2px;
      position: relative;
      z-index: 2;
      transition: width 0.1s linear;
    }
    
    #buffer-bar {
      position: absolute;
      top: 0;
      left: 0;
      height: 100%;
      background: rgba(255,255,255,0.25);
      width: 0%;
      border-radius: 2px;
      z-index: 1;
    }
    
    #progress-handle {
      position: absolute;
      top: 50%;
      transform: translate(-50%, -50%);
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: white;
      box-shadow: 0 0 6px rgba(255,45,85,0.7);
      z-index: 10;
      pointer-events: none;
      transition: transform 0.1s ease;
    }
    
    /* Main Row */
    .main-controls {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      gap: 12px;
    }
    
    .left-controls, .right-controls {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: nowrap;
    }
    
    /* Compact Buttons */
    .control-btn {
      background: rgba(255, 255, 255, 0.1);
      border: none;
      color: white;
      font-size: var(--icon-size);
      cursor: pointer;
      width: var(--control-size);
      height: var(--control-size);
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      transition: background 0.2s, transform 0.2s;
      position: relative;
    }
    
    .control-btn:hover {
      background: rgba(255, 255, 255, 0.25);
      transform: scale(1.05);
    }
    
    .control-btn .material-icons {
      font-size: var(--icon-size);
    }
    
    /* Skip Buttons with tiny badge */
    .skip-btn::after {
      content: '10';
      position: absolute;
      top: -2px;
      right: -2px;
      font-size: 8px;
      color: white;
      background: var(--primary);
      border-radius: 50%;
      width: 14px;
      height: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      line-height: 1;
    }
    
    /* Time Display */
    .time-display {
      font-size: 0.8rem;
      min-width: 80px;
      text-align: center;
      color: rgba(255,255,255,0.9);
      padding: 4px 8px;
      background: rgba(255,255,255,0.1);
      border-radius: 4px;
    }
    
    /* Volume */
    .volume-container {
      display: flex;
      align-items: center;
      gap: 4px;
      width: auto;
    }
    
    #volume-slider {
      width: 60px;
      height: 3px;
      -webkit-appearance: none;
      background: rgba(255,255,255,0.2);
      border-radius: 2px;
      cursor: pointer;
      outline: none;
    }
    
    #volume-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: white;
      border: 2px solid #8B5CF6;
      box-shadow: 0 1px 4px rgba(0,0,0,0.3);
    }
    
    /* Settings Menu */
    .settings-menu {
      position: relative;
    }
    
    .settings-dropdown {
      position: absolute;
      bottom: 40px;
      right: 0;
      background: rgba(20, 20, 20, 0.9);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border-radius: var(--radius);
      padding: 4px 0;
      width: 130px;
      opacity: 0;
      transform: translateY(5px) scale(0.95);
      pointer-events: none;
      transition: all 0.2s ease;
      border: 1px solid rgba(255,255,255,0.1);
      box-shadow: 0 8px 24px rgba(0,0,0,0.5);
    }
    
    .settings-menu.active .settings-dropdown {
      opacity: 1;
      transform: translateY(0) scale(1);
      pointer-events: all;
    }
    
    .settings-item {
      padding: 6px 14px;
      font-size: 0.8rem;
      cursor: pointer;
      color: #ccc;
      display: flex;
      align-items: center;
      justify-content: space-between;
      transition: background 0.15s;
    }
    
    .settings-item:hover {
      background: rgba(255,255,255,0.1);
      color: white;
    }
    
    .settings-item.selected {
      color: var(--primary);
      font-weight: 600;
    }
    
    /* Lock Button */
    #lock-btn {
      position: absolute;
      right: 12px;
      top: 50%;
      transform: translateY(-50%);
      background: rgba(255, 215, 0, 0.15);
      color: #FFD700;
      z-index: 20;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s;
      width: 30px;
      height: 30px;
    }
    
    #lock-btn .material-icons {
      font-size: 16px;
    }
    
    #lock-btn.visible {
      opacity: 1;
      pointer-events: all;
    }
    
    /* Small tweaks for mobile */
    @media (max-width: 600px) {
      .left-controls, .right-controls {
        gap: 4px;
      }
      .time-display {
        font-size: 0.7rem;
        min-width: 65px;
      }
      #volume-slider {
        width: 50px;
      }
    }
  </style>
</head>
<body>
  <div id="player-container">
    <video id="video" playsinline></video>
    <div id="loading">
      <span class="material-icons spinner">autorenew</span>
      <span>Loading Stream...</span>
    </div>
    
    <!-- Lock Button -->
    <button class="control-btn" id="lock-btn" title="Lock Controls">
      <span class="material-icons">lock</span>
    </button>
    
    <div class="controls">
      <div class="progress-container" id="progress-container">
        <div id="buffer-bar"></div>
        <div id="progress-bar"></div>
        <div id="progress-handle"></div>
      </div>
      
      <div class="main-controls">
        <div class="left-controls">
          <button class="control-btn" id="play-btn">
            <span class="material-icons">play_arrow</span>
          </button>
          
          <button class="control-btn skip-btn" id="rewind-btn">
            <span class="material-icons">replay_10</span>
          </button>
          
          <button class="control-btn skip-btn" id="forward-btn">
            <span class="material-icons">forward_10</span>
          </button>
          
          <div class="volume-container">
            <button class="control-btn" id="volume-btn">
              <span class="material-icons">volume_up</span>
            </button>
            <input type="range" id="volume-slider" min="0" max="1" step="0.01" value="1">
          </div>
          
          <div class="time-display" id="time-display">0:00 / 0:00</div>
        </div>
        
        <div class="right-controls">
          <div class="settings-menu" id="settings-menu">
            <button class="control-btn" id="settings-btn">
              <span class="material-icons">settings</span>
            </button>
            <div class="settings-dropdown" id="settings-dropdown">
              <div class="settings-item" data-speed="0.25">0.25x</div>
              <div class="settings-item" data-speed="0.5">0.5x</div>
              <div class="settings-item" data-speed="0.75">0.75x</div>
              <div class="settings-item selected" data-speed="1">1x</div>
              <div class="settings-item" data-speed="1.25">1.25x</div>
              <div class="settings-item" data-speed="1.5">1.5x</div>
              <div class="settings-item" data-speed="2">2x</div>
              <div class="settings-item" data-speed="3">3x</div>
              <div class="settings-item" data-speed="4">4x</div>
            </div>
          </div>
          
          <button class="control-btn" id="fullscreen-btn">
            <span class="material-icons">fullscreen</span>
          </button>
        </div>
      </div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
  <script defer src="https://vercel.com/analytics/script.js"></script>
  
  <script>
    (function() {
      const video = document.getElementById('video');
      const loading = document.getElementById('loading');
      const playBtn = document.getElementById('play-btn');
      const rewindBtn = document.getElementById('rewind-btn');
      const forwardBtn = document.getElementById('forward-btn');
      const volumeBtn = document.getElementById('volume-btn');
      const volumeSlider = document.getElementById('volume-slider');
      const lockBtn = document.getElementById('lock-btn');
      const fullscreenBtn = document.getElementById('fullscreen-btn');
      const settingsBtn = document.getElementById('settings-btn');
      const settingsMenu = document.getElementById('settings-menu');
      const settingsDropdown = document.getElementById('settings-dropdown');
      const progressContainer = document.getElementById('progress-container');
      const progressBar = document.getElementById('progress-bar');
      const bufferBar = document.getElementById('buffer-bar');
      const progressHandle = document.getElementById('progress-handle');
      const timeDisplay = document.getElementById('time-display');
      const playerContainer = document.getElementById('player-container');
      const controls = document.querySelector('.controls');
      
      let hls, hideControlsTimeout, hideLockButtonTimeout;
      let controlsLocked = false, isDragging = false, isSettingsOpen = false;
      const url = new URLSearchParams(window.location.search).get('url');
      
      function initPlayer() {
        if (!url) {
          loading.innerHTML = '<span class="material-icons">error</span> Missing URL';
          return;
        }
        
        if (Hls.isSupported()) {
          hls = new Hls({ maxBufferLength: 600, maxMaxBufferLength: 1800, maxBufferSize: 60*1000*1000 });
          hls.loadSource('/proxy?url=' + encodeURIComponent(url));
          hls.attachMedia(video);
          
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            loading.style.display = 'none';
            video.play().catch(() => { loading.innerHTML = '<span class="material-icons">play_circle</span> Tap to play'; loading.onclick = () => { video.play(); loading.style.display = 'none'; }; });
            showControls();
          });
          
          hls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) loading.innerHTML = '<span class="material-icons">error</span> Stream Error';
          });
          
          hls.on(Hls.Events.FRAG_BUFFERED, updateBufferBar);
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = '/proxy?url=' + encodeURIComponent(url);
          video.addEventListener('loadedmetadata', () => {
            loading.style.display = 'none';
            video.play().catch(() => {});
            showControls();
          });
        } else {
          loading.innerHTML = '<span class="material-icons">block</span> HLS not supported';
        }
      }
      
      function showControls() {
        if (!controlsLocked) {
          controls.classList.remove('hidden');
          clearTimeout(hideControlsTimeout);
          hideControlsTimeout = setTimeout(() => { if (!video.paused && !isSettingsOpen && !controlsLocked) controls.classList.add('hidden'); }, 3000);
        }
        if (!controlsLocked) {
          lockBtn.classList.add('visible');
          clearTimeout(hideLockButtonTimeout);
          hideLockButtonTimeout = setTimeout(() => lockBtn.classList.remove('visible'), 3000);
        }
      }
      
      // Lock logic
      lockBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        controlsLocked = !controlsLocked;
        if (controlsLocked) {
          lockBtn.innerHTML = '<span class="material-icons">lock_open</span>';
          controls.classList.add('hidden');
        } else {
          lockBtn.innerHTML = '<span class="material-icons">lock</span>';
          showControls();
        }
      });
      
      // Toggle controls on click (except on buttons)
      playerContainer.addEventListener('click', (e) => {
        if (e.target === playerContainer || e.target === video) {
          if (controls.classList.contains('hidden')) showControls();
          else controls.classList.add('hidden');
        }
      });
      
      playerContainer.addEventListener('mousemove', showControls);
      
      // Play/Pause
      playBtn.addEventListener('click', () => { video.paused ? video.play() : video.pause(); showControls(); });
      video.addEventListener('play', () => playBtn.innerHTML = '<span class="material-icons">pause</span>');
      video.addEventListener('pause', () => playBtn.innerHTML = '<span class="material-icons">play_arrow</span>');
      
      // Skip
      rewindBtn.addEventListener('click', () => { video.currentTime = Math.max(0, video.currentTime - 10); showControls(); });
      forwardBtn.addEventListener('click', () => { video.currentTime = Math.min(video.duration || 0, video.currentTime + 10); showControls(); });
      
      // Progress bar
      function updateProgressUI(percent) {
        progressBar.style.width = percent + '%';
        progressHandle.style.left = percent + '%';
      }
      
      function seekToPosition(clientX) {
        const rect = progressContainer.getBoundingClientRect();
        const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        updateProgressUI(pos * 100);
        if (video.duration) video.currentTime = pos * video.duration;
      }
      
      progressContainer.addEventListener('mousedown', (e) => { isDragging = true; seekToPosition(e.clientX); });
      document.addEventListener('mousemove', (e) => { if (isDragging) seekToPosition(e.clientX); });
      document.addEventListener('mouseup', () => { isDragging = false; });
      
      progressContainer.addEventListener('touchstart', (e) => { isDragging = true; seekToPosition(e.touches[0].clientX); });
      document.addEventListener('touchmove', (e) => { if (isDragging) seekToPosition(e.touches[0].clientX); });
      document.addEventListener('touchend', () => { isDragging = false; });
      
      video.addEventListener('timeupdate', () => {
        if (!isDragging && video.duration) {
          const percent = (video.currentTime / video.duration) * 100;
          updateProgressUI(percent);
          timeDisplay.textContent = formatTime(video.currentTime) + ' / ' + formatTime(video.duration);
        }
        updateBufferBar();
      });
      
      function updateBufferBar() {
        if (video.buffered.length > 0 && video.duration) {
          const bufferedEnd = video.buffered.end(video.buffered.length - 1);
          bufferBar.style.width = (bufferedEnd / video.duration) * 100 + '%';
        }
      }
      
      // Volume
      volumeBtn.addEventListener('click', () => {
        if (video.muted) {
          video.muted = false;
          volumeSlider.value = video.volume;
        } else {
          video.muted = true;
          volumeSlider.value = 0;
        }
        updateVolumeUI();
        showControls();
      });
      
      volumeSlider.addEventListener('input', (e) => {
        video.volume = e.target.value;
        if (video.volume > 0) video.muted = false;
        updateVolumeUI();
        showControls();
      });
      
      function updateVolumeUI() {
        const vol = video.muted ? 0 : video.volume;
        if (vol === 0) volumeBtn.innerHTML = '<span class="material-icons">volume_off</span>';
        else if (vol < 0.5) volumeBtn.innerHTML = '<span class="material-icons">volume_down</span>';
        else volumeBtn.innerHTML = '<span class="material-icons">volume_up</span>';
        localStorage.setItem('playerVolume', vol);
        localStorage.setItem('playerMuted', video.muted);
      }
      
      // Settings (speed)
      settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        isSettingsOpen = !isSettingsOpen;
        settingsMenu.classList.toggle('active', isSettingsOpen);
        showControls();
      });
      
      document.addEventListener('click', (e) => {
        if (isSettingsOpen && !settingsDropdown.contains(e.target) && e.target !== settingsBtn) {
          isSettingsOpen = false;
          settingsMenu.classList.remove('active');
        }
      });
      
      settingsDropdown.querySelectorAll('.settings-item').forEach(item => {
        item.addEventListener('click', () => {
          const speed = parseFloat(item.dataset.speed);
          video.playbackRate = speed;
          settingsDropdown.querySelectorAll('.settings-item').forEach(i => i.classList.remove('selected'));
          item.classList.add('selected');
          showControls();
        });
      });
      
      // Fullscreen with double-tap toggle
      fullscreenBtn.addEventListener('click', toggleFullscreen);
      video.addEventListener('dblclick', toggleFullscreen);
      
      function toggleFullscreen() {
        if (!document.fullscreenElement) {
          playerContainer.requestFullscreen().catch(() => {});
        } else {
          document.exitFullscreen();
        }
        showControls();
      }
      
      function formatTime(sec) {
        const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
        return h > 0 ? h + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0') :
                        m + ':' + String(s).padStart(2,'0');
      }
      
      // Fullscreen icon update
      function updateFullscreenIcon() {
        fullscreenBtn.innerHTML = document.fullscreenElement ? 
          '<span class="material-icons">fullscreen_exit</span>' : 
          '<span class="material-icons">fullscreen</span>';
      }
      document.addEventListener('fullscreenchange', updateFullscreenIcon);
      document.addEventListener('webkitfullscreenchange', updateFullscreenIcon);
      
      initPlayer();
    })();
  </script>
</body>
</html>`;

  res.send(html);
});

// Start server
if (process.env.VERCEL) {
  module.exports = app;
} else {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}
