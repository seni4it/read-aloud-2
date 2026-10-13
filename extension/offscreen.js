// Read Aloud 2, offscreen page: plays the natural voice. Each piece of text is one WAV from voice-server.py;
// the next pieces are asked for while this one plays, so there is no gap between sentences.
const SERVER = 'http://127.0.0.1:8793';
const audio = new Audio();
audio.preservesPitch = true;  // faster speech keeps the same voice pitch
let cur = null, timer = null;

const url = (text, voice) => `${SERVER}/speak?voice=${encodeURIComponent(voice)}&text=${encodeURIComponent(text)}`;
const send = (evt, extra) => cur && chrome.runtime.sendMessage({ to: 'bg-evt', tab: cur.tab, id: cur.id, evt, ...extra }).catch(() => {});

function stop() { clearInterval(timer); audio.onended = audio.onerror = null; audio.pause(); audio.removeAttribute('src'); cur = null; }

chrome.runtime.onMessage.addListener((m) => {
  if (m.to !== 'offscreen') return;
  if (m.cmd === 'speak') {
    stop(); cur = m;
    for (const t of m.next) fetch(url(t, m.voice)).catch(() => {});  // read ahead
    audio.src = url(m.text, m.voice); audio.playbackRate = m.rate;
    audio.onended = () => { clearInterval(timer); send('end'); };
    audio.onerror = () => { clearInterval(timer); send('error', { why: 'The voice server on this Mac did not answer.' }); };
    audio.play().then(() => {
      if (cur !== m) return;
      audio.playbackRate = m.rate;
      send('start', { d: audio.duration });
      timer = setInterval(() => send('tick', { t: audio.currentTime, d: audio.duration }), 70);
    }).catch((e) => { if (cur === m && e.name !== 'AbortError') send('error', { why: 'The voice could not play: ' + e.message }); });
  } else if (m.cmd === 'stop') stop();
  else if (m.cmd === 'pause') audio.pause();
  else if (m.cmd === 'resume') audio.play().catch(() => {});
  else if (m.cmd === 'rate') audio.playbackRate = m.rate;
});
