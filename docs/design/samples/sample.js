// สลับภาษา/ธีม/สถานะของหน้าตัวอย่างผ่าน URL: ?lang=th|en  &theme=system|light|dark (ไม่ใส่ = system)  &state=normal|loading|empty|error
// ข้อความไทยอยู่ใน HTML · ข้อความอังกฤษอยู่ใน window.MESSAGES_EN (key = data-t) — โครงเดียวกับ messages/en.json ในอนาคต
(function () {
  var q = new URLSearchParams(location.search);
  var lang = q.get('lang') === 'en' ? 'en' : 'th';
  var theme = q.get('theme');
  var state = q.get('state') || 'normal';
  var html = document.documentElement;
  html.lang = lang;
  html.setAttribute('data-theme', theme === 'dark' || theme === 'light' ? theme : 'system');
  html.setAttribute('data-state', state);
  function apply() {
    document.querySelectorAll('[data-state-show]').forEach(function (el) {
      el.hidden = el.getAttribute('data-state-show').split(' ').indexOf(state) === -1;
    });
    document.querySelectorAll('[data-state-hide]').forEach(function (el) {
      el.hidden = el.getAttribute('data-state-hide').split(' ').indexOf(state) !== -1;
    });
    if (lang !== 'en') return;
    var M = window.MESSAGES_EN || {};
    document.querySelectorAll('[data-t]').forEach(function (el) {
      var k = el.getAttribute('data-t');
      if (M[k] == null) { console.warn('missing en key', k); el.setAttribute('data-missing', k); return; }
      el.innerHTML = M[k];
    });
    document.querySelectorAll('[data-t-aria]').forEach(function (el) {
      var k = el.getAttribute('data-t-aria'); if (M[k] != null) el.setAttribute('aria-label', M[k]); else el.setAttribute('data-missing', k);
    });
    document.querySelectorAll('[data-t-ph]').forEach(function (el) {
      var k = el.getAttribute('data-t-ph'); if (M[k] != null) el.setAttribute('placeholder', M[k]); else el.setAttribute('data-missing', k);
    });
    if (M._title) document.title = M._title;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply); else apply();
})();
