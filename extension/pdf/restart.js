// Read Aloud 2: restart the voice server (it makes the natural voices and runs Ask Claude) from a button, then wait for it.
const SERVER = location.origin.startsWith('http') ? '' : 'http://127.0.0.1:8793';
export async function restartServer(onStatus = () => {}) {
  onStatus('Restarting the voice server…');
  try { await fetch(SERVER + '/server/restart', { method: 'POST' }); } catch { /* it may close the line as it restarts */ }
  await new Promise((r) => setTimeout(r, 1500));
  for (let k = 0; k < 60; k++) {
    try { if ((await fetch(SERVER + '/voices', { cache: 'no-store' })).ok) { onStatus('The voice server is running again.'); return true; } } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  onStatus('The voice server did not start again. Quit Read Aloud and open it again.');
  return false;
}
