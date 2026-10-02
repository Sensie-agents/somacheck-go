// The QR landing for a v3 item: /world-vibe/share/?item=<slug>. Pure pieces,
// shared with the tests. Progress follows the same reveal ladder as the home:
// nothing but the head count under the unlock threshold, a lean with no numbers
// from the threshold up to 9, exact percentages only at 10 and above.
import { threshold, contributors, EXACT_COUNT_FROM, PUBLIC_SIGNAL_LABEL } from '../home/home-render.js';
import { SHARE_URL } from '../home/home-data.js';

const isNum = (v) => typeof v === 'number' && isFinite(v);
const LEAN = { aligned: 'Leans aligned', mixed: 'Mixed so far', unaligned: 'Leans unaligned' };

export function itemProgress(item) {
  const c = contributors(item);
  const t = threshold(item);
  const counts = isNum(item.aligned) && isNum(item.unaligned) && item.aligned + item.unaligned > 0;
  if (item.public_signals === true && counts) {
    const total = item.aligned + item.unaligned;
    return { headline: Math.round((item.aligned / total) * 100) + '% aligned', detail: total + ' shared by choice' };
  }
  if (c < t) return { headline: c + ' of ' + t + ' checked in', detail: 'The vibe appears when ' + t + ' people have checked in.' };
  if (c >= EXACT_COUNT_FROM && counts) {
    const pct = Math.round((item.aligned / (item.aligned + item.unaligned)) * 100);
    return { headline: pct + '% aligned, ' + (100 - pct) + '% unaligned', detail: c + ' checked in. What participants noticed.' };
  }
  if (LEAN[item.lean]) return { headline: LEAN[item.lean], detail: c + ' checked in' };
  return { headline: 'The vibe is still forming', detail: c + ' checked in' };
}

export const universalLink = (slug) => SHARE_URL + '?item=' + encodeURIComponent(slug);

export { PUBLIC_SIGNAL_LABEL };
