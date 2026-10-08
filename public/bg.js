// Background: hexagons that softly pop in and out at random cells of a hex lattice.
// Paired with .pop-field / .pop-hex / @keyframes hexPop in style.css.
(function () {
  var W = 84, H = W * 1.1547005, G = 6, D = W + G, ROW = D * 0.8660254;
  var field = document.createElement('div');
  field.className = 'pop-field';
  field.setAttribute('aria-hidden', 'true');
  document.body.insertBefore(field, document.body.firstChild);
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var used = {};
  function pop() {
    var cols = Math.ceil(innerWidth / D) + 1, rows = Math.ceil(innerHeight / ROW) + 1;
    var r = Math.floor(Math.random() * rows), c = Math.floor(Math.random() * cols), k = r + ',' + c;
    if (used[k]) return;
    used[k] = 1;
    var x = c * D + (r % 2 ? D / 2 : 0) - W / 2, y = r * ROW - H / 2;
    var el = document.createElement('div');
    el.className = 'pop-hex ' + (Math.random() < 0.35 ? 'fill' : 'line') + (Math.random() < 0.5 ? ' gold' : '');
    el.style.cssText = 'left:' + x + 'px;top:' + y + 'px;width:' + W + 'px;height:' + H + 'px;animation-duration:' + (7 + Math.random() * 4) + 's';
    el.innerHTML = '<svg viewBox="0 0 100 115.47" preserveAspectRatio="none"><path d="M50 0 L100 28.87 L100 86.6 L50 115.47 L0 86.6 L0 28.87 Z"/></svg>';
    el.addEventListener('animationend', function () { el.remove(); delete used[k]; });
    field.appendChild(el);
  }
  for (var i = 0; i < 3; i++) setTimeout(pop, i * 700);
  setInterval(pop, 1400);
})();
