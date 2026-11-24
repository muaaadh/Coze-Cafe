/*
 * Cozé staff counter.
 * Reads and writes the shared demo store (window.COZE). Every change in the store, from this tab or
 * from a club card in another tab, redraws the section that is open.
 * Names and note text typed by people only ever go in as text nodes (UI.h), never as HTML.
 */
(function () {
  'use strict';

  var C = window.COZE, U = window.UI, h = U.h;
  var BY = 'Counter 1';
  var SECTIONS = ['counter', 'members', 'notes', 'week', 'settings'];
  var SVG = 'http://www.w3.org/2000/svg';
  var KIND_ORDER = ['personal', 'reward', 'drinks'];
  var KIND_LABEL = { personal: 'Personal note', reward: C.NOTE_KINDS.reward.label, drinks: C.NOTE_KINDS.drinks.label };

  var STARTERS = [
    { label: 'Your usual is on us', kind: 'personal', title: 'Your usual is on us', body: '{name}, your usual is on the house today. Come by before 6.', replies: ['On my way', 'Not today'] },
    { label: 'We have missed you', kind: 'personal', title: 'We have missed you', body: '{name}, it has been a while. Your seat is still here.', replies: [] },
    { label: 'First taste', kind: 'drinks', title: 'First taste, if you want it', body: '{name}, the Yuzu Mirage Tonic lands this Friday. Shall we keep you a glass?', replies: ['Keep me one', 'Not this time'] },
    { label: 'Happy birthday', kind: 'reward', title: 'Happy birthday', body: 'Happy birthday, {name}. A slice of cheesecake is on your card all month.', replies: [] },
    { label: 'One stamp to go', kind: 'reward', title: 'One stamp to go', body: '{name}, one more stamp and the next drink is on us.', replies: [] }
  ];

  // What the screen is showing. The data itself always comes from the store.
  var S = {
    section: null,
    query: '',
    selectedId: null,
    stepN: 3,
    flash: null,                       // { memberId, tone: 'ok' | 'win', text }
    mem: { q: '', seg: 'all', sort: 'last', dir: -1 },
    note: { mode: 'one', toId: null, seg: 'birthday', listIds: [], kind: 'personal', pickQ: '' },
    week: { draft: null, dirty: false },
    set: { filled: false, dirty: false }
  };

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function wide() { return window.matchMedia('(min-width: 861px)').matches; }     // sidebar layout
  function phone() { return window.matchMedia('(max-width: 700px)').matches; }    // single column
  function lowerFirst(s) { return /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function need() { return C.state().settings.stampsForFree; }
  function sep() { return h('span', { class: 'dim', 'aria-hidden': 'true' }, ' \u00b7 '); }

  // One message at a time, so an old "Undo" never sits under a newer one.
  var closeToast = null;
  function say(message, o) {
    if (closeToast) closeToast();
    // On a phone the message lies over the brand row of the top bar: clear of the Add buttons,
    // and not on top of the customer's name either.
    var bar = $('.side');
    var top = app.hidden || wide() ? 0 : Math.max(0, bar.getBoundingClientRect().top);
    document.documentElement.style.setProperty('--toast-top', (top + 4) + 'px');
    closeToast = U.toast(message, o);
  }

  // The height of the top bar on phones and tablets, for things that stick underneath it.
  function measureBar() {
    var hgt = app.hidden || wide() ? 0 : $('.side').offsetHeight;
    document.documentElement.style.setProperty('--bar-h', hgt + 'px');
  }

  function svg(tag, attrs) {
    var el = document.createElementNS(SVG, tag);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    for (var i = 2; i < arguments.length; i++) if (arguments[i]) el.appendChild(arguments[i]);
    return el;
  }

  // Rebuild a region without losing the keyboard's place: the focused control is found again by its data-k.
  // While it is empty the region keeps its height, and the page is put back where it was, so nothing
  // on screen jumps under a finger.
  function redraw(box, build, fallback) {
    var a = document.activeElement;
    var had = !!(a && a !== document.body && box.contains(a));
    var key = had && a.dataset ? a.dataset.k : null;
    var x = window.scrollX, y = window.scrollY, held = box.style.minHeight;
    box.style.minHeight = box.offsetHeight + 'px';
    U.clear(box);
    build(box);
    box.style.minHeight = held;
    if (had) {
      var next = key ? box.querySelector('[data-k="' + key + '"]') : null;
      if (next && next.disabled) next = box.querySelector('[data-k="addn"]');
      if (!next && fallback) next = fallback();
      if (next) next.focus({ preventScroll: true });
    }
    if (window.scrollX !== x || window.scrollY !== y) window.scrollTo(x, y);
  }

  /* ---------- yes / no question ---------- */

  var askDlg = $('#ask'), askDone = null, downOutside = false;
  function outside(e) {
    var r = askDlg.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  }
  function ask(o) {
    return new Promise(function (resolve) {
      if (typeof askDlg.showModal !== 'function') { resolve(window.confirm(o.title)); return; }
      $('#ask-title').textContent = o.title;
      $('#ask-body').textContent = o.body || '';
      var ok = $('#ask-ok');
      ok.textContent = o.ok || 'OK';
      ok.className = 'btn ' + (o.danger ? 'btn-danger' : 'btn-toast');
      askDlg.returnValue = '';
      askDone = resolve;
      askDlg.showModal();
    });
  }
  askDlg.addEventListener('close', function () {
    var done = askDone;
    askDone = null;
    if (done) done(askDlg.returnValue === 'ok');
  });
  // A click on the dimmed backdrop closes it, but only if the press also started out there.
  askDlg.addEventListener('pointerdown', function (e) { downOutside = outside(e); });
  askDlg.addEventListener('click', function (e) {
    if (downOutside && outside(e)) askDlg.close('cancel');
    downOutside = false;
  });

  /* ---------- gate and routing ---------- */

  var gate = $('#gate'), app = $('#app');

  function showGate() {
    app.hidden = true;
    gate.hidden = false;
    document.body.classList.remove('is-app');
    measureBar();
    $('#gate-code').value = '';
    $('#gate-code').removeAttribute('aria-invalid');
    $('#gate-error').textContent = '';
    $('#gate-code').focus();
  }
  function showApp() {
    gate.hidden = true;
    app.hidden = false;
    document.body.classList.add('is-app');
    measureBar();
    S.section = null;
    route();
    if (!C.saving()) notSaving();
  }

  // Private windows can refuse to store anything. Say so once.
  var toldNotSaving = false;
  function notSaving() {
    if (toldNotSaving) return;
    toldNotSaving = true;
    say('This browser will not save anything, so changes stay in this tab only.', { ms: 9000 });
  }

  $('#gate-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = $('#gate-code'), code = input.value.trim();
    if (C.staffSignIn(code)) { showApp(); return; }
    $('#gate-error').textContent = code ? 'That passcode is not right. The demo passcode is 2026.' : 'Enter the passcode.';
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    input.select();
  });

  $$('[data-signout]').forEach(function (b) {
    b.addEventListener('click', function () { C.staffSignOut(); showGate(); });
  });

  function route() {
    if (app.hidden) return;
    var hash = location.hash.replace('#', '');
    var sec = SECTIONS.indexOf(hash) !== -1 ? hash : 'counter';
    var changed = sec !== S.section;
    S.section = sec;
    $$('[data-section]').forEach(function (el) { el.hidden = el.dataset.section !== sec; });
    $$('[data-nav]').forEach(function (a) {
      if (a.dataset.nav === sec) {
        a.setAttribute('aria-current', 'page');
        if (changed && !wide() && a.scrollIntoView) a.scrollIntoView({ block: 'nearest', inline: 'center' });
      } else a.removeAttribute('aria-current');
    });
    render();
    if (changed) {
      window.scrollTo(0, 0);
      if (closeToast) closeToast();
      // A scanner types into whatever has focus, so the counter starts in the search field.
      if (focusNext) focusNext.focus({ preventScroll: true });
      else if (sec === 'counter' && !phone()) $('#find').focus({ preventScroll: true });
    }
    focusNext = null;
  }
  window.addEventListener('hashchange', route);

  var focusNext = null;
  function go(sec, focusEl) {
    focusNext = focusEl || null;
    if (location.hash === '#' + sec) route(); else location.hash = '#' + sec;
  }

  /* ---------- rendering ---------- */

  var queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    setTimeout(function () { queued = false; render(); }, 0);
  }

  function render() {
    if (app.hidden || !S.section) return;
    if (S.selectedId && !C.member(S.selectedId)) { S.selectedId = null; S.flash = null; }
    if (S.note.toId && !C.member(S.note.toId)) S.note.toId = null;
    var open = C.openNow();
    $('#open-pill').className = 'pill ' + (open.open ? 'is-open' : 'is-closed');
    $('#open-text').textContent = open.label;
    ({ counter: renderCounter, members: renderMembers, notes: renderNotes, week: renderWeek, settings: renderSettings })[S.section]();
  }

  /* ---------- 1. counter ---------- */

  function renderCounter() {
    var st = C.stats();
    $('#today-line').textContent = C.fmt.day(Date.now()) + '. ' + C.openNow().label + '.';
    renderTiles(st);
    renderWaiting();
    renderResults();
    renderMember();
    renderActivity();
    renderChart(st);
    syncTick();
  }

  function tile(label, value, sub) {
    return h('div', { class: 'tile' },
      h('p', { class: 'tile-label' }, label),
      h('p', { class: 'tile-num num' }, value),
      h('p', { class: 'tile-sub' }, sub));
  }
  function renderTiles(st) {
    var waiting = C.segment('free').length;
    U.fill($('#tiles'),
      tile('Stamps today', String(st.stampsToday), plural(st.visitsToday, 'visit', 'visits')),
      tile('Members', String(st.members), C.segment('birthday').length + ' with a birthday this month'),
      tile('Free drinks this week', String(st.freeThisWeek), waiting + ' more waiting on cards'),
      tile('Notes read', st.readRate + '%', 'of ' + plural(st.notesSent, 'note', 'notes') + ' sent'));
  }

  // Members who have tapped "Use now" on their phone and are holding up a code.
  function renderWaiting() {
    var box = $('#waiting'), list = C.pendingRedemptions();
    box.hidden = !list.length;
    redraw(box, function () {
      if (!list.length) return;
      box.appendChild(h('h2', null, 'Waiting at the bar'));
      box.appendChild(h('ul', null, list.map(function (r) {
        var m = C.member(r.memberId);
        return h('li', null,
          h('b', null, m ? m.first : 'A member'),
          h('span', null, r.title),
          h('b', { class: 'code num' }, r.code),
          h('span', { class: 'num dim', dataset: { expires: r.expires } }, countdown(r.expires)),
          h('span', { class: 'waiting-actions' },
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { k: 'wait-open:' + r.id }, onclick: function () { selectMember(r.memberId); } }, 'Open card'),
            h('button', { type: 'button', class: 'btn btn-toast btn-sm', dataset: { k: 'wait-give:' + r.id }, onclick: function () { confirmWaiting(r, m); } }, U.icon('check'), 'Confirm: given')));
      })));
    });
  }

  function resultButton(m, onPick, prefix, current) {
    return h('button', {
      type: 'button', class: 'result', 'aria-current': current ? 'true' : null,
      dataset: { k: prefix + ':' + m.id }, onclick: function () { onPick(m.id); }
    },
      h('span', { class: 'result-main' },
        h('b', null, C.fmt.name(m)),
        h('span', { class: 'result-meta num' }, m.card + ' \u00b7 ' + C.fmt.mobile(m.mobile))),
      h('span', { class: 'result-side num' },
        h('b', null, m.stamps + '/' + need()),
        h('span', null, C.fmt.ago(m.lastVisit))));
  }

  function renderResults() {
    var q = S.query.trim();
    var list = C.findMembers(q).slice(0, q ? 8 : 6);
    $('#results-title').textContent = q ? (list.length ? plural(list.length, 'match', 'matches') : 'No match') : 'Recent at the counter';
    redraw($('#results'), function (box) {
      if (!list.length) {
        box.appendChild(h('li', { class: 'empty' }, 'No member matches that. Check the number, or sign them up at the bar.'));
        return;
      }
      list.forEach(function (m) {
        box.appendChild(h('li', null, resultButton(m, selectMember, 'res', m.id === S.selectedId)));
      });
    });
  }

  function selectMember(id) {
    if (S.selectedId !== id) { S.flash = null; S.stepN = 3; }
    S.selectedId = id;
    renderResults();
    renderMember();
    syncTick();
    if (phone()) $('#member-panel').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  var find = $('#find');
  find.addEventListener('input', function () { S.query = find.value; renderResults(); });
  find.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    var q = find.value.trim();
    var top = q ? C.findMembers(q)[0] : null;
    if (!top) return;
    selectMember(top.id);
    find.select();   // the next scan replaces what is there
  });

  function countdown(expires) {
    var left = Math.max(0, Math.floor((new Date(expires).getTime() - Date.now()) / 1000));
    return 'Expires in ' + Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
  }

  function stampRow(m) {
    var n = need();
    var row = h('div', { class: 'stamps', role: 'img', 'aria-label': m.stamps + ' of ' + n + ' stamps' });
    row.style.setProperty('--n', n);
    row.style.setProperty('--half', Math.ceil(n / 2));
    for (var i = 1; i <= n; i++) {
      row.appendChild(h('span', { class: 'stamp' + (i <= m.stamps ? ' is-on' : '') + (i === n ? ' is-last' : '') },
        U.use('scallop'), h('span', { class: 'num' }, i === n ? 'Free' : String(i))));
    }
    return row;
  }

  function noteState(n) {
    if (n.reply) return h('span', { class: 'state is-replied' }, 'Replied: ' + n.reply.text);
    if (n.read) return h('span', { class: 'state is-read' }, 'Read');
    return h('span', { class: 'state' }, 'Not read yet');
  }

  function rewardRow(m, r) {
    var why = r.pending ? m.first + ' has asked to use it.' : (r.key === 'birthday' && !m.bday) ? 'No birthday on the card' : r.why;
    var li = h('li', { class: 'reward' + (r.pending ? ' is-pending' : r.available ? ' is-ready' : '') },
      h('div', { class: 'reward-text' }, h('b', null, r.title), h('span', null, why)));
    if (r.pending) {
      li.appendChild(h('div', { class: 'reward-code' },
        h('span', null, 'Code on their phone'),
        h('b', { class: 'code num' }, r.pending.code),
        h('span', { class: 'num', dataset: { expires: r.pending.expires } }, countdown(r.pending.expires))));
      li.appendChild(h('button', { type: 'button', class: 'btn btn-toast', dataset: { k: 'confirm:' + r.key }, onclick: function () { confirmGiven(m, r); } },
        U.icon('check'), 'Confirm: given'));
    } else if (r.available) {
      li.appendChild(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { k: 'give:' + r.key }, onclick: function () { give(m, r); } },
        r.key === 'free' ? 'Give free drink now' : 'Give birthday cheesecake'));
    }
    return li;
  }

  function renderMember() {
    var box = $('#member-panel');
    var m = S.selectedId ? C.member(S.selectedId) : null;
    redraw(box, function () {
      box.classList.toggle('is-empty', !m);
      if (!m) {
        box.removeAttribute('aria-labelledby');
        box.appendChild(h('b', null, 'No card open'));
        box.appendChild(h('p', null, 'Scan a card or type the last four digits to add a stamp.'));
        return;
      }
      box.setAttribute('aria-labelledby', 'mp-name');
      var n = need(), lv = C.level(m), usual = C.usualText(m), today = C.male();
      var left = n - m.stamps;

      box.appendChild(h('div', { class: 'mp-top' },
        h('div', { class: 'mp-head' },
          h('div', null,
            h('h2', { class: 'mp-name', id: 'mp-name' }, C.fmt.name(m)),
            h('p', { class: 'mp-meta num' }, m.card, sep(), C.fmt.mobile(m.mobile))),
          h('span', { class: 'level is-' + lv.id }, lv.name)),
        // A row of its own, full width, so it reads in one line and never changes the height above the buttons.
        h('p', { class: 'mp-meta mp-facts' },
          h('span', null, 'Member since ' + C.fmt.monthYear(m.joined)),
          h('span', null, 'Last visit ' + lowerFirst(C.fmt.ago(m.lastVisit))))));

      if (m.bday && m.bday.m === today.m) {
        box.appendChild(h('p', { class: 'mp-flag' }, U.icon('cake'),
          m.bday.d === today.d ? 'Birthday today' : 'Birthday on ' + C.fmt.birthday(m.bday)));
      }

      box.appendChild(h('div', { class: 'mp-usual' },
        h('p', { class: 'mp-label' }, 'Usual'),
        h('p', { class: 'mp-usual-text' + (usual ? '' : ' is-none'), id: 'mp-usual' }, usual || 'No usual saved yet')));

      box.appendChild(h('div', { class: 'mp-actions' },
        h('button', { type: 'button', class: 'btn btn-toast add-btn', dataset: { k: 'add1' }, onclick: function () { addStamps(m.id, 1); } }, U.icon('plus'), 'Add 1 stamp'),
        h('button', { type: 'button', class: 'btn add-btn', dataset: { k: 'add2' }, onclick: function () { addStamps(m.id, 2); } }, 'Add 2'),
        h('div', { class: 'more', role: 'group', 'aria-label': 'Add another amount' },
          h('button', { type: 'button', class: 'step', 'aria-label': 'One fewer', dataset: { k: 'step-down' }, disabled: S.stepN <= 1, onclick: function () { step(-1); } }, '\u2212'),
          h('output', { class: 'more-n num', 'aria-live': 'polite' }, String(S.stepN)),
          h('button', { type: 'button', class: 'step', 'aria-label': 'One more', dataset: { k: 'step-up' }, disabled: S.stepN >= 10, onclick: function () { step(1); } }, '+'),
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { k: 'addn' }, onclick: function () { addStamps(m.id, S.stepN); } }, 'Add ' + S.stepN))));

      if (S.flash && S.flash.memberId === m.id) {
        box.appendChild(h('p', { class: 'mp-flash is-' + S.flash.tone, id: 'mp-flash', role: 'status' }, S.flash.text));
      }

      box.appendChild(h('div', { class: 'mp-stamps' },
        h('div', { class: 'mp-stamps-head' },
          h('p', { class: 'mp-label' }, 'Stamps'),
          h('p', { class: 'mp-count num' },
            h('b', { id: 'mp-count' }, m.stamps + ' of ' + n),
            left === 1 ? 'One more for a free drink' : left + ' more for a free drink',
            m.free ? h('span', { class: 'tag is-bday mp-free', id: 'mp-free' }, plural(m.free, 'free drink', 'free drinks') + ' waiting') : null)),
        stampRow(m),
        h('p', { class: 'mp-life num' }, plural(m.lifetime, 'stamp', 'stamps') + ' in all. ' +
          (lv.next ? lv.toNext + ' more to ' + lv.next.name + '.' : 'Top status.'))));

      box.appendChild(h('div', { class: 'mp-rewards' },
        h('p', { class: 'mp-label' }, 'Rewards'),
        h('ul', null, C.rewardsFor(m).map(function (r) { return rewardRow(m, r); }))));

      var notes = C.notesFor(m.id).filter(function (x) { return !x.auto; }).slice(0, 5);
      var off = KIND_ORDER.filter(function (k) { return m.prefs[C.NOTE_KINDS[k].pref] === false; }).map(function (k) { return KIND_LABEL[k].toLowerCase(); });
      box.appendChild(h('div', { class: 'mp-notes' },
        h('div', { class: 'mp-notes-head' },
          h('p', { class: 'mp-label' }, 'Notes to ' + m.first),
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { k: 'send-note' }, onclick: function () { writeTo(m.id); } }, U.icon('send'), 'Send a note')),
        off.length ? h('p', { class: 'mp-prefs' }, m.first + ' has switched off: ' + off.join(', ') + '.') : null,
        notes.length
          ? h('ul', { class: 'mini-notes' }, notes.map(function (x) {
            return h('li', null,
              h('div', { class: 'mini-text' }, h('b', null, x.title), h('span', null, x.body)),
              h('div', { class: 'mini-state' }, noteState(x), h('span', { class: 'num' }, C.fmt.ago(x.at))));
          }))
          : h('p', { class: 'empty' }, 'No notes sent yet.')));
    }, function () { return phone() ? box : find; });
  }

  function step(d) {
    S.stepN = Math.max(1, Math.min(10, S.stepN + d));
    renderMember();
  }

  function addStamps(id, n) {
    var r = C.addStamps(id, n, { by: BY });
    if (!r) return;
    var m = r.member, target = need(), text;
    if (r.earned > 1) text = 'That filled the card ' + r.earned + ' times. ' + r.earned + ' free drinks are on the card.';
    else if (r.earned) text = 'That was stamp ' + target + '. A free drink is on the card.';
    else text = (n === 1 ? 'Stamp added. ' : n + ' stamps added. ') + m.first + ' is on ' + m.stamps + ' of ' + target + '.';
    if (r.levelUp) text += ' ' + m.first + ' is ' + (r.levelUp.id === 'inner' ? 'in the Inner circle' : 'a Regular') + ' now.';
    S.flash = { memberId: id, tone: r.earned ? 'win' : 'ok', text: text };
    say(plural(n, 'stamp', 'stamps') + ' added for ' + m.first, {
      action: 'Undo',
      onAction: function () {
        if (C.undo(r.activityId)) {
          if (S.selectedId === id) S.flash = { memberId: id, tone: 'ok', text: 'Stamp taken back.' };
          say('Stamp taken back');
          schedule();
        } else {
          say('This can no longer be undone');
        }
      }
    });
  }

  function give(m, r) {
    var isFree = r.key === 'free';
    ask({
      title: isFree ? 'Give ' + m.first + ' a free drink?' : 'Give ' + m.first + ' the birthday cheesecake?',
      body: isFree ? 'This takes one free drink off the card. Do it as you hand the drink over.' : 'This marks the birthday treat as used for this year.',
      ok: isFree ? 'Give free drink' : 'Give cheesecake'
    }).then(function (yes) {
      if (!yes) return;
      if (C.giveReward(m.id, r.key, BY)) {
        var now = C.member(m.id);
        var fresh = now && now.stamps === 0 && now.free === 0;
        S.flash = { memberId: m.id, tone: 'ok', text: isFree ? 'Free drink given.' + (fresh ? ' The card starts a fresh row.' : '') : 'Birthday cheesecake given.' };
        say(isFree ? 'Free drink given to ' + m.first : 'Birthday cheesecake given to ' + m.first);
      } else {
        say('That reward is no longer on the card');
      }
      schedule();
    });
  }

  function confirmGiven(m, r) {
    if (C.confirmRedeem(r.pending.id, BY)) {
      S.flash = { memberId: m.id, tone: 'ok', text: r.title + ' given. Code ' + r.pending.code + ' is used.' };
      say(r.title + ' given to ' + m.first);
    } else {
      say('That code has expired or was cancelled');
    }
    schedule();
  }

  // Confirm from the "Waiting at the bar" strip, without opening the card first.
  function confirmWaiting(r, m) {
    if (C.confirmRedeem(r.id, BY)) {
      if (S.selectedId === r.memberId) S.flash = { memberId: r.memberId, tone: 'ok', text: r.title + ' given. Code ' + r.code + ' is used.' };
      say(r.title + ' given' + (m ? ' to ' + m.first : ''));
    } else {
      say('That code has expired or was cancelled');
    }
    schedule();
  }

  function writeTo(id) {
    S.note.mode = 'one';
    S.note.toId = id;
    go('notes', $('#note-title'));
  }

  // Countdown on a waiting code: once a second, and only while one is on screen.
  var tickTimer = null;
  function syncTick() {
    var showing = S.section === 'counter' && !app.hidden && !!$('[data-section="counter"] [data-expires]');
    if (showing && !tickTimer) tickTimer = setInterval(tick, 1000);
    if (!showing && tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  }
  function tick() {
    var els = $$('[data-section="counter"] [data-expires]'), expired = false;
    if (S.section !== 'counter' || !els.length) { syncTick(); return; }
    els.forEach(function (el) {
      if (new Date(el.dataset.expires).getTime() <= Date.now()) expired = true;
      else el.textContent = countdown(el.dataset.expires);
    });
    if (expired) { renderWaiting(); renderMember(); syncTick(); }
  }

  function activityText(a) {
    if (a.type === 'stamp') return plural(a.n, 'stamp', 'stamps') + (a.earned > 1 ? ', earned ' + a.earned + ' free drinks' : a.earned ? ', earned a free drink' : '');
    if (a.type === 'redeem') return a.reward === 'birthday' ? 'birthday cheesecake given' : 'free drink given';
    if (a.type === 'join') return 'joined the Club';
    return a.type;
  }
  function renderActivity() {
    var today = C.male().key;
    var list = C.state().activity.filter(function (a) { return C.male(a.at).key === today; }).slice(0, 12);
    redraw($('#activity'), function (box) {
      if (!list.length) { box.appendChild(h('li', { class: 'empty' }, 'Nothing yet today.')); return; }
      list.forEach(function (a) {
        var m = C.member(a.memberId);
        box.appendChild(h('li', null,
          h('span', { class: 'act-time num' }, C.fmt.time(a.at)),
          h('span', { class: 'act-what' },
            m ? h('button', { type: 'button', class: 'act-name', dataset: { k: 'act:' + a.id }, onclick: function () { selectMember(m.id); } }, m.first) : h('b', null, 'Former member'),
            ' ' + activityText(a)),
          h('span', { class: 'act-by' }, a.by || '')));
      });
    });
  }

  function renderChart(st) {
    var box = $('#chart'), days = st.visitsByDay;
    var W = Math.max(280, Math.round(box.clientWidth || 520)), H = 190;
    var padT = 20, padB = 36, bw = W / days.length, top = H - padB - padT;
    var max = Math.max.apply(null, days.map(function (d) { return d.n; }).concat([1]));
    var total = days.reduce(function (s, d) { return s + d.n; }, 0);
    var root = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': total + ' visits in the last 14 days, ' + days[days.length - 1].n + ' of them today.' });
    days.forEach(function (d, i) {
      var x = i * bw, bh = Math.max(d.n ? 3 : 0, Math.round(top * d.n / max)), y = H - padB - bh;
      var title = svg('title');
      title.textContent = d.label + ' ' + d.date + ': ' + plural(d.n, 'visit', 'visits');
      var g = svg('g', { class: 'bar' + (i === days.length - 1 ? ' is-today' : '') },
        svg('rect', { class: 'band', x: x, y: 0, width: bw, height: H - padB }, title),
        svg('rect', { class: 'fill', x: x + bw * 0.2, y: y, width: bw * 0.6, height: bh, rx: 4 }));
      var val = svg('text', { class: 'val', x: x + bw / 2, y: y - 6 });
      val.textContent = d.n;
      var day = svg('text', { x: x + bw / 2, y: H - 20 });
      day.textContent = bw < 34 ? d.label.charAt(0) : d.label;
      var date = svg('text', { x: x + bw / 2, y: H - 5 });
      date.textContent = d.date;
      g.appendChild(val); g.appendChild(day); g.appendChild(date);
      root.appendChild(g);
    });
    root.appendChild(svg('line', { class: 'base', x1: 0, x2: W, y1: H - padB + 0.5, y2: H - padB + 0.5 }));
    U.fill(box, root);
  }
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { if (S.section === 'counter' && !app.hidden) renderChart(C.stats()); }, 150);
  });

  /* ---------- 2. members ---------- */

  function membersList() {
    var M = S.mem, list = C.segment(M.seg);
    if (M.q.trim()) {
      var ok = {};
      C.findMembers(M.q).forEach(function (m) { ok[m.id] = true; });
      list = list.filter(function (m) { return ok[m.id]; });
    }
    return list.slice().sort(function (a, b) {
      var r;
      if (M.sort === 'name') r = C.fmt.name(a).localeCompare(C.fmt.name(b));
      else if (M.sort === 'stamps') r = (a.stamps - b.stamps) || (a.free - b.free);
      else r = a.lastVisit < b.lastVisit ? -1 : a.lastVisit > b.lastVisit ? 1 : 0;
      return r * M.dir;
    });
  }

  function openInCounter(id) {
    S.selectedId = id;
    S.flash = null;
    S.stepN = 3;
    S.query = '';
    find.value = '';
    go('counter');
  }

  function renderMembers() {
    var M = S.mem, list = membersList(), n = need(), month = C.male().m;
    var all = C.members().length;
    $('#members-sub').textContent = plural(all, 'member', 'members') + (list.length !== all ? ', ' + list.length + ' shown' : '') + '. Tap a row to open the card at the counter.';

    redraw($('#segs'), function (box) {
      C.SEGMENTS.forEach(function (s) {
        box.appendChild(h('button', {
          type: 'button', class: 'seg', 'aria-pressed': s.id === M.seg ? 'true' : 'false', dataset: { k: 'seg:' + s.id },
          onclick: function () { M.seg = s.id; renderMembers(); }
        }, s.label, h('span', { class: 'n' }, String(C.segment(s.id).length))));
      });
    });

    var write = $('#write-to');
    write.textContent = list.length === 1 ? 'Write to this 1 person' : 'Write to these ' + list.length + ' people';
    write.disabled = !list.length;

    $$('#members-table th[data-sort]').forEach(function (th) {
      if (th.dataset.sort === M.sort) th.setAttribute('aria-sort', M.dir === 1 ? 'ascending' : 'descending');
      else th.removeAttribute('aria-sort');
    });

    $('#members-empty').hidden = !!list.length;
    redraw($('#members-body'), function (body) {
      list.forEach(function (m) {
        var lv = C.level(m), usual = C.usualText(m);
        body.appendChild(h('tr', {
          dataset: { id: m.id },
          onclick: function (e) { if (!e.target.closest('button, a')) openInCounter(m.id); }
        },
          h('td', { class: 'c-name', 'data-label': 'Name' },
            h('button', { type: 'button', class: 'row-open', dataset: { k: 'row:' + m.id }, onclick: function () { openInCounter(m.id); } }, C.fmt.name(m)),
            m.bday && m.bday.m === month ? h('span', { class: 'tag is-bday' }, 'Birthday') : null),
          h('td', { class: 'num', 'data-label': 'Card' }, m.card),
          h('td', { class: 'num', 'data-label': 'Mobile' }, C.fmt.mobile(m.mobile)),
          h('td', { 'data-label': 'Status' }, h('span', { class: 'level is-' + lv.id }, lv.name)),
          h('td', { class: 'num', 'data-label': 'Stamps' }, m.stamps + '/' + n),
          h('td', { class: 'num', 'data-label': 'Free drinks' }, m.free ? String(m.free) : h('span', { class: 'dim' }, '0')),
          h('td', { 'data-label': 'Last visit' }, C.fmt.ago(m.lastVisit)),
          h('td', { class: 'c-usual', 'data-label': 'Usual' }, usual || h('span', { class: 'dim' }, 'Not saved'))));
      });
    });
  }

  $('#members-q').addEventListener('input', function () { S.mem.q = this.value; renderMembers(); });
  $$('[data-sort-btn]').forEach(function (b) {
    b.addEventListener('click', function () {
      var key = b.dataset.sortBtn, M = S.mem;
      if (M.sort === key) M.dir = -M.dir;
      else { M.sort = key; M.dir = key === 'name' ? 1 : -1; }
      renderMembers();
    });
  });
  $('#write-to').addEventListener('click', function () {
    var list = membersList();
    if (!list.length) return;
    if (S.mem.q.trim()) {
      S.note.mode = 'list';
      S.note.listIds = list.map(function (m) { return m.id; });
    } else {
      S.note.mode = 'group';
      S.note.seg = S.mem.seg;
    }
    go('notes', $('#note-title'));
  });

  /* ---------- 3. notes ---------- */

  var noteTitle = $('#note-title'), noteBody = $('#note-body'), noteR1 = $('#note-r1'), noteR2 = $('#note-r2');
  var noteKind = $('#note-kind'), toSeg = $('#to-seg'), toQ = $('#to-q');

  KIND_ORDER.forEach(function (k) { noteKind.appendChild(h('option', { value: k }, KIND_LABEL[k])); });
  C.SEGMENTS.forEach(function (s) { toSeg.appendChild(h('option', { value: s.id }, s.label)); });
  STARTERS.forEach(function (st, i) {
    $('#starters').appendChild(h('button', {
      type: 'button', class: 'starter', dataset: { starter: String(i) },
      onclick: function () {
        S.note.kind = st.kind;
        noteKind.value = st.kind;
        noteTitle.value = st.title;
        noteBody.value = st.body;
        noteR1.value = st.replies[0] || '';
        noteR2.value = st.replies[1] || '';
        renderNotes();
        noteBody.focus();
      }
    }, st.label));
  });

  function recipients() {
    var N = S.note, ids;
    if (N.mode === 'one') ids = N.toId && C.member(N.toId) ? [N.toId] : [];
    else if (N.mode === 'group') ids = C.segment(N.seg).map(function (m) { return m.id; });
    else ids = N.listIds.filter(function (id) { return !!C.member(id); });
    var pref = C.NOTE_KINDS[N.kind].pref;
    var skipped = ids.filter(function (id) { return C.member(id).prefs[pref] === false; });
    var will = ids.filter(function (id) { return skipped.indexOf(id) === -1; });
    return { ids: ids, will: will, skipped: skipped };
  }
  function replies() {
    return [noteR1.value.trim(), noteR2.value.trim()].filter(function (t) { return !!t; });
  }

  function renderNotes() {
    var N = S.note;
    if (N.mode === 'list' && !N.listIds.filter(function (id) { return !!C.member(id); }).length) N.mode = 'one';

    // Who it goes to
    $('#to-mode-list').hidden = !N.listIds.length;
    $('#to-mode-list-text').textContent = 'Picked in Members (' + N.listIds.length + ')';
    $$('input[name="to-mode"]').forEach(function (r) { r.checked = r.value === N.mode; });
    $('#to-one').hidden = N.mode !== 'one';
    $('#to-group').hidden = N.mode !== 'group';
    if (noteKind.value !== N.kind) noteKind.value = N.kind;
    if (toSeg.value !== N.seg) toSeg.value = N.seg;
    $$('option', toSeg).forEach(function (o) {
      var s = C.SEGMENTS.filter(function (x) { return x.id === o.value; })[0];
      var text = s.label + ' (' + C.segment(s.id).length + ')';
      if (o.textContent !== text) o.textContent = text;
    });

    var one = N.mode === 'one' && N.toId ? C.member(N.toId) : null;
    var chosen = $('#to-chosen');
    chosen.hidden = !one;
    $('#to-pick').hidden = !!one;
    redraw(chosen, function () {
      if (!one) return;
      chosen.appendChild(h('span', { class: 'chosen-name' }, h('b', null, C.fmt.name(one)), h('span', { class: 'num' }, one.card + ' \u00b7 ' + C.fmt.mobile(one.mobile))));
      chosen.appendChild(h('button', {
        type: 'button', class: 'linklike', dataset: { k: 'to-change' },
        onclick: function () { N.toId = null; renderNotes(); toQ.focus(); }
      }, 'Change'));
    }, function () { return toQ; });
    if (!one && N.mode === 'one') renderPicker();

    renderSummary();
    renderPreview();
    renderSent();
  }

  function renderPicker() {
    var q = S.note.pickQ.trim();
    var list = C.findMembers(q).slice(0, q ? 5 : 4);
    redraw($('#to-results'), function (box) {
      if (!list.length) { box.appendChild(h('li', { class: 'empty' }, 'No member matches that.')); return; }
      list.forEach(function (m) {
        box.appendChild(h('li', null, resultButton(m, function (id) { S.note.toId = id; S.note.pickQ = ''; toQ.value = ''; renderNotes(); noteTitle.focus(); }, 'pick', false)));
      });
    });
  }

  function renderSummary() {
    var r = recipients(), N = S.note, box = $('#to-summary'), lines = [];
    if (!r.ids.length) {
      if (N.mode !== 'one') lines.push(h('span', null, 'Nobody is in this group right now.'));
    } else if (N.mode === 'one') {
      var m = C.member(r.ids[0]);
      lines.push(r.will.length
        ? h('span', null, m.first + ' will get this.')
        : h('span', { class: 'is-skip' }, m.first + ' has this kind of note switched off and will not get it.'));
    } else {
      lines.push(h('span', { id: 'to-will' }, plural(r.will.length, 'person', 'people') + ' will get this.'));
      if (r.skipped.length) lines.push(h('span', { class: 'is-skip', id: 'to-skipped' }, r.skipped.length + (r.skipped.length === 1 ? ' has' : ' have') + ' this kind of note switched off and will not get it.'));
    }
    var quiet = r.will.filter(function (id) { return C.member(id).prefs.quiet; }).length;
    if (quiet) lines.push(h('span', { class: 'dim' }, (r.will.length === 1 ? 'Quiet hours are on for them' : plural(quiet, 'has', 'have') + ' quiet hours on') + ': at night it arrives without a sound.'));
    U.fill(box, lines);

    var body = noteBody.value.trim(), send = $('#note-send');
    send.disabled = !r.will.length || !body;
    $('#note-send-hint').textContent = !r.ids.length ? 'Choose who this is for.' : !r.will.length ? 'Nobody picked can get this kind of note.' : !body ? 'Write the message.' : '';
    $('#note-count').textContent = noteBody.value.length + ' of 160';
  }

  function renderPreview() {
    var r = recipients(), firstId = r.will[0] || r.ids[0], m = firstId ? C.member(firstId) : null;
    function fillIn(text) { return m ? C.merge(text, m) : text.replace(/\{name\}/gi, 'Name'); }
    var t = noteTitle.value.trim(), b = noteBody.value.trim(), now = C.male();
    var title = $('#push-title'), body = $('#push-body');
    title.textContent = t ? fillIn(t) : 'A note from Cozé';
    title.classList.toggle('is-placeholder', !t);
    body.textContent = b ? fillIn(b) : 'Your message shows here.';
    body.classList.toggle('is-placeholder', !b);
    var rs = replies(), box = $('#push-replies');
    box.hidden = !rs.length;
    U.fill(box, rs.map(function (x) { return h('span', null, x); }));
    $('#phone-time').textContent = (now.h % 12 === 0 ? 12 : now.h % 12) + ':' + String(now.min).padStart(2, '0');
    $('#phone-date').textContent = C.fmt.day(Date.now());
    $('#preview-cap').textContent = !m ? 'Pick who it is for to see their name here.'
      : r.will.length > 1 ? 'How it lands on ' + m.first + '\u2019s phone, the first of ' + r.will.length + '.'
      : 'How it lands on ' + m.first + '\u2019s phone.';
  }

  function renderSent() {
    var log = C.sentLog().slice(0, 30);
    U.fill($('#sent'), log.length ? log.map(function (g) {
      var one = g.count === 1, n0 = g.notes[0], m0 = one ? C.member(n0.to) : null;
      var sample = one ? null : C.member(g.sample);
      return h('li', { class: 'sent-row', dataset: { batch: g.batch } },
        h('div', { class: 'sent-main' },
          h('p', { class: 'sent-meta' },
            h('span', { class: 'tag' }, KIND_LABEL[g.kind] || g.kind),
            h('span', { class: 'num' }, C.fmt.ago(g.at) + ', ' + C.fmt.time(g.at)),
            g.by ? h('span', null, 'by ' + g.by) : null),
          h('p', { class: 'sent-title' }, g.title),
          h('p', { class: 'sent-body' }, g.body),
          one ? null : h('p', { class: 'sent-sample' }, (sample ? 'Shown as sent to ' + sample.first + '.' : 'Shown as one person received it.') + ' Everyone got their own name.')),
        h('div', { class: 'sent-side' },
          h('p', { class: 'sent-to' }, one ? 'To ' + (m0 ? C.fmt.name(m0) : 'a former member') : 'Sent to ' + g.count + ' people'),
          h('p', { class: 'sent-read num' }, one ? (n0.read ? 'Read' : 'Not read yet') : 'Read by ' + g.read + ' of ' + g.count),
          g.replies.length ? h('ul', { class: 'sent-replies' }, g.replies.map(function (rp) {
            var m = C.member(rp.memberId);
            return h('li', null, h('b', null, (m ? m.first : 'Former member') + ': '), rp.text);
          })) : null));
    }) : h('li', { class: 'empty' }, 'Nothing sent yet.'));
  }

  $$('input[name="to-mode"]').forEach(function (r) {
    r.addEventListener('change', function () { if (r.checked) { S.note.mode = r.value; renderNotes(); } });
  });
  toQ.addEventListener('input', function () { S.note.pickQ = toQ.value; renderPicker(); });
  toQ.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    var top = toQ.value.trim() ? C.findMembers(toQ.value.trim())[0] : null;
    if (top) { S.note.toId = top.id; S.note.pickQ = ''; toQ.value = ''; renderNotes(); noteTitle.focus(); }
  });
  toSeg.addEventListener('change', function () { S.note.seg = toSeg.value; renderSummary(); renderPreview(); });
  noteKind.addEventListener('change', function () { S.note.kind = noteKind.value; renderSummary(); renderPreview(); });
  [noteTitle, noteBody, noteR1, noteR2].forEach(function (el) {
    el.addEventListener('input', function () { renderSummary(); renderPreview(); });
  });

  $('#note-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var r = recipients(), body = noteBody.value.trim();
    if (!r.will.length || !body) return;
    var res = C.sendNote({ to: r.ids, kind: S.note.kind, title: noteTitle.value.trim() || 'A note from Cozé', body: body, replies: replies(), by: BY });
    if (!res.sent.length) { say('Nobody could be sent this note'); return; }
    var who = res.sent.length === 1 ? C.member(r.will[0]).first : res.sent.length + ' people';
    say('Sent to ' + who + (res.skipped.length ? '. ' + res.skipped.length + ' skipped' : ''));
    noteTitle.value = ''; noteBody.value = ''; noteR1.value = ''; noteR2.value = '';
    renderNotes();
  });

  /* ---------- 4. this week ---------- */

  function offersNow() { return JSON.parse(JSON.stringify(C.state().offers)); }

  function ticket(o) {
    return h('div', { class: 'ticket' },
      h('div', { class: 'ticket-img' },
        h('img', { alt: '', loading: 'lazy', src: '../assets/img/' + encodeURIComponent(o.img) }),
        o.sticker && o.sticker.trim() ? U.sticker(o.sticker.trim(), { tone: o.tone, size: 80, tilt: 9 }) : null),
      h('div', { class: 'ticket-text' },
        h('p', { class: 'ticket-when' }, o.when),
        h('p', { class: 'ticket-title' }, o.title),
        h('p', { class: 'ticket-body' }, o.body)),
      h('div', { class: 'ticket-foot num' }, h('span', null, o.valid), h('span', null, 'No. ' + o.no)));
  }

  function buildWeek() {
    var box = $('#offers');
    U.clear(box);
    S.week.draft.forEach(function (o, i) {
      var preview = h('div', { class: 'ticket-slot' }, ticket(o));
      function field(label, key, max, multi) {
        var id = 'offer-' + i + '-' + key;
        var input = multi
          ? h('textarea', { id: id, maxlength: String(max), rows: '2' })
          : h('input', { id: id, type: 'text', maxlength: String(max), autocomplete: 'off' });
        input.value = o[key] || '';
        input.addEventListener('input', function () {
          o[key] = input.value;
          S.week.dirty = true;
          weekHead();
          U.fill(preview, ticket(o));
        });
        return h('label', { class: 'field', for: id }, h('span', null, label), input);
      }
      box.appendChild(h('article', { class: 'card offer' },
        h('div', { class: 'offer-form' },
          h('h2', { class: 'card-title' }, 'Offer ' + (i + 1), h('span', { class: 'dim num' }, ' \u00b7 No. ' + o.no)),
          field('When', 'when', 60),
          field('Title', 'title', 70),
          field('Details', 'body', 160, true),
          h('div', { class: 'two' }, field('Valid line', 'valid', 40), field('Sticker text', 'sticker', 22))),
        h('div', { class: 'offer-preview' }, h('span', { class: 'label' }, 'How it looks'), preview)));
    });
  }

  function weekReady() {
    return !!S.week.draft && S.week.draft.every(function (o) { return !!String(o.title || '').trim(); });
  }
  // The header buttons and the bar under the third offer always say the same thing.
  function weekHead() {
    var dirty = S.week.dirty, ready = weekReady();
    $$('[data-week-unsaved]').forEach(function (el) { el.hidden = !dirty; });
    $$('[data-week-hint]').forEach(function (el) { el.hidden = !dirty || ready; });
    $$('[data-week-publish]').forEach(function (el) { el.disabled = !dirty || !ready; });
    $$('[data-week-discard]').forEach(function (el) { el.disabled = !dirty; });
    $('#week-bar').classList.toggle('is-dirty', dirty);
  }

  function renderWeek() {
    var W = S.week, box = $('#offers');
    var typing = box.contains(document.activeElement);
    var stale = !W.draft || (!W.dirty && JSON.stringify(W.draft) !== JSON.stringify(C.state().offers));
    // Offers changed elsewhere and nothing is being edited here: show the new ones.
    if (!W.draft || (stale && !typing)) {
      W.draft = offersNow();
      W.dirty = false;
      buildWeek();
    }
    weekHead();
  }

  function publishWeek() {
    if (!S.week.dirty || !weekReady()) return;
    C.saveOffers(S.week.draft);
    S.week.draft = offersNow();
    S.week.dirty = false;
    buildWeek();
    weekHead();
    say('Published to the site and the club card');
  }
  function discardWeek() {
    S.week.draft = offersNow();
    S.week.dirty = false;
    buildWeek();
    weekHead();
    say('Changes discarded');
  }
  $$('[data-week-publish]').forEach(function (b) { b.addEventListener('click', publishWeek); });
  $$('[data-week-discard]').forEach(function (b) { b.addEventListener('click', discardWeek); });

  /* ---------- 5. settings ---------- */

  var setForm = $('#settings-form'), setStamps = $('#set-stamps');

  function fillSettings() {
    var s = C.state().settings;
    setStamps.value = s.stampsForFree;
    $('#set-welcome').checked = !!s.welcomeStamp;
    $('#set-open').value = s.open;
    $('#set-close').value = s.close;
    $('#set-hint').textContent = '';
    S.set.filled = true;
    S.set.dirty = false;
  }
  function renderSettings() {
    if (!S.set.filled || (!S.set.dirty && !setForm.contains(document.activeElement))) fillSettings();
  }
  setForm.addEventListener('input', function () { S.set.dirty = true; $('#set-hint').textContent = ''; });
  $$('[data-set-step]').forEach(function (b) {
    b.addEventListener('click', function () {
      var v = Math.round(+setStamps.value) || C.state().settings.stampsForFree;
      setStamps.value = Math.max(4, Math.min(12, v + +b.dataset.setStep));
      S.set.dirty = true;
      $('#set-hint').textContent = '';
    });
  });
  setForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var hint = $('#set-hint');
    var n = Math.round(+setStamps.value), open = $('#set-open').value, close = $('#set-close').value;
    if (!(n >= 4 && n <= 12)) { hint.textContent = 'Choose a number of stamps from 4 to 12.'; setStamps.focus(); return; }
    if (!/^\d\d:\d\d/.test(open) || !/^\d\d:\d\d/.test(close)) { hint.textContent = 'Set both the opening and the closing time.'; return; }
    var full = C.members().filter(function (m) { return m.stamps >= n; }).length;
    function save() {
      C.saveSettings({ stampsForFree: n, welcomeStamp: $('#set-welcome').checked, open: open.slice(0, 5), close: close.slice(0, 5) });
      fillSettings();
      say('Settings saved' + (full ? '. ' + plural(full, 'full card', 'full cards') + ' became free drinks' : ''));
    }
    if (!full) { save(); return; }
    ask({
      title: 'Lower it to ' + n + ' stamps?',
      body: plural(full, 'card already has', 'cards already have') + ' ' + n + ' stamps or more. ' + (full === 1 ? 'It turns into a free drink' : 'They turn into free drinks') + ' straight away.',
      ok: 'Lower it'
    }).then(function (yes) { if (yes) save(); });
  });

  $('#reset-demo').addEventListener('click', function () {
    ask({
      title: 'Reset the demo data?',
      body: 'Members, stamps, notes and offers go back to the samples. Anyone signed in on the club card is signed out.',
      ok: 'Reset', danger: true
    }).then(function (yes) {
      if (!yes) return;
      S.selectedId = null; S.flash = null; S.query = ''; find.value = '';
      S.note.toId = null; S.note.listIds = []; S.note.mode = 'one';
      S.week.draft = null; S.week.dirty = false;
      S.set.filled = false;
      C.reset();
      say('Demo data reset');
    });
  });

  /* ---------- go ---------- */

  C.on(function (reason) {
    if (reason === 'not-saving') { notSaving(); return; }
    schedule();
  });
  window.addEventListener('resize', measureBar);
  // Keep "2 min ago", the open pill and the lock-screen clock honest while the tab sits open.
  setInterval(function () { if (!app.hidden && !document.hidden && !askDlg.open) schedule(); }, 60000);

  if (C.staffIn()) showApp(); else showGate();
})();
