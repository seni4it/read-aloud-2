// Read Aloud 2: paste text, show it as paragraphs, read it with the same player as on web pages.
// text read from a picture arrives here (right-click an image, "Read the text in this picture")
if (new URLSearchParams(location.search).get('from') === 'picture') {
  chrome.storage.session.get('ra2Paste').then(({ ra2Paste }) => { if (ra2Paste) { document.getElementById('src').value = ra2Paste; show(); } });
}
function show() {
  const out = document.getElementById('out');
  out.replaceChildren(...document.getElementById('src').value.split(/\n\s*\n|\n/).map((t) => t.trim()).filter(Boolean)
    .map((t) => Object.assign(document.createElement('p'), { textContent: t })));
  return out;
}
document.getElementById('go').addEventListener('click', (e) => {
  if (!e.detail) return;  // mouse only
  const out = show();
  out.scrollIntoView({ behavior: 'smooth' });
  document.dispatchEvent(new CustomEvent('ra2-read', { detail: out }));
});
