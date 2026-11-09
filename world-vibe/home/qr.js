// Draws the share QR into #qr using the vendored QRCode library, and makes the
// result readable to assistive tech. Without the library the link itself shows.
export function drawQr(root = document) {
  const el = root.getElementById('qr');
  if (!el) return;
  const url = el.dataset.qr;
  if (typeof QRCode === 'undefined') { el.innerHTML = '<a href="' + url + '">' + url + '</a>'; return; }
  el.innerHTML = '';
  new QRCode(el, { text: url, width: 140, height: 140, colorDark: '#16181B', colorLight: '#FFFFFF', correctLevel: QRCode.CorrectLevel.M });
  el.querySelectorAll('canvas').forEach((c) => c.setAttribute('aria-hidden', 'true'));
  el.querySelectorAll('img').forEach((i) => { i.alt = 'QR code that opens this line in the SomaCheck app'; });
}
