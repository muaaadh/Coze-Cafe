/*
 * Cozé club card: what a member of the Club sees.
 * Reads and writes through window.COZE (assets/js/store.js) and redraws itself whenever the store changes,
 * including changes made in another tab by the staff counter.
 * People's names and note text always go in as text nodes (UI.h), never as HTML.
 */
(function () {
  'use strict';

  var C = window.COZE, U = window.UI, h = U.h;
  var TABS = ['card', 'rewards', 'notes', 'you'];
  var IMG = '../assets/img/';
  var SITE = '../index.html', STAFF = '../staff/index.html';   // named in full: file:// cannot open a folder
  var ICON = new URL(IMG + 'icon-192.png', location.href).href;   // a full address, so it resolves the same from the service worker
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function $(id) { return document.getElementById(id); }
  var el = {
    phone: $('phone'), gate: $('gate'), app: $('app'), view: $('view'),
    banner: $('banner'), bannerTitle: $('bannerTitle'), bannerBody: $('bannerBody'),
    bellCount: $('bellCount'), bellLabel: $('bellLabel'), notesDot: $('notesDot'), rewardsDot: $('rewardsDot'),
    joinForm: $('joinForm'), joinError: $('joinError'), signInForm: $('signInForm'), signInError: $('signInError'),
    qrSheet: $('qrSheet'), askSheet: $('askSheet')
  };

  var S = {
    tab: 'card',
    built: null,          // "tab|memberId" of what is drawn in the view right now
    wasIn: false,         // were we signed in at the last draw
    seenFor: null,        // member whose notes we are tracking
    seen: {},             // note ids already known, so only new ones ring
    prev: null,           // { id, stamps, free, lifetime } at the last draw
    popFrom: null,        // stamps from this index pop in on the next card draw
    popBand: false,       // the free drink band pops in on the next card draw
    holdFull: null,       // { until, from }: show a full row for a beat before it turns into a free drink
    holdTimer: null,
    pendingIds: {},       // reward codes that were waiting at the last look
    justGiven: null,      // reward key that staff just confirmed
    newIds: {},           // notes that were unread when Notes was opened
    readTimer: null,
    youDirty: false,      // unsaved typing in the profile form
    welcome: false,       // a card is being created right now
    sampleAt: 0, sampleTimer: null, sampleN: 0,
    queue: [], bannerOn: false, bannerTimer: null,
    bannerId: null,       // note id the banner is showing, so it can be taken down if the note is withdrawn
    plain: {},            // notifications shown by the page itself (no service worker), by tag
    toldNotSaving: false,
    swReg: null,
    askYes: null, openerKey: null
  };

  /* ---------- small helpers ---------- */

  function options(select, list, value, placeholder) {
    U.clear(select);
    if (placeholder != null) select.appendChild(h('option', { value: '' }, placeholder));
    list.forEach(function (o) {
      var opt = h('option', { value: String(o.value) }, o.label);
      if (String(o.value) === String(value == null ? '' : value)) opt.selected = true;
      select.appendChild(opt);
    });
    return select;
  }
  function dayOptions() { var a = []; for (var d = 1; d <= 31; d++) a.push({ value: d, label: String(d) }); return a; }
  function monthOptions() { return C.MONTHS.map(function (m, i) { return { value: i + 1, label: m }; }); }
  function drinkOptions() { return C.DRINKS.map(function (d) { return { value: d.id, label: d.name }; }); }
  function showError(node, msg) { node.textContent = msg || ''; node.hidden = !msg; }
  function remaining(expires) {
    var s = Math.max(0, Math.round((new Date(expires).getTime() - Date.now()) / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function quietNow() { var p = C.male(); return p.h >= 22 || p.h < 8; }

  /* ---------- tabs ---------- */

  function tabFromHash() {
    var t = location.hash.replace('#', '');
    return TABS.indexOf(t) !== -1 ? t : 'card';
  }
  function go(tab) {
    if (location.hash !== '#' + tab) location.hash = tab;   // the hashchange handler does the rest
    else setTab(tab);
  }
  function setTab(tab) {
    var changed = tab !== S.tab;
    if (changed && S.tab === 'notes') S.newIds = {};
    S.tab = tab;
    if (changed) S.youDirty = false;
    var me = C.currentMember();
    if (me && tab === 'notes') enterNotes(me);
    render({ fresh: changed });
  }
  window.addEventListener('hashchange', function () { setTab(tabFromHash()); });

  /* ---------- drawing ---------- */

  function render(opts) {
    opts = opts || {};
    var me = C.currentMember();
    if (!me) { showGate(); return; }
    if (!S.wasIn) {
      S.wasIn = true;
      el.gate.hidden = true;
      el.app.hidden = false;
      showError(el.joinError, ''); showError(el.signInError, '');
      opts.fresh = true;
      if (S.tab === 'notes') enterNotes(me);
    }
    track(me);
    chrome(me);

    var view = el.view, key = S.tab + '|' + me.id;
    var active = document.activeElement;
    var inView = !!(active && view.contains(active));
    // The profile form is left alone while someone is typing in it or has unsaved changes.
    if (S.tab === 'you' && S.built === key && !opts.fresh) {
      if (S.youDirty || (inView && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName))) {
        refreshBirthday(me);     // the one part that can change under the form: set or removed at the bar
        return;
      }
    }
    var focusKey = inView && active.dataset ? active.dataset.k : null;
    var top = view.scrollTop;
    var strip = view.querySelector('.tickets');
    var stripLeft = strip ? strip.scrollLeft : 0;

    U.fill(view, VIEWS[S.tab](me));
    S.built = key;

    view.scrollTop = opts.fresh ? 0 : top;
    strip = view.querySelector('.tickets');
    if (strip && !opts.fresh) strip.scrollLeft = stripLeft;
    if (focusKey) {
      var again = view.querySelector('[data-k="' + focusKey + '"]');
      if (again) again.focus({ preventScroll: true });
    }
  }

  function showGate() {
    var was = S.wasIn;
    S.wasIn = false; S.built = null; S.prev = null; S.seenFor = null; S.seen = {}; S.pendingIds = {};
    S.popFrom = null; S.popBand = false; S.holdFull = null; S.newIds = {}; S.youDirty = false;
    S.queue = []; hideBanner(true);
    if (el.qrSheet.open) el.qrSheet.close();
    if (el.askSheet.open) el.askSheet.close();
    el.app.hidden = true;
    el.gate.hidden = false;
    U.clear(el.view);
    gateCopy();
    if (was) {
      // Coming back from a card: start clean, with no old errors or leftover messages.
      el.gate.scrollTop = 0;
      showError(el.joinError, ''); showError(el.signInError, '');
      Array.prototype.forEach.call(document.querySelectorAll('.toast'), function (t) { if (t.parentNode) t.parentNode.removeChild(t); });
    }
  }

  // The join screen quotes the settings, so it stays true when staff change them.
  function gateCopy() {
    $('gateStamps').textContent = C.fmt.word(C.state().settings.stampsForFree);
  }

  // Notices what changed since the last draw: new stamps, a finished row, a reward handed over.
  function track(me) {
    var p = S.prev;
    if (S.welcome) { S.popFrom = 0; S.welcome = false; }
    if (p && p.id === me.id) {
      // Only a real new stamp (the all-time count went up) is animated. A stamp taken back at the bar also
      // moves the numbers, and must not replay the pop on the stamps that are left.
      var up = me.lifetime > p.lifetime;
      if (up && el.qrSheet.open) {                             // so the stamp landing and the banner are seen
        S.openerKey = null;
        closeSheet(el.qrSheet);
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      }
      if (up && me.free > p.free) {
        S.popBand = true;
        S.popFrom = null;
        if (!reduceMotion && !document.hidden) S.holdFull = { until: Date.now() + 1500, from: p.stamps };
      } else if (up && me.stamps > p.stamps) {
        S.popFrom = S.popFrom == null ? p.stamps : Math.min(S.popFrom, p.stamps);
      } else if (!up && (me.stamps !== p.stamps || me.free !== p.free)) {
        S.popFrom = null; S.holdFull = null; clearTimeout(S.holdTimer);
        S.popBand = me.free > p.free;
      }
    }
    S.prev = { id: me.id, stamps: me.stamps, free: me.free, lifetime: me.lifetime };

    var now = {};
    C.pendingRedemptions(me.id).forEach(function (r) { now[r.id] = 1; });
    Object.keys(S.pendingIds).forEach(function (id) {
      if (now[id]) return;
      var r = C.state().redemptions.filter(function (x) { return x.id === id; })[0];
      if (!r) return;
      if (r.status === 'given') {
        // The "Enjoy" note arrives as a banner, so no second message here.
        S.justGiven = r.reward;
        setTimeout(function () { S.justGiven = null; }, 1500);
      } else if (r.status === 'expired') {
        U.toast('That code ran out. Nothing left your card.');
      }
    });
    S.pendingIds = now;
  }

  function chrome(me) {
    var n = C.unread(me.id);
    el.bellCount.textContent = n > 9 ? '9+' : String(n);
    el.bellCount.hidden = n === 0;
    el.bellLabel.textContent = n ? 'Notes, ' + n + ' unread' : 'Notes';
    el.notesDot.hidden = n === 0 || S.tab === 'notes';
    el.rewardsDot.hidden = !C.rewardsFor(me).some(function (r) { return r.available; }) || S.tab === 'rewards';
    Array.prototype.forEach.call(document.querySelectorAll('.tabbar a'), function (a) {
      if (a.dataset.tab === S.tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }

  var VIEWS = { card: viewCard, rewards: viewRewards, notes: viewNotes, you: viewYou };

  /* ---------- Card ---------- */

  function viewCard(me) {
    var st = C.state(), need = st.settings.stampsForFree;
    var hold = S.holdFull && Date.now() < S.holdFull.until ? S.holdFull : null;
    if (!hold) S.holdFull = null;
    var got = hold ? need : me.stamps;
    var popFrom = hold ? hold.from : S.popFrom;
    S.popFrom = null;
    if (hold) {
      hold.from = need;   // pop once, not on every redraw during the pause
      clearTimeout(S.holdTimer);
      S.holdTimer = setTimeout(function () { render({}); }, Math.max(60, hold.until - Date.now() + 40));
    }

    var cols = need <= 5 ? need : Math.ceil(need / 2);
    var grid = h('ol', { class: 'stamps', style: { '--cols': String(cols) }, 'aria-label': got + ' of ' + need + ' stamps collected' });
    for (var i = 0; i < need; i++) {
      var isGot = i < got, isLast = i === need - 1, isNew = isGot && popFrom != null && i >= popFrom;
      var li = h('li', { class: 'stamp ' + (isGot ? 'is-got' : 'is-empty') + (isLast ? ' is-last' : '') + (isNew ? ' is-new' : '') });
      li.style.setProperty('--r', (((i * 37) % 23) - 11) + 'deg');
      if (isNew) li.style.animationDelay = ((i - popFrom) * 120) + 'ms';
      li.appendChild(U.use('scallop', 'shape'));
      li.appendChild(isGot ? U.icon('cup') : h('span', { class: 'n' }, isLast ? 'Free' : String(i + 1)));
      grid.appendChild(li);
    }

    var left = need - got, line;
    if (hold) line = [h('b', null, 'That is ' + need + '.'), ' Your next drink is on us.'];
    else if (got === 0 && me.lifetime > 0) line = [h('b', null, 'A fresh row.'), ' ' + need + ' stamps to the next free drink.'];
    else if (got === 0) line = [h('b', null, 'Your club card is ready.'), ' ' + need + ' stamps to a free drink.'];
    else if (left === 1) line = [h('b', null, got + ' of ' + need + '.'), ' One more and the next drink is on us.'];
    else line = [h('b', null, got + ' of ' + need + '.'), ' ' + left + ' to go for a free drink.'];

    var lv = C.level(me);
    var card = h('section', { class: 'clubcard', dataset: { stamps: String(got), free: String(me.free) } },
      h('div', { class: 'clubcard-top' }, U.wordmark(), h('span', null, 'Club card')),
      h('h1', { class: 'clubcard-name' }, me.first),
      h('p', { class: 'clubcard-meta' },
        h('span', { class: 'cardno num' }, me.card),
        h('span', { class: 'clubcard-level' }, lv.name),
        h('span', null, 'Member since ' + C.fmt.monthYear(me.joined))),
      grid,
      h('p', { class: 'clubcard-line' }, line),
      h('button', { class: 'btn btn-sun btn-block', type: 'button', dataset: { k: 'show' }, onclick: function () { openQr(me.id); } }, U.icon('qr'), 'Show at the bar'));

    var out = [card];

    if (me.free > 0 && !hold) {
      out.push(h('section', { class: 'freeband' + (S.popBand ? ' is-new' : ''), id: 'freeBand' },
        U.sticker('on us', { size: 66, tone: 'toast', tilt: -12, big: me.free > 1 ? String(me.free) : null }),
        h('div', { class: 'freeband-text' },
          h('b', null, me.free > 1 ? 'You have ' + me.free + ' free drinks waiting' : 'You have a free drink waiting'),
          h('span', null, 'Anything on the menu.')),
        h('a', { class: 'btn btn-sm', href: '#rewards', dataset: { k: 'usefree' } }, 'Use it')));
      S.popBand = false;
    }

    var usual = C.usualText(me);
    out.push(h('section', { class: 'rowcard' },
      h('div', null, h('p', { class: 'rowcard-label' }, 'Your usual'), h('p', { class: 'rowcard-value' }, usual || 'Tell us your usual')),
      h('a', { class: 'linklike', href: '#you', dataset: { k: 'usual' } }, usual ? 'Change' : 'Add it')));

    var fresh = C.notesFor(me.id).filter(function (n) { return !n.read; });
    if (fresh.length) {
      out.push(h('a', { class: 'notepeek', href: '#notes', dataset: { k: 'peek' } },
        h('span', { class: 'notepeek-top' }, h('span', null, fresh.length > 1 ? fresh.length + ' new notes' : 'New note'), h('span', null, C.fmt.ago(fresh[0].at))),
        h('b', null, fresh[0].title),
        h('span', { class: 'notepeek-body' }, fresh[0].body)));
    }

    out.push(h('h2', { class: 'sec-title' }, 'This week at Cozé'));
    out.push(h('div', { class: 'tickets', tabindex: '0', role: 'group', 'aria-label': 'This week at Cozé' }, st.offers.map(offerTicket)));

    var acts = st.activity.filter(function (a) { return a.memberId === me.id; }).slice(0, 5);
    out.push(h('h2', { class: 'sec-title' }, 'Recent visits'));
    out.push(acts.length ? h('ul', { class: 'visits' }, acts.map(visitRow)) : h('p', { class: 'empty' }, 'No visits yet. Show your card at the bar to start.'));
    return out;
  }

  function offerTicket(o) {
    var img = h('img', { alt: '', width: '900', height: '600' });
    img.loading = 'lazy'; img.decoding = 'async';
    img.src = IMG + o.img;
    var words = String(o.sticker || '').trim();      // no words, no sticker
    return h('article', { class: 'ticket' },
      h('div', { class: 'ticket-photo' }, img,
        words ? U.sticker(words, { tone: o.tone && o.tone !== 'sun' ? o.tone : null, tilt: 9 }) : null),
      h('div', { class: 'ticket-body' }, h('p', { class: 'ticket-when' }, o.when), h('h3', null, o.title), h('p', { class: 'ticket-desc' }, o.body)),
      h('div', { class: 'ticket-foot' }, h('span', null, o.valid), h('span', { class: 'num' }, 'No. ' + o.no)));
  }

  function visitRow(a) {
    var text = 'Visit', icon = 'cup';
    if (a.type === 'stamp') text = a.n > 1 ? a.n + ' stamps added' : 'Stamp added';
    else if (a.type === 'redeem') { text = a.reward === 'birthday' ? 'Birthday cheesecake, on us' : 'Free drink, on us'; icon = 'gift'; }
    else if (a.type === 'join') { text = 'Joined the Club'; icon = 'card'; }
    return h('li', null, U.icon(icon), h('b', null, text), h('time', { datetime: a.at }, C.fmt.day(a.at) + ', ' + C.fmt.time(a.at)));
  }

  function openQr(memberId) {
    var me = C.member(memberId);
    if (!me) return;
    U.fill($('qrBox'), U.qr('COZE:' + me.card, { label: 'QR code for card ' + me.card }));
    $('qrNumber').textContent = me.card;
    $('qrName').textContent = me.first;
    var usual = C.usualText(me);
    $('qrUsual').textContent = usual ? 'Usual: ' + usual : '';
    $('qrUsual').hidden = !usual;
    openSheet(el.qrSheet);
  }

  /* ---------- Rewards ---------- */

  function viewRewards(me) {
    var out = [
      h('h1', { class: 'view-title' }, 'Rewards'),
      h('p', { class: 'view-sub' }, 'Tap Use now for a code to show at the bar. Nothing leaves your card until the barista confirms.')
    ];
    C.rewardsFor(me).forEach(function (r) { out.push(r.pending ? pendingTicket(r) : rewardTicket(me, r)); });
    out.push(statusPanel(me));
    return out;
  }

  function rewardTicket(me, r) {
    var mark;
    if (r.available) {
      mark = r.key === 'free'
        ? U.sticker(r.count > 1 ? 'ready' : 'on us', { big: r.count > 1 ? String(r.count) : null, tilt: 9 })
        : U.sticker('this month', { tone: 'toast', tilt: 9 });
    } else {
      mark = h('span', { class: 'reward-icon' }, U.icon(r.key === 'free' ? 'cup' : 'cake'));
    }
    // A birthday can be added once from the card. After that it is the bar's job, so the link goes away.
    var noBday = r.key === 'birthday' && !me.bday;
    var why = noBday && me.bdayLocked ? 'Ask at the bar to add your birthday' : r.why;
    return h('article', { class: 'reward' + (r.available ? ' is-ready' : '') + (S.justGiven === r.key ? ' is-celebrate' : ''), dataset: { reward: r.key, state: r.available ? 'ready' : 'locked' } },
      h('div', { class: 'reward-body' }, h('div', null, h('h2', null, r.title), h('p', { class: 'reward-desc' }, r.desc)), mark),
      h('div', { class: 'reward-foot' },
        h('span', { class: 'reward-why' }, why),
        r.available ? h('button', { class: 'btn btn-toast btn-sm', type: 'button', dataset: { k: 'use-' + r.key }, onclick: function () { askUse(me.id, r); } }, 'Use now')
          : (noBday && !me.bdayLocked ? h('a', { class: 'linklike', href: '#you', dataset: { k: 'addbday' } }, 'Add it') : null)));
  }

  function pendingTicket(r) {
    var p = r.pending;
    return h('article', { class: 'reward is-pending', dataset: { reward: r.key, state: 'pending' } },
      h('p', { class: 'reward-kicker' }, r.title),
      h('p', { class: 'code', 'aria-label': 'Code ' + p.code.split('').join(' ') }, p.code),
      h('p', { class: 'reward-show' }, 'Show this at the bar'),
      h('p', { class: 'reward-timer' }, 'Code valid for ', h('span', { class: 'num', dataset: { expires: p.expires } }, remaining(p.expires))),
      h('button', { class: 'linklike', type: 'button', dataset: { k: 'cancel-' + r.key }, onclick: function () {
        if (C.cancelRedeem(p.id)) U.toast('Cancelled. It is still on your club card.');
      } }, 'Cancel, I will use it later'));
  }

  function askUse(memberId, r) {
    ask({
      title: r.key === 'free' ? 'Use your free drink now?' : 'Use your birthday cheesecake now?',
      text: ['You get a code to show at the bar. It lasts ' + C.REDEEM_MINUTES + ' minutes.', 'Nothing leaves your card until the barista confirms it.'],
      yes: 'Use now', no: 'Not yet',
      onYes: function () {
        var red = C.startRedeem(memberId, r.key);
        if (!red) U.toast('That reward is not ready yet.');
      }
    });
  }

  function statusPanel(me) {
    var lv = C.level(me), L = C.LEVELS, at = 0;
    L.forEach(function (x, i) { if (x.id === lv.id) at = i; });
    var pct = 100;
    if (lv.next) pct = (at + (me.lifetime - lv.min) / (lv.next.min - lv.min)) / (L.length - 1) * 100;
    var track = h('div', { class: 'level-track', 'aria-hidden': 'true' }, h('div', { class: 'level-fill', style: { width: pct.toFixed(1) + '%' } }));
    L.forEach(function (x, i) {
      track.appendChild(h('span', { class: 'level-node' + (i <= at ? ' is-done' : ''), style: { left: (i / (L.length - 1) * 100) + '%' } }));
    });
    track.appendChild(h('span', { class: 'level-here', style: { left: pct.toFixed(1) + '%' } }));
    return h('section', { class: 'panel status' },
      h('h2', null, 'Your status'),
      h('p', { class: 'status-now' }, h('b', null, lv.name), '. ' + me.lifetime + (me.lifetime === 1 ? ' stamp' : ' stamps') + ' so far.' +
        (lv.next ? ' ' + lv.toNext + ' more ' + (lv.toNext === 1 ? 'stamp' : 'stamps') + ' to ' + lv.next.name + '.' : ' You are at the top.')),
      track,
      h('ol', { class: 'levels' }, L.map(function (x, i) {
        return h('li', { class: i > at ? 'is-locked' : i === at ? 'is-current' : '' },
          h('div', { class: 'levels-head' }, h('b', null, x.name),
            h('span', null, x.min === 0 ? 'From your first visit' : 'From ' + x.min + ' stamps'),
            i === at ? h('span', { class: 'here' }, 'You are here') : null),
          h('p', null, x.perk));
      })));
  }

  /* ---------- Notes ---------- */

  function enterNotes(me) {
    S.newIds = {};
    C.notesFor(me.id).forEach(function (n) { if (!n.read) S.newIds[n.id] = 1; });
    scheduleRead();
  }
  // Opening Notes marks them read after a moment, so the "New" tags are seen first.
  function scheduleRead() {
    clearTimeout(S.readTimer);
    S.readTimer = setTimeout(function () {
      var me = C.currentMember();
      if (!me || S.tab !== 'notes' || document.hidden) return;
      C.notesFor(me.id).forEach(function (n) { if (!n.read) S.newIds[n.id] = 1; });
      C.markAllRead(me.id);
    }, 1500);
  }

  function viewNotes(me) {
    var notes = C.notesFor(me.id);
    return [
      h('h1', { class: 'view-title' }, 'Notes for you'),
      h('p', { class: 'view-sub' }, 'Written to you, not to everyone.'),
      notes.length ? h('ol', { class: 'notes' }, noteItem(notes[0])) : h('p', { class: 'empty' }, 'Nothing yet. Notes from the bar land here.'),
      permCard(),
      notes.length > 1 ? h('ol', { class: 'notes', start: '2' }, notes.slice(1).map(noteItem)) : null,
      h('section', { class: 'demobox' },
        h('p', { class: 'demobox-tag' }, 'Demo'),
        h('p', null, 'No staff counter open? Send yourself a sample note to see how one arrives.'),
        h('button', { class: 'btn btn-ghost btn-block', type: 'button', id: 'sampleBtn', dataset: { k: 'sample' }, disabled: !!S.sampleAt, onclick: sample }, sampleLabel()))
    ];
  }

  function noteItem(n) {
    var isNew = !n.read || !!S.newIds[n.id];
    var kind = C.NOTE_KINDS[n.kind] ? C.NOTE_KINDS[n.kind].label : 'Note';
    var tail = null;
    if (n.replies && n.reply) {
      tail = h('p', { class: 'note-replied' }, U.icon('check'), 'You replied: ' + n.reply.text);
    } else if (n.replies) {
      tail = h('div', { class: 'note-replies' }, n.replies.map(function (text, i) {
        return h('button', { class: 'btn btn-sm ' + (i === 0 ? 'btn-toast' : 'btn-ghost'), type: 'button', dataset: { k: 'reply-' + n.id + '-' + i }, onclick: function (e) {
          e.stopPropagation();
          if (C.reply(n.id, text)) U.toast('Sent to the bar: ' + text);
        } }, text);
      }));
    }
    return h('li', { class: 'note' + (isNew ? ' is-new' : ''), dataset: { note: n.id }, onclick: function () { if (!n.read) { S.newIds[n.id] = 1; C.markRead(n.id); } } },
      h('div', { class: 'note-top' }, h('span', null, kind), h('time', { datetime: n.at }, C.fmt.ago(n.at))),
      h('h2', null, isNew ? h('span', { class: 'note-new' }, 'New') : null, n.title),
      h('p', null, n.body),
      tail);
  }

  function permState() { return 'Notification' in window ? window.Notification.permission : 'none'; }

  function permCard() {
    var state = permState();
    if (state === 'none') {
      return h('section', { class: 'perm is-off', dataset: { perm: 'none' } }, h('div', null,
        h('b', null, 'No notifications in this browser tab'),
        h('p', null, 'On iPhone, notifications only work from the Home Screen. Add this page to your Home Screen and open it from there. In this demo that copy starts empty, so get your card again in it.')));
    }
    if (state === 'granted') {
      return h('section', { class: 'perm is-on', dataset: { perm: 'granted' } }, h('div', null,
        h('b', null, 'Notifications are on for this device')),
        h('button', { class: 'btn btn-sm', type: 'button', dataset: { k: 'permtest' }, onclick: function () {
          U.toast('Sending in 3 seconds. Switch away to see it arrive.');
          setTimeout(function () {
            var me = C.currentMember();
            systemNote('A note from Cozé', (me ? me.first + ', this' : 'This') + ' is how a note from the bar looks on your phone.', 'coze-test');
          }, 3000);
        } }, 'Send me a test'));
    }
    if (state === 'denied') {
      return h('section', { class: 'perm is-off', dataset: { perm: 'denied' } }, h('div', null,
        h('b', null, 'Notifications are blocked for this site'),
        h('p', null, 'Allow them in your browser settings to get notes on this device. They still arrive here in the meantime.')));
    }
    return h('section', { class: 'perm', dataset: { perm: 'default' } }, h('div', null,
      h('b', null, 'Get these as notifications on this phone'),
      h('p', null, 'Only the kinds you allow under You.')),
      h('button', { class: 'btn btn-sm', type: 'button', dataset: { k: 'permon' }, onclick: askPermission }, 'Turn on'));
  }

  function askPermission() {
    var done = false;
    function after() {
      if (done) return;
      done = true;
      render({});
      if (permState() === 'granted') U.toast('Notifications are on for this device.');
    }
    try {
      var p = window.Notification.requestPermission(after);
      if (p && p.then) p.then(after, after);
    } catch (e) { after(); }
  }

  var SAMPLES = [
    { title: 'Your usual is on us', body: function (me) { var d = C.drink(me.usual && me.usual.drink); return '{name}, your ' + (d ? d.name : 'usual') + ' is on the house today. Come by before 6.'; }, replies: ['On my way', 'Not today'] },
    { title: 'We saved your seat', body: function () { return '{name}, the corner booth is free until 5 if you fancy a quiet one.'; }, replies: ['On my way', 'Not today'] },
    { title: 'First taste, if you want it', body: function () { return '{name}, a new tonic reaches the bar on Friday. Shall we keep you a glass?'; }, replies: ['Keep me one', 'Not this time'] }
  ];
  function sampleLabel() {
    if (!S.sampleAt) return 'Demo: send myself a sample note in 5 seconds';
    return 'Sending in ' + Math.max(1, Math.ceil((S.sampleAt - Date.now()) / 1000)) + ' s';
  }
  function sample() {
    if (S.sampleTimer) return;
    S.sampleAt = Date.now() + 5000;
    render({});
    S.sampleTimer = setTimeout(function () {
      S.sampleTimer = null; S.sampleAt = 0;
      var me = C.currentMember();
      if (!me) return;
      var t = SAMPLES[S.sampleN++ % SAMPLES.length];
      var res = C.sendNote({ to: me.id, kind: 'personal', title: t.title, body: t.body(me), replies: t.replies, by: 'Demo' });
      if (!res.sent.length) {
        U.toast('Personal notes are switched off, so nothing was sent. Turn them on under You.');
        render({});
      }
    }, 5000);
  }

  /* ---------- You ---------- */

  // The birthday part of the profile has three states: on the card (read only, removable), removed and now
  // the bar's job to add again, or not given yet (two selects, set once).
  function birthdayState(me) {
    if (me.bday) return 'set:' + me.bday.d + '-' + me.bday.m;
    return me.bdayLocked ? 'locked' : 'open';
  }
  function birthdayParts(me) {
    if (me.bday) {
      return [
        h('span', { class: 'label' }, 'Birthday'),
        h('p', { class: 'readonly' }, U.icon('cake'), C.fmt.birthday(me.bday)),
        h('small', null, 'Ask at the bar to change it.'),
        h('button', { class: 'linklike', type: 'button', dataset: { k: 'rmbday' }, onclick: function () { askRemoveBirthday(me.id); } }, 'Remove my birthday')
      ];
    }
    if (me.bdayLocked) {
      return [
        h('span', { class: 'label' }, 'Birthday'),
        h('p', { class: 'readonly' }, U.icon('cake'), 'Not on your club card'),
        h('small', null, 'Ask at the bar to add it again.')
      ];
    }
    return [
      h('span', { class: 'label', id: 'bdayLabel' }, 'Birthday', h('em', null, 'optional')),
      h('div', { class: 'pair', role: 'group', 'aria-labelledby': 'bdayLabel' },
        options(h('select', { name: 'bd', 'aria-label': 'Birthday day' }), dayOptions(), '', 'Day'),
        options(h('select', { name: 'bm', 'aria-label': 'Birthday month' }), monthOptions(), '', 'Month')),
      h('small', null, 'For a slice of cheesecake in your birthday month. No year needed. You set it once here. After that, ask at the bar.')
    ];
  }
  function birthdayBox(me) {
    return h('div', { class: 'field bday', id: 'bdayBox', dataset: { state: birthdayState(me) } }, birthdayParts(me));
  }
  // Redraws only the birthday part, and only if it changed, so typing elsewhere in the form is left alone.
  function refreshBirthday(me) {
    var box = $('bdayBox');
    if (!box || box.dataset.state === birthdayState(me)) return;
    box.dataset.state = birthdayState(me);
    U.fill(box, birthdayParts(me));
  }
  function askRemoveBirthday(memberId) {
    ask({
      title: 'Remove your birthday?',
      text: ['It comes off your club card, and the birthday cheesecake goes with it.', 'To put it back you will need to ask at the bar.'],
      yes: 'Remove it', no: 'Keep it', danger: true,
      onYes: function () {
        var m = C.updateMember(memberId, { bday: null });
        if (m) { refreshBirthday(m); U.toast('Your birthday is off your club card.'); }
      }
    });
  }

  function viewYou(me) {
    S.youDirty = false;
    // What the form started with. Only fields the person actually changed are saved, so a change made in
    // another tab (or at the bar) is never put back by an old value sitting in this form.
    var init = { first: me.first, usual: (me.usual && me.usual.drink) || '', how: (me.usual && me.usual.how) || '' };
    var first = h('input', { name: 'first', type: 'text', value: init.first, maxlength: '24', autocomplete: 'given-name', autocapitalize: 'words', required: true });
    var usual = options(h('select', { name: 'usual' }), drinkOptions(), init.usual, 'No usual yet');
    var how = h('input', { name: 'how', type: 'text', value: init.how, maxlength: '60', placeholder: 'Less ice, oat milk' });
    var err = h('p', { class: 'field-error', role: 'alert', hidden: true });
    function dirty() { S.youDirty = true; }

    var form = h('form', { class: 'panel form', id: 'youForm', novalidate: true, oninput: dirty, onchange: dirty, onsubmit: function (e) {
      e.preventDefault();
      var now = C.member(me.id);
      if (!now) return;
      var patch = {}, changed = false;
      var name = first.value.trim().replace(/\s+/g, ' ');
      if (name !== init.first) {
        if (name.length < 2) { showError(err, 'Please enter your first name.'); first.focus(); return; }
        patch.first = name; changed = true;
      }
      var bd = form.elements.namedItem('bd'), bm = form.elements.namedItem('bm');
      if (bd && bm) {
        var d = +bd.value, m = +bm.value;
        if ((d && !m) || (!d && m)) { showError(err, 'Choose both a day and a month, or leave both empty.'); return; }
        if (d && m) {
          if (!C.validBirthday(d, m)) { showError(err, 'That date does not exist.'); return; }
          patch.bday = { d: d, m: m }; changed = true;
        }
      }
      var drink = usual.value, take = how.value.trim();
      if (drink !== init.usual || take !== init.how) {
        patch.usual = {
          drink: drink !== init.usual ? drink : (now.usual && now.usual.drink) || '',
          how: take !== init.how ? take : (now.usual && now.usual.how) || ''
        };
        changed = true;
      }
      showError(err, '');
      S.youDirty = false;
      if (!changed) { U.toast('Nothing was changed.'); render({}); return; }
      C.updateMember(me.id, patch);
      U.toast('Saved.');
    } },
      h('h2', null, 'Your details'),
      h('label', { class: 'field' }, h('span', null, 'First name'), first),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Mobile number'),
        h('p', { class: 'readonly num' }, U.icon('lock'), C.fmt.mobile(me.mobile)),
        h('small', null, 'This is how the bar finds your club card. Ask at the bar to change it.')),
      birthdayBox(me),
      h('label', { class: 'field' }, h('span', null, 'Your usual'), usual),
      h('label', { class: 'field' }, h('span', null, 'How you take it', h('em', null, 'optional')), how,
        h('small', null, 'The barista sees this when your club card comes up.')),
      err,
      h('button', { class: 'btn btn-toast btn-block', type: 'submit', dataset: { k: 'save' } }, 'Save changes'));

    function sw(key, label, hint) {
      var input = h('input', { type: 'checkbox', dataset: { k: 'pref-' + key }, onchange: function () {
        var patch = {}; patch[key] = input.checked;
        C.updateMember(me.id, { prefs: patch });
        U.toast(label + (input.checked ? ' on.' : ' off.'));
      } });
      input.checked = !!me.prefs[key];
      return h('label', { class: 'switch' }, input, h('span', { class: 'track', 'aria-hidden': 'true' }), h('span', { class: 'text' }, h('b', null, label), h('small', null, hint)));
    }
    var K = C.NOTE_KINDS;
    var prefs = h('section', { class: 'panel' },
      h('h2', null, 'What we send you'),
      h('p', { class: 'panel-sub' }, 'Switch off anything you do not want. It applies straight away.'),
      h('div', { class: 'switches' },
        sw('rewards', K.reward.label, 'Stamp receipts, your free drink and your birthday treat.'),
        sw('personal', K.personal.label, 'A seat saved, your usual on the house. Written to you by name.'),
        sw('drinks', K.drinks.label, 'When something new reaches the bar.'),
        sw('quiet', 'Quiet hours', 'No notifications between 10 pm and 8 am. They wait in your inbox.')));

    var priv = h('section', { class: 'panel private' },
      h('h2', null, 'Your club card is private'),
      h('p', null, 'There is no public profile and no leaderboard. Only the team at Cozé sees your club card.'),
      h('p', null, 'We keep your first name, mobile number, birthday day and month, your usual, your visits and the notes we sent you. Nothing is shared or sold.'),
      h('div', { class: 'private-actions' },
        h('button', { class: 'btn btn-ghost', type: 'button', dataset: { k: 'download' }, onclick: function () { download(me.id); } }, U.icon('download'), 'Download my data'),
        h('button', { class: 'btn btn-ghost', type: 'button', dataset: { k: 'signout' }, onclick: function () { C.signOut(); U.toast('Signed out on this phone. Your club card is safe.'); } }, 'Sign out on this phone'),
        h('button', { class: 'btn btn-ghost is-danger', type: 'button', dataset: { k: 'delete' }, onclick: function () { askDelete(me.id); } }, U.icon('trash'), 'Delete my card')));

    return [
      h('h1', { class: 'view-title' }, 'You'),
      form, prefs, priv,
      h('p', { class: 'foot-links' }, h('a', { href: SITE }, 'Back to the Cozé site'), h('a', { href: STAFF }, 'Staff counter'))
    ];
  }

  function download(memberId) {
    var data = C.exportMember(memberId);
    if (!data) return;
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = h('a', { href: url, download: 'coze-club-' + data.card.card.toLowerCase() + '.json' });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    U.toast('Your data was saved as a file.');
  }

  function askDelete(memberId) {
    var me = C.member(memberId);
    if (!me) return;
    var lost = [];
    if (me.stamps) lost.push(me.stamps + (me.stamps === 1 ? ' stamp' : ' stamps'));
    if (me.free) lost.push(me.free + (me.free === 1 ? ' free drink' : ' free drinks'));
    ask({
      title: 'Delete your card?',
      text: [
        'This removes your card ' + me.card + ', your name and mobile number, your visits and every note we sent you.',
        lost.length ? 'You will lose ' + lost.join(' and ') + '. This cannot be undone.' : 'This cannot be undone.'
      ],
      yes: 'Delete my card', no: 'Keep my card', danger: true,
      onYes: function () {
        C.deleteMember(memberId);
        U.toast('Your card and everything on it has been deleted.');
      }
    });
  }

  /* ---------- sheets ---------- */

  function openSheet(dialog) {
    var a = document.activeElement;
    S.openerKey = a && a.dataset ? a.dataset.k || null : null;
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
  }
  function closeSheet(dialog) {
    if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open');
  }
  [el.qrSheet, el.askSheet].forEach(function (dialog) {
    var downOutside = false;
    function outside(e) {
      var r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    }
    dialog.addEventListener('pointerdown', function (e) { downOutside = e.target === dialog && outside(e); });
    dialog.addEventListener('click', function (e) {
      // A tap on the dimmed area closes the sheet. A click that started inside it never does.
      if (e.target === dialog && downOutside && outside(e)) closeSheet(dialog);
      downOutside = false;
    });
    dialog.addEventListener('close', function () {
      // Put focus back on what opened the sheet, even if the view was redrawn meanwhile.
      if (S.openerKey && !el.app.hidden) {
        var back = el.view.querySelector('[data-k="' + S.openerKey + '"]');
        if (back) back.focus({ preventScroll: true });
      }
      S.openerKey = null;
    });
    Array.prototype.forEach.call(dialog.querySelectorAll('[data-close]'), function (b) {
      b.addEventListener('click', function () { closeSheet(dialog); });
    });
  });

  function ask(o) {
    $('askTitle').textContent = o.title;
    U.fill($('askText'), o.text.map(function (t) { return h('p', null, t); }));
    var yes = $('askYes'), no = $('askNo');
    yes.textContent = o.yes || 'Yes';
    yes.className = 'btn ' + (o.danger ? 'btn-danger' : 'btn-toast');
    no.textContent = o.no || 'Not now';
    S.askYes = o.onYes || null;
    openSheet(el.askSheet);
  }
  $('askNo').addEventListener('click', function () { S.askYes = null; closeSheet(el.askSheet); });
  $('askYes').addEventListener('click', function () {
    var fn = S.askYes;
    S.askYes = null;
    closeSheet(el.askSheet);
    if (fn) fn();
  });

  /* ---------- new notes: banner and system notification ---------- */

  var RING_WINDOW = 2 * 60 * 1000;   // a note older than this is listed, but never rings

  function syncNotes() {
    var me = C.currentMember();
    if (!me) { S.seenFor = null; S.seen = {}; return; }
    var notes = C.notesFor(me.id), here = {};
    notes.forEach(function (n) { here[n.id] = 1; });
    if (S.seenFor !== me.id) {
      // First look at this card: everything already here is old news.
      S.seenFor = me.id; S.seen = here;
      return;
    }
    // A note that was withdrawn (a stamp undone at the bar) must stop ringing.
    Object.keys(S.seen).forEach(function (id) {
      if (!here[id]) { delete S.seen[id]; unring(id); }
    });
    var fresh = notes.filter(function (n) { return !S.seen[n.id]; });
    if (!fresh.length) return;
    fresh.forEach(function (n) { S.seen[n.id] = 1; });
    var oldest = Date.now() - RING_WINDOW;
    fresh.reverse().forEach(function (n) {           // oldest of the new ones first
      if (n.read || new Date(n.at).getTime() < oldest) return;
      banner(n.title, n.body, n.id);
      if (n.push && permState() === 'granted' && !(me.prefs.quiet && quietNow())) systemNote(n.title, n.body, n.id);
    });
    if (S.tab === 'notes') scheduleRead();
  }

  // Takes down everything that announced a note: the banner, its place in the queue, the system notification.
  function unring(id) {
    S.queue = S.queue.filter(function (q) { return q.id !== id; });
    if (S.bannerOn && S.bannerId === id) hideBanner(false);
    if (S.plain[id]) { try { S.plain[id].close(); } catch (e) { /* already gone */ } delete S.plain[id]; }
    if (S.swReg && S.swReg.getNotifications) {
      try {
        S.swReg.getNotifications({ tag: id }).then(function (list) { list.forEach(function (n) { n.close(); }); }, function () {});
      } catch (e) { /* not supported here */ }
    }
  }

  function banner(title, body, id) {
    S.queue.push({ title: title, body: body, id: id || null });
    pump();
  }
  function pump() {
    if (S.bannerOn || !S.queue.length || el.app.hidden) return;
    var n = S.queue.shift();
    el.bannerTitle.textContent = n.title;
    el.bannerBody.textContent = n.body;
    S.bannerId = n.id;
    el.banner.hidden = false;
    void el.banner.offsetWidth;                       // so the slide-in transition runs
    el.banner.classList.add('is-on');
    S.bannerOn = true;
    bannerClock();
  }
  // The clock only runs while the page is on screen, so a note that arrived in the background is still there to see.
  function bannerClock() {
    clearTimeout(S.bannerTimer);
    if (document.hidden) return;
    S.bannerTimer = setTimeout(function () { hideBanner(false); }, S.queue.length ? 3600 : 6000);
  }
  function hideBanner(now) {
    clearTimeout(S.bannerTimer);
    el.banner.classList.remove('is-on');
    S.bannerId = null;
    if (now) { S.bannerOn = false; el.banner.hidden = true; return; }
    if (!S.bannerOn) return;
    S.bannerOn = false;
    setTimeout(function () {
      if (S.bannerOn) return;
      el.banner.hidden = true;
      pump();
    }, 480);
  }
  el.banner.addEventListener('click', function () {
    S.queue = [];
    hideBanner(false);
    go('notes');
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    if (S.bannerOn) bannerClock();
    if (S.tab === 'notes' && C.currentMember()) scheduleRead();
  });

  function systemNote(title, body, tag) {
    if (permState() !== 'granted') return;
    tag = tag || 'coze';
    var url = location.href.split('#')[0].split('?')[0] + '#notes';
    var opts = { body: body, icon: ICON, badge: ICON, tag: tag, data: { url: url } };
    function plain() {
      try {
        var n = new window.Notification(title, opts);
        S.plain[tag] = n;
        n.onclose = function () { if (S.plain[tag] === n) delete S.plain[tag]; };
        n.onclick = function () { window.focus(); go('notes'); n.close(); };
      } catch (e) { /* some phones only allow notifications through a service worker */ }
    }
    if (S.swReg && S.swReg.showNotification) {
      try { S.swReg.showNotification(title, opts).catch(plain); } catch (e) { plain(); }
    } else {
      plain();
    }
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('../sw.js', { scope: '../' }).then(function () {
      return navigator.serviceWorker.ready;
    }).then(function (reg) { S.swReg = reg; }).catch(function () { /* notifications fall back to the page */ });
    navigator.serviceWorker.addEventListener('message', function (e) {
      if (e.data && e.data.type === 'open-notes' && C.currentMember()) go('notes');
    });
  }

  /* ---------- once a second: countdowns ---------- */

  setInterval(function () {
    var timers = el.view.querySelectorAll('[data-expires]'), expired = false;
    Array.prototype.forEach.call(timers, function (t) {
      if (new Date(t.dataset.expires).getTime() <= Date.now()) expired = true;
      else t.textContent = remaining(t.dataset.expires);
    });
    if (expired) render({});
    var btn = $('sampleBtn');
    if (btn && S.sampleAt) btn.textContent = sampleLabel();
  }, 1000);

  /* ---------- signed-out forms ---------- */

  var jf = el.joinForm.elements;
  options(jf.namedItem('bd'), dayOptions(), '', 'Day');
  options(jf.namedItem('bm'), monthOptions(), '', 'Month');
  options(jf.namedItem('usual'), drinkOptions(), '', 'I will decide later');

  el.joinForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var d = +jf.namedItem('bd').value, m = +jf.namedItem('bm').value;
    if ((d && !m) || (!d && m)) { showError(el.joinError, 'Choose both a day and a month for your birthday, or leave both empty.'); return; }
    if (d && m && !C.validBirthday(d, m)) { showError(el.joinError, 'That date does not exist.'); return; }
    var notes = jf.namedItem('notes').checked, member;
    S.welcome = true;
    try {
      member = C.join({
        first: jf.namedItem('first').value, mobile: jf.namedItem('mobile').value,
        bday: d && m ? { d: d, m: m } : null,
        usual: { drink: jf.namedItem('usual').value, how: '' },
        prefs: { rewards: true, personal: notes, drinks: notes }
      });
    } catch (err) {
      S.welcome = false;
      showError(el.joinError, err.message);
      return;
    }
    S.welcome = false;
    showError(el.joinError, '');
    el.joinForm.reset();
    if (S.tab !== 'card') go('card');
    var hello = C.notesFor(member.id)[0];
    if (hello) banner(hello.title, hello.body, hello.id);
  });

  el.signInForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var field = el.signInForm.elements.namedItem('mobile');
    if (!C.validMobile(field.value)) { showError(el.signInError, 'Enter the 7 digit mobile number your club card is under.'); return; }
    if (!C.signIn(field.value)) { showError(el.signInError, 'No club card is under that number. Check it, or get a new one above.'); return; }
    showError(el.signInError, '');
    el.signInForm.reset();
    if (S.tab !== 'card') go('card');
  });

  // The demo card can always be opened: if Leena's card was deleted, the store puts it back.
  $('demoCard').addEventListener('click', function () {
    C.signInAs(C.demoMember().id);
    if (S.tab !== 'card') go('card');
  });

  /* ---------- start ---------- */

  (function start() {
    var q, hello = null;
    try { q = new URLSearchParams(location.search); } catch (e) { q = null; }
    if (q) {
      var first = (q.get('first') || '').trim(), mobile = (q.get('mobile') || '').trim(), usual = q.get('usual');
      if (usual && !C.drink(usual)) usual = null;
      if (q.get('demo') === '1') {
        C.signInAs(C.demoMember().id);
      } else if (first || mobile) {
        // Sent here by the join form on the site. A number that already has a card opens it. A new name and
        // number get their card straight away, with no second form.
        var valid = mobile ? C.validMobile(mobile) : null;
        var known = valid ? C.byMobile(valid) : null;
        if (known) {
          C.signInAs(known.id);
        } else {
          var made = null, why = '';
          if (first && valid) {
            S.welcome = true;
            try { made = C.join({ first: first, mobile: valid, usual: { drink: usual || '', how: '' } }); }
            catch (err) { why = err.message; }
            if (!made) S.welcome = false;
          } else if (mobile && !valid) {
            why = 'Enter a Maldives mobile number, 7 digits starting with 7 or 9.';
          }
          if (made) {
            hello = C.notesFor(made.id)[0] || null;
            usual = null;
          } else {
            // Something is missing or wrong: show the form with what we were given, and say what to fix.
            if (C.currentMember()) C.signOut();
            jf.namedItem('first').value = first.slice(0, 24);
            jf.namedItem('mobile').value = mobile.replace(/[^\d\s+]/g, '').slice(0, 16);
            showError(el.joinError, why);
          }
        }
      }
      if (usual) {
        jf.namedItem('usual').value = usual;
        var cur = C.currentMember();
        if (cur && !(cur.usual && cur.usual.drink)) C.updateMember(cur.id, { usual: { drink: usual, how: '' } });
      }
      if (location.search && window.history && history.replaceState) {
        try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { /* file:// */ }
      }
    }

    S.tab = hello ? 'card' : tabFromHash();
    C.on(function (reason) {
      if (reason === 'not-saving') {
        if (!S.toldNotSaving) {
          S.toldNotSaving = true;
          U.toast('This browser will not save anything, so changes stay in this tab only.', { ms: 9000 });
        }
        return;
      }
      syncNotes();
      render({});
    });
    syncNotes();
    render({ fresh: true });
    if (hello) banner(hello.title, hello.body, hello.id);
    if (!el.joinError.hidden && el.joinError.scrollIntoView) el.joinError.scrollIntoView({ block: 'center' });
  })();
})();
