// "Flip punctuation" for the Reversed words style.
//
// Reversed lines are read right to left, but each word's letters stay normal,
// so a word's punctuation would otherwise sit on the wrong side: in
// `the of spoke never He position.` the period is met before "position".
// flipPunctuation moves it across (`.position`) and mirrors quotes and
// brackets so they still open toward the text (`“Fifteen` -> `Fifteen”`).
//
// Pure string -> string, no DOM, so it can be tested with plain node. The
// result always has the same length and the same characters, except that
// mirrored pairs are swapped; line breaks measured on the original words
// therefore still hold.

const OPEN = '“‘([';                  // leading marks that move to the right
const CLOSE = '.,;:!?…”’)]';          // trailing marks that move to the left
const MIRROR = { '“': '”', '”': '“', '‘': '’', '’': '‘', '(': ')', ')': '(', '[': ']', ']': '[' };
const DASHES = /([—–]+)/;             // em/en dash runs; hyphens are not split

const mirror = (s) => [...s].reverse().map((c) => MIRROR[c] || c).join('');

/** One dash-free part: leading run + core + trailing run, punctuation moved across. */
function flipPart(part) {
  let a = 0;
  while (a < part.length && OPEN.includes(part[a])) a++;
  let b = part.length;
  while (b > a && CLOSE.includes(part[b - 1])) b--;
  // A ’ straight after an s (soldiers’) is taken as a possessive and stays on
  // the word, unless the part opened with ‘ (then it closes that quote).
  if (b < part.length && part[b] === '’' && part[b - 1] === 's' && b > a && part[0] !== '‘') b++;
  if (a === 0 && b === part.length) return part;
  return mirror(part.slice(b)) + part.slice(a, b) + mirror(part.slice(0, a));
}

/**
 * Word as it should appear on a reversed (right-to-left) line.
 * A token joined by em/en dashes (observer—excellent) is split at the dashes
 * and its parts are reversed as well (excellent—observer); a dash at either
 * end simply moves across (fifteen— -> —fifteen).
 */
export function flipPunctuation(word) {
  if (!DASHES.test(word)) return flipPart(word);
  return word.split(DASHES).reverse().map((p, i) => (i % 2 ? [...p].reverse().join('') : flipPart(p))).join('');
}
