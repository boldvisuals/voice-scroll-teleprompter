/* Voice-following matcher.
 *
 * Holds a list of script words (with their DOM spans), a cursor for the
 * next-expected word, and a rolling buffer of recently spoken words. On each
 * transcript it greedily aligns the spoken tail against a forward window of
 * the script and advances the cursor to the furthest confident match.
 *
 * Returns the matched word's element so the scroll engine can target it.
 * When nothing matches (speaker off-script / silence), the cursor holds.
 *
 * window.VSTMatcher = { setWords, reset, feed }
 */
(function () {
  const LOOKAHEAD = 25;      // how far ahead of the cursor we'll search
  const TAIL = 10;           // how many recent spoken words we align on
  const SKIP = 3;            // single-word fallback only advances within this gap
  const FINAL_BUFFER = 16;   // committed words kept for context

  let words = [];            // [{ el, norm }]
  let cursor = 0;
  let recentFinal = [];      // committed (final) spoken words
  let lastSig = '';          // last spoken tail we acted on (de-dupe interims)

  // number-word <-> digit, so "five" and "5" match either way
  const NUMW = {
    zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5',
    six: '6', seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11',
    twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16',
    seventeen: '17', eighteen: '18', nineteen: '19', twenty: '20', thirty: '30',
    forty: '40', fifty: '50', sixty: '60', seventy: '70', eighty: '80', ninety: '90',
    hundred: '100', thousand: '1000',
  };

  // Canonical form of a single token (lowercase, strip punctuation, numbers→digits).
  function normalizeToken(raw) {
    const t = raw.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, '');
    return NUMW[t] || t;
  }

  function tokenize(s) {
    return s.toLowerCase()
      .split(/[^\p{L}\p{N}']+/u)
      .map(normalizeToken)
      .filter(Boolean);
  }

  function setWords(list) {
    words = list;
    reset();
  }

  function reset() {
    cursor = 0;
    recentFinal = [];
    lastSig = '';
  }

  // true if edit distance between a and b is <= 1
  function lev1(a, b) {
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 1) return false;
    let i = 0, j = 0, edits = 0;
    while (i < la && j < lb) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (la > lb) i++;
      else if (lb > la) j++;
      else { i++; j++; }
    }
    if (i < la || j < lb) edits++;
    return edits <= 1;
  }

  // Forgiving token equality — speech recognition mishears, so allow one-char
  // slips and plurals/tense ("implant"/"implants" = one edit). Deliberately NOT
  // a prefix match: that over-matched ("care"/"careful") and caused false jumps.
  function fuzzyEq(a, b) {
    if (a === b) return true;
    if (a.length < 4 || b.length < 4) return false; // short words must match exactly
    return lev1(a, b);
  }

  // Find the reading position of the spoken tail within the forward window.
  //
  // Primary signal is a BIGRAM: two consecutive spoken words matching two
  // consecutive script words. We take the position CLOSEST to the cursor, so a
  // phrase that recurs later in the script can't yank us forward. This is what
  // stops "massive skip-ahead" on common words like "the / you / your".
  //
  // Fallback (no bigram — recognizer garbled the previous word): advance only
  // if the immediately-expected next word matches, within a tiny gap. Returns
  // the matched script index, or -1 to hold.
  function align(spoken) {
    if (!spoken.length || cursor >= words.length) return -1;
    const end = Math.min(cursor + LOOKAHEAD, words.length);
    const last = spoken[spoken.length - 1];
    const prev = spoken.length >= 2 ? spoken[spoken.length - 2] : null;

    if (prev) {
      for (let j = cursor; j < end; j++) {
        if (j >= 1 && fuzzyEq(words[j].norm, last) && fuzzyEq(words[j - 1].norm, prev)) {
          return j; // closest bigram to the cursor wins
        }
      }
    }

    // word-by-word fallback: only the next expected word(s), never a far leap
    const near = Math.min(cursor + SKIP, end);
    for (let j = cursor; j < near; j++) {
      if (last.length >= 4 && fuzzyEq(words[j].norm, last)) return j;
    }
    return -1;
  }

  /* feed(transcript, isFinal) -> matched element | null
   * Call on every recognition result (interim and final). */
  function feed(transcript, isFinal) {
    const interimWords = tokenize(transcript);
    const spoken = recentFinal.concat(interimWords).slice(-TAIL);

    if (isFinal) {
      recentFinal = recentFinal.concat(interimWords).slice(-FINAL_BUFFER);
    }

    const sig = spoken.join(' ');
    if (sig === lastSig) return null; // identical to last update → nothing new said
    lastSig = sig;

    const matchedTo = align(spoken);
    if (matchedTo >= 0) {
      cursor = matchedTo + 1;
      return words[matchedTo].el;
    }
    return null;
  }

  // Re-seat the cursor near a manually-scrolled position (after scrub/rewind),
  // so voice tracking resumes from where the reader actually is.
  function seekToWordIndex(i) {
    cursor = Math.max(0, Math.min(i, words.length));
    lastSig = '';
  }

  window.VSTMatcher = { setWords, reset, feed, seekToWordIndex, normalizeToken };
})();
