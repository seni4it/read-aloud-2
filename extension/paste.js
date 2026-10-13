// Read Aloud 2: paste text, show it as paragraphs, read it with the same player as on web pages.
document.getElementById('go').addEventListener('click', (e) => {
  if (!e.detail) return;  // mouse only
  const out = document.getElementById('out');
  out.replaceChildren(...document.getElementById('src').value.split(/\n\s*\n|\n/).map((t) => t.trim()).filter(Boolean)
    .map((t) => Object.assign(document.createElement('p'), { textContent: t })));
  out.scrollIntoView({ behavior: 'smooth' });
  document.dispatchEvent(new CustomEvent('ra2-read', { detail: out }));
});
