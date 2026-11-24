/* Cozé public site: fills the menu, offers and favourites from the shared store and runs the small on-page demos. */
(function () {
  'use strict';
  window.__cozeSiteReady = true;

  var COZE = window.COZE, UI = window.UI, h = UI.h;
  var IMG = 'assets/img/';
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function img(src, alt, w, hgt) {
    var el = document.createElement('img');
    el.loading = 'lazy';            // before src, or the download starts eagerly
    el.decoding = 'async';
    el.alt = alt || '';
    if (w) { el.width = w; el.height = hgt; }
    el.src = IMG + src;
    return el;
  }
  function arrow() { return UI.icon('arrow'); }

  /* ---------- scroll reveals ---------- */
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('is-shown'); io.unobserve(e.target); }
    });
  }, { threshold: 0.12 }) : null;
  function reveal(el) {
    if (!io) { el.classList.add('is-shown'); return; }
    io.observe(el);
  }
  $$('[data-reveal]').forEach(reveal);

  /* ---------- open now, on Malé time ---------- */
  function drawHours() {
    var o = COZE.openNow();
    $$('[data-open-pill]').forEach(function (p) {
      p.classList.toggle('is-open', o.open);
      p.classList.toggle('is-closed', !o.open);
      var label = $('[data-open-label]', p);
      if (label) label.textContent = o.label;
    });
    $$('[data-hours], [data-hours-pill]').forEach(function (el) { el.textContent = o.hours; });
  }

  /* ---------- this week's offers (staff can edit these in the counter) ---------- */
  var shapes = ['scallop', 'burst', 'scallop'];
  var tilts = [12, -10, 9];
  function drawOffers() {
    var list = $('#offers');
    if (!list) return;
    var first = !list.firstChild;
    UI.fill(list, COZE.state().offers.map(function (o, i) {
      var tone = o.tone === 'sun' ? '' : o.tone;
      var li = h('li', { class: 'ticket' },
        h('div', { class: 'ticket-photo' },
          img(o.img, '', 900, 600),
          o.sticker ? UI.sticker(o.sticker, { shape: shapes[i % 3], tone: tone, tilt: tilts[i % 3] }) : null),
        h('div', { class: 'ticket-body' },
          h('p', { class: 'ticket-when' }, o.when),
          h('h3', { class: 'ticket-title' }, o.title),
          h('p', { class: 'ticket-text' }, o.body)),
        h('p', { class: 'ticket-foot' }, h('span', null, o.valid), h('span', null, 'No. ' + o.no)));
      if (first) { li.setAttribute('data-reveal', ''); li.style.setProperty('--d', i * 90 + 'ms'); reveal(li); }
      return li;
    }));
  }

  /* ---------- club favourites ---------- */
  var FAVS = ['matcha-monkey', 'dirty-frostbite', 'marshmallow-bloom', 'yuzu-mirage'];
  function drawFavs() {
    var list = $('#favs');
    if (!list) return;
    var me = COZE.currentMember();
    UI.fill(list, FAVS.map(function (id) {
      var d = COZE.drink(id);
      var mine = !!(me && me.usual && me.usual.drink === id);
      var btn = h('a', { class: 'btn', href: 'club/?usual=' + encodeURIComponent(id) }, mine ? 'Your usual' : 'Make it my usual');
      btn.addEventListener('click', function (e) {
        var m = COZE.currentMember();
        if (!m) return;                       // not a member yet: the link takes them to the card with this drink chosen
        e.preventDefault();
        COZE.updateMember(m.id, { usual: { drink: id, how: m.usual && m.usual.drink === id ? m.usual.how : '' } });
        UI.toast(d.name + ' is now your usual, ' + m.first + '.');
      });
      return h('li', { class: 'fav' },
        h('div', { class: 'fav-photo' }, img(d.img, d.name, 900, 900), d.isNew ? h('span', { class: 'fav-new' }, 'New') : null),
        h('div', { class: 'fav-body' },
          h('h3', { class: 'fav-name' }, d.name),
          h('p', { class: 'fav-desc' }, d.desc),
          h('div', { class: 'fav-foot' }, h('span', { class: 'fav-price num' }, COZE.fmt.mvr(d.price)), btn)));
    }));
  }

  /* ---------- menu ---------- */
  function drawMenu() {
    var box = $('#menuCols');
    if (!box) return;
    UI.fill(box, COZE.MENU.map(function (col) {
      return h('article', { class: 'menu-col is-' + col.tone },
        h('header', { class: 'menu-head' },
          h('div', null, h('p', { class: 'eyebrow' }, col.note), h('h3', null, col.title)),
          img(col.img, '', 152, 152)),
        h('ul', null, col.items.map(function (it) {
          return h('li', { class: 'menu-item' },
            h('p', { class: 'menu-row' }, h('span', null, it.name), h('i', { 'aria-hidden': 'true' }), h('b', null, it.price)),
            h('p', { class: 'menu-desc' }, it.desc));
        })));
    }));
  }

  /* ---------- the phone in the club section: press "Add a stamp" and watch the card react ---------- */
  function phoneDemo() {
    var stamps = $('#phoneStamps'), note = $('#phoneNote'), line = $('#phoneLine'), btn = $('#phoneStampBtn');
    if (!stamps || !note || !btn) return;
    var NEED = 10, n = 8, hideTimer = null;

    function draw(fresh) {
      UI.fill(stamps, Array.apply(null, { length: NEED }).map(function (_, i) {
        var got = i < n;
        var li = h('li', { class: (got ? 'is-got' : '') + (fresh === i ? ' is-new' : '') }, UI.use('scallop'), h('span', null, i === NEED - 1 ? 'Free' : String(i + 1)));
        return li;
      }));
      line.textContent = n >= NEED ? n + ' of ' + NEED + '. The next drink is on us.' : n + ' of ' + NEED + ' stamps';
    }
    function say(title, body, ms) {
      clearTimeout(hideTimer);
      note.classList.remove('is-on');
      void note.offsetWidth;                 // restart the slide-in
      $('[data-note-title]', note).textContent = title;
      $('[data-note-body]', note).textContent = body;
      note.classList.add('is-on');
      hideTimer = setTimeout(function () { note.classList.remove('is-on'); }, ms || 5200);
    }
    function label(text) { btn.lastChild.textContent = ' ' + text; }

    btn.addEventListener('click', function () {
      if (n >= NEED) {
        n = 0; draw();
        say('Enjoy, Leena', 'Your free drink is on its way. Your card starts a fresh row of stamps.');
        label('Add a stamp');
        return;
      }
      n += 1; draw(n - 1);
      if (n === NEED) {
        say('Your next drink is on us', 'That is 10 stamps, Leena. Show your card and pick anything on the menu.', 7000);
        label('Use the free drink');
      } else {
        var left = NEED - n;
        say('Stamp added', 'That is ' + n + ' of ' + NEED + '. ' + (left === 1 ? 'One more and the next drink is on us.' : left + ' to go for a free drink.'));
      }
    });

    draw();
    // Greet with a personal note the first time the phone scrolls into view.
    var phone = $('#phoneDemo');
    if (io && phone) {
      var once = new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting) {
          once.disconnect();
          setTimeout(function () { note.classList.add('is-on'); hideTimer = setTimeout(function () { note.classList.remove('is-on'); }, 6500); }, 500);
        }
      }, { threshold: 0.5 });
      once.observe(phone);
    } else {
      note.classList.add('is-on');
    }
  }

  /* ---------- join form: check the two fields, then hand over to the card app ---------- */
  function joinForm() {
    var form = $('#joinForm'), err = $('#joinError');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      var first = form.elements.namedItem('first'), mobile = form.elements.namedItem('mobile');
      var problem = '';
      if (String(first.value).trim().length < 2) problem = 'Please enter your first name.';
      else if (!COZE.validMobile(mobile.value)) problem = 'Enter a Maldives mobile number, 7 digits starting with 7 or 9.';
      if (problem) {
        e.preventDefault();
        err.textContent = problem; err.hidden = false;
        (problem.indexOf('name') !== -1 ? first : mobile).focus();
        return;
      }
      err.hidden = true;
      mobile.value = COZE.validMobile(mobile.value);
    });
  }

  /* ---------- small scroll effects ---------- */
  function scrollEffects() {
    var word = $('#favsWord'), section = word ? word.closest('.favs') : null;
    var links = $$('.capsule a'), targets = links.map(function (a) { return $(a.getAttribute('href')); });
    var ticking = false, lastY = window.scrollY;
    function frame() {
      ticking = false;
      var vh = window.innerHeight, y = window.scrollY;
      // The link capsule steps aside while reading down, and comes back on the way up.
      if (y < vh * 0.7 || y < lastY - 4) document.body.classList.remove('nav-away');
      else if (y > lastY + 4) document.body.classList.add('nav-away');
      lastY = y;
      if (section && !reduceMotion) {
        var r = section.getBoundingClientRect();
        if (r.bottom > 0 && r.top < vh) {
          var p = (vh - r.top) / (vh + r.height);          // 0 as it enters, 1 as it leaves
          word.style.transform = 'translate3d(' + ((0.35 - p) * 16).toFixed(2) + 'vw,0,0)';
        }
      }
      // Mark the section being read in the capsule.
      var current = -1;
      targets.forEach(function (t, i) { if (t && t.getBoundingClientRect().top < vh * 0.42) current = current === -1 || t.getBoundingClientRect().top > targets[current].getBoundingClientRect().top ? i : current; });
      links.forEach(function (a, i) { if (i === current) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
    }
    function onScroll() { if (!ticking) { ticking = true; requestAnimationFrame(frame); } }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    frame();
  }

  /* ---------- go ---------- */
  drawHours();
  drawOffers();
  drawFavs();
  drawMenu();
  phoneDemo();
  joinForm();
  scrollEffects();
  setInterval(drawHours, 60000);
  // Staff edits and card changes made in another tab show up here straight away.
  COZE.on(function () { drawHours(); drawOffers(); drawFavs(); });
})();
