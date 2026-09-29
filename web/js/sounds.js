/* ==========================================================================
   vortex — sound effects, synthesised with Web Audio (no audio files).
   Three voices share the same melodies; only the register and timbre change.
   Stored per device, like the rest of Customization.
   ========================================================================== */

const SOUND_VARIANTS = [
  { id: 'treble', name: 'Treble',   hint: 'Bright and crisp',  cycles: 7, mult: 1.5,  wave: 'sine',     gain: 0.075, decay: 0.85 },
  { id: 'mid',    name: 'Balanced', hint: 'Right in between',  cycles: 4, mult: 1,    wave: 'sine',     gain: 0.11,  decay: 1 },
  { id: 'bass',   name: 'Bass',     hint: 'Deep and warm',     cycles: 2, mult: 0.5,  wave: 'triangle', gain: 0.17,  decay: 1.3 }
];
const SOUND_DEFAULTS = { sounds: 'on', variant: 'mid' };

let audioCtx = null;

function soundPref(key) {
  const raw = STORE.get('sound.' + key, null);
  if (key === 'sounds') return raw !== 'off';
  return SOUND_VARIANTS.some(function (v) { return v.id === raw; }) ? raw : SOUND_DEFAULTS.variant;
}

function setSoundPref(key, value) {
  STORE.set('sound.' + key, String(value));
  syncCustomization();
}

function soundVoice(id) {
  const want = id || soundPref('variant');
  return SOUND_VARIANTS.filter(function (v) { return v.id === want; })[0] || SOUND_VARIANTS[1];
}

function audioContext() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(function () {});
  return audioCtx;
}

/* notes: [[frequency Hz, start s, length s], ...] in the "balanced" register. */
function playNotes(notes, voiceId, force) {
  if (!force && !soundPref('sounds')) return;
  const ctx = audioContext();
  if (!ctx) return;
  const v = soundVoice(voiceId);
  const t0 = ctx.currentTime + 0.01;
  notes.forEach(function (n) {
    const start = t0 + n[1];
    const len = n[2] * v.decay;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = v.wave;
    osc.frequency.setValueAtTime(n[0] * v.mult, start);
    if (n[3]) osc.frequency.exponentialRampToValueAtTime(n[3] * v.mult, start + len);
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.linearRampToValueAtTime(v.gain, start + 0.006);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + len);
    osc.connect(amp);
    amp.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + len + 0.02);
  });
}

const sounds = {
  tap:      function () { playNotes([[620, 0, 0.05]]); },
  pop:      function () { playNotes([[640, 0, 0.09, 900]]); },
  navigate: function () { playNotes([[440, 0, 0.09, 540]]); },
  on:       function () { playNotes([[520, 0, 0.07], [780, 0.06, 0.1]]); },
  off:      function () { playNotes([[780, 0, 0.07], [520, 0.06, 0.1]]); },
  success:  function () { playNotes([[660, 0, 0.1], [990, 0.09, 0.18]]); },
  error:    function () { playNotes([[392, 0, 0.11], [294, 0.1, 0.2]]); },
  notify:   function () { playNotes([[880, 0, 0.12], [1175, 0.11, 0.22]]); },
  preview:  function (voiceId) { playNotes([[660, 0, 0.1], [880, 0.1, 0.1], [1100, 0.2, 0.22]], voiceId, true); }
};
