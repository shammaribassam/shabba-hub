/* Diwan ambient audio: independent from quiz state and chat connections. */
(() => {
  'use strict';
  const audio = document.getElementById('diwanBackgroundAudio');
  const player = document.getElementById('diwanAudioPlayer');
  if (!audio || !player) return;
  const playButton = document.getElementById('diwanAudioPlay');
  const muteButton = document.getElementById('diwanAudioMute');
  const volumeInput = document.getElementById('diwanAudioVolume');
  const volumeText = document.getElementById('diwanAudioVolumeText');
  const status = document.getElementById('diwanAudioStatus');
  const STORE = 'diwanAbuAlbasmAudio.v1';
  let userPaused = false;
  let lastVolume = 0.22;

  function readPreferences() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) || '{}');
      if (Number.isFinite(saved.volume)) audio.volume = Math.min(1, Math.max(0, saved.volume));
      else audio.volume = 0.22;
      audio.muted = !!saved.muted;
    } catch (_) { audio.volume = 0.22; audio.muted = false; }
    if (audio.volume > 0) lastVolume = audio.volume;
  }
  function persist() {
    try { localStorage.setItem(STORE, JSON.stringify({volume: audio.volume, muted: audio.muted})); }
    catch (_) { /* Settings remain usable without storage. */ }
  }
  function showStatus(message) { status.textContent = message; }
  function updateUI() {
    const playing = !audio.paused && !audio.ended;
    playButton.textContent = playing ? '⏸ إيقاف مؤقت' : '▶ تشغيل';
    playButton.setAttribute('aria-label', playing ? 'إيقاف المقطع مؤقتًا' : 'تشغيل المقطع');
    muteButton.textContent = audio.muted || audio.volume === 0 ? '🔇 إلغاء الكتم' : '🔊 كتم';
    muteButton.setAttribute('aria-pressed', String(audio.muted));
    volumeInput.value = String(Math.round(audio.volume * 100));
    volumeText.textContent = Math.round(audio.volume * 100) + '٪';
  }
  async function start() {
    userPaused = false;
    try {
      await audio.play();
      showStatus('المقطع شغال ويتكرر تلقائيًا');
    } catch (_) {
      showStatus('اضغط تشغيل للسماح بالصوت في المتصفح');
    }
    updateUI();
  }
  playButton.addEventListener('click', () => {
    if (audio.paused) start();
    else {
      userPaused = true;
      audio.pause();
      showStatus('الصوت متوقف مؤقتًا');
      updateUI();
    }
  });
  muteButton.addEventListener('click', () => {
    audio.muted = !audio.muted;
    if (!audio.muted && audio.volume === 0) audio.volume = lastVolume || 0.22;
    persist(); updateUI();
  });
  volumeInput.addEventListener('input', () => {
    const value = Math.max(0, Math.min(100, Number(volumeInput.value) || 0));
    audio.volume = value / 100;
    if (value > 0) { lastVolume = audio.volume; audio.muted = false; }
    persist(); updateUI();
  });
  audio.addEventListener('play', () => { showStatus('المقطع شغال ويتكرر تلقائيًا'); updateUI(); });
  audio.addEventListener('pause', updateUI);
  audio.addEventListener('volumechange', updateUI);
  audio.addEventListener('error', () => showStatus('تعذّر تحميل المقطع؛ تأكد من رفع ملف diwan-background.mp3'));
  audio.loop = true;
  readPreferences(); updateUI();

  // Browsers often block audible autoplay. Try it once, then retry on the first
  // ordinary site interaction. An explicit pause never restarts automatically.
  start();
  function startOnGesture(event) {
    if (userPaused || !audio.paused) return;
    if (event.target instanceof Element && event.target.closest('#diwanAudioPlayer')) return;
    start();
  }
  document.addEventListener('pointerdown', startOnGesture, {passive: true});
  document.addEventListener('keydown', startOnGesture);
})();
