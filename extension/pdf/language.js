// Ticket 32: the language of a text, for the choice of the voice and of the Speech rewrite.
// chrome.i18n.detectLanguage cannot be used: the reader also runs as a plain page from the voice server
// (http://localhost:8793), where the chrome API is not there. So a small count of common words decides.
// content.js has a copy of textLanguage() (it cannot import); a test keeps the two copies equal.

/**
 * 'it' for an Italian text, 'en' for an English text, '' when the sample does not say it clearly.
 * It counts the common short words of each language in the first 6000 characters. Words that both languages
 * use ("in", "a", "come", "per") do not count.
 */
export function textLanguage(text) {
  const it = new Set(('il lo la gli le un una uno di del dello della dei degli delle al allo alla ai agli alle dal ' +
    'dalla dai nel nello nella nei negli nelle sul sulla che è ed con non sono questo questa questi queste anche più ' +
    'tra fra ma si ci essere hanno può dopo molto perché').split(' '));
  const en = new Set(('the of and to is are was were that this these those with from which have has had been be by ' +
    'on at its an or not but their they what when will would can there than also into such').split(' '));
  let i = 0, e = 0;
  for (const w of String(text || '').slice(0, 6000).toLowerCase().match(/\p{L}+/gu) || []) {
    if (it.has(w)) i++;
    else if (en.has(w)) e++;
  }
  if (i + e < 4) return '';
  if (i > 2 * e) return 'it';
  if (e > 2 * i) return 'en';
  return '';
}

/** A natural voice (its id, as af_heart or if_sara) is Italian when its id starts with "i". */
export const isItalianVoice = (id) => /^i[fm]_/.test(id || '');

/**
 * The natural voice that reads a text of language lang, when the owner chose voice.
 * An Italian text read by an English voice goes to Sara (Nicola stays Nicola: he is Italian too).
 * An English text read by an Italian voice goes to Heart: an Italian voice reads English badly.
 * An unknown language keeps the chosen voice.
 */
export function voiceForLanguage(voice, lang) {
  if (lang === 'it' && /^[ab][fm]_/.test(voice || '')) return 'if_sara';
  if (lang === 'en' && isItalianVoice(voice)) return 'af_heart';
  return voice;
}

/**
 * Spec "Italian voices", ticket 01: the natural voices of a voice list in language groups, for the voice lists of
 * the Player bar, the add-on popup, the reader and the voice sampler. voices: the /voices list of the voice server
 * ({ id, accent, label }). Returns [{ name, voices }]: "English" (American and British) first, then "Italian",
 * then each other accent as its own group with the accent as its name, in the order of the voice server.
 * Inside a group the voices keep the order of the voice server. An empty group is not given.
 * A voice with no accent (an old voice server, or the reader's fixed list before the voice server answers) takes
 * its group from the first letter of its id (Kokoro's names): a and b are English, i is Italian, else "Other".
 * content.js and popup.js have a copy (they cannot import); a test keeps the copies equal.
 */
export function voiceGroups(voices) {
  const named = { american: 'English', british: 'English', english: 'English', italian: 'Italian' };
  const byId = { a: 'English', b: 'English', i: 'Italian' };
  const groups = new Map([['English', []], ['Italian', []]]);
  for (const v of voices || []) {
    const accent = String((v && v.accent) || '').trim();
    const name = accent ? named[accent.toLowerCase()] || accent : byId[String((v && v.id) || '').charAt(0)] || 'Other';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(v);
  }
  return [...groups].filter(([, list]) => list.length).map(([name, list]) => ({ name, voices: list }));
}

/** The language group of one voice ({ id, accent }): "English", "Italian", or the name of its accent. */
export const voiceGroup = (voice) => (voiceGroups([voice])[0] || {}).name || '';
