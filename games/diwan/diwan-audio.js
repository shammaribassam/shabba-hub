/* Diwan background audio: low, balanced, continuous, with a single play/pause control. */
(() => {
  'use strict';
  const audio = document.getElementById('diwanBackgroundAudio');
  const player = document.getElementById('diwanAudioPlayer');
  if (!audio || !player) return;
  const button = document.getElementById('diwanAudioPlay');
  const status = document.getElementById('diwanAudioStatus');
  if (!button || !status) return;

  const NEW_TRACK = 'diwan-abu-albasm.mp3';
  const OLD_TRACK = 'diwan-background.mp3';
  let userPaused = false;
  let legacyFallback = false;

  // A steady, gentle background level, without a slider or extra controls.
  audio.volume = 0.16;
  audio.muted = false;
  audio.loop = true;
  audio.src = NEW_TRACK;

  const show = message => { status.textContent = message; };
  function update() {
    const playing = !audio.paused && !audio.ended;
    button.textContent = playing ? '⏸ إيقاف' : '▶ تشغيل';
    button.setAttribute('aria-label', playing ? 'إيقاف موسيقى الديوان' : 'تشغيل موسيقى الديوان');
    button.setAttribute('aria-pressed', String(playing));
  }
  async function start() {
    if (userPaused) return;
    try {
      await audio.play();
      show('خلفية موسيقية هادئة — تكرار مستمر');
    } catch (_) {
      show(legacyFallback ? 'اضغط تشغيل للمقطع السابق' : 'اضغط تشغيل للسماح بالصوت');
    }
    update();
  }

  button.addEventListener('click', () => {
    if (audio.paused) {
      userPaused = false;
      start();
    } else {
      userPaused = true;
      audio.pause();
      show('الصوت متوقف');
      update();
    }
  });
  audio.addEventListener('play', () => {
    show('خلفية موسيقية هادئة — تكرار مستمر');
    update();
  });
  audio.addEventListener('pause', update);
  audio.addEventListener('ended', update);
  audio.addEventListener('error', () => {
    // The new MP3 must be uploaded to the repo alongside this script.
    // Until then, preserve working background music rather than breaking playback.
    if (!legacyFallback) {
      legacyFallback = true;
      audio.src = OLD_TRACK;
      audio.load();
      if (!userPaused) start();
    } else {
      show('تعذّر تحميل المقطع الصوتي');
      update();
    }
  });

  update();
  start();
  // Browsers do not always permit audible autoplay. Retry after the first
  // site interaction, but never override an explicit pause.
  function onGesture(event) {
    if (userPaused || !audio.paused) return;
    if (event.target instanceof Element && event.target.closest('#diwanAudioPlayer')) return;
    start();
  }
  document.addEventListener('pointerdown', onGesture, { passive: true });
  document.addEventListener('keydown', onGesture);
})();
