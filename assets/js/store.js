/*
 * Cozé demo store.
 * One browser-only source of truth shared by the site, the member card (/club/) and the staff counter (/staff/).
 * Everything lives in localStorage, so a change in one tab shows up in the others through the "storage" event.
 * Prices, hours, members and offers in here are samples for the demo.
 * Bump VERSION whenever the seed changes, or browsers keep showing the old data.
 */
(function () {
  'use strict';

  var VERSION = 1;
  var KEY = 'coze.demo.state.v' + VERSION;
  var SESSION_KEY = 'coze.demo.member';
  var STAFF_KEY = 'coze.demo.staff';
  var MALE_OFFSET_MIN = 5 * 60; // Malé is UTC+5 all year
  var DAY = 86400000;

  /* ---------- fixed content ---------- */

  var DRINKS = [
    { id: 'matcha-monkey', name: 'Matcha Monkey', desc: 'Banana matcha over milk', price: 75, img: 'drink-matcha-monkey.webp', signature: true },
    { id: 'dirty-frostbite', name: 'Dirty Frostbite', desc: 'Blue soda float, served in a flask', price: 80, img: 'drink-dirty-frostbite.webp', signature: true },
    { id: 'marshmallow-bloom', name: 'Marshmallow Bloom', desc: 'Blueberry with a toasted marshmallow', price: 85, img: 'drink-marshmallow-bloom.webp', signature: true },
    { id: 'sunset-tonic', name: 'Sunset Tonic', desc: 'Peach tonic with espresso', price: 70, img: 'offer-coffee.webp', signature: true },
    { id: 'yuzu-mirage', name: 'Yuzu Mirage Tonic', desc: 'Citrus tonic with espresso', price: 75, img: 'drink-yuzu-mirage.webp', signature: true, isNew: true },
    { id: 'espresso', name: 'Espresso', desc: 'Short and strong', price: 35 },
    { id: 'americano', name: 'Americano', desc: 'Hot or iced', price: 40 },
    { id: 'flat-white', name: 'Flat white', desc: 'Double shot, silky milk', price: 50 },
    { id: 'cappuccino', name: 'Cappuccino', desc: 'Thick foam, cocoa on top', price: 50 },
    { id: 'iced-latte', name: 'Iced latte', desc: 'Over ice, any milk', price: 55 },
    { id: 'spanish-latte', name: 'Spanish latte', desc: 'Sweet, creamy, iced or hot', price: 60 }
  ];

  var MENU = [
    {
      id: 'signatures', title: 'Signatures', note: 'Made to order', tone: 'espresso', img: 'drink-marshmallow-bloom.webp',
      items: [
        { name: 'Matcha Monkey', desc: 'Banana matcha, layered over milk.', price: 75 },
        { name: 'Dirty Frostbite', desc: 'Blue soda float, served in a flask.', price: 80 },
        { name: 'Marshmallow Bloom', desc: 'Blueberry, toasted marshmallow on top.', price: 85 },
        { name: 'Sunset Tonic', desc: 'Peach tonic with a shot of espresso.', price: 70 },
        { name: 'Yuzu Mirage Tonic', desc: 'Citrus tonic and espresso. New.', price: 75 }
      ]
    },
    {
      id: 'coffee', title: 'Coffee', note: 'All day, at the bar', tone: 'butter', img: 'thumb-lattes.webp',
      items: [
        { name: 'Espresso', desc: 'Short and strong.', price: 35 },
        { name: 'Americano', desc: 'Hot or iced.', price: 40 },
        { name: 'Flat white', desc: 'Double shot, silky milk.', price: 50 },
        { name: 'Cappuccino', desc: 'Thick foam, cocoa on top.', price: 50 },
        { name: 'Iced latte', desc: 'Over ice, any milk.', price: 55 },
        { name: 'Spanish latte', desc: 'Sweet and creamy, iced or hot.', price: 60 }
      ]
    },
    {
      id: 'counter', title: 'Counter', note: 'Breakfast and bakes', tone: 'toast', img: 'panel-counter.webp',
      items: [
        { name: 'Maldivian breakfast', desc: 'Mashuni, kulhimas, roshi, egg and sausage.', price: 85 },
        { name: 'Continental breakfast', desc: 'Bread, butter and jam.', price: 55 },
        { name: 'Chicken roll', desc: 'Warm, from the counter.', price: 30 },
        { name: 'Sandwich', desc: 'Made fresh each morning.', price: 45 },
        { name: 'Doughnut', desc: 'Glazed, cookies and cream on top.', price: 30 },
        { name: 'Cheesecake', desc: 'Baked, with blueberry.', price: 55 }
      ]
    }
  ];

  // Status is earned by stamps collected over all time.
  var LEVELS = [
    { id: 'new', name: 'New face', min: 0, perk: 'A welcome stamp to start your card.' },
    { id: 'regular', name: 'Regular', min: 10, perk: 'Your usual is on the screen when you walk up to the bar.' },
    { id: 'inner', name: 'Inner circle', min: 30, perk: 'First taste of every new drink before it reaches the menu.' }
  ];

  var NOTE_KINDS = {
    reward: { label: 'Stamps and rewards', pref: 'rewards' },
    personal: { label: 'Personal notes from the bar', pref: 'personal' },
    drinks: { label: 'New drinks and first tastes', pref: 'drinks' }
  };

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var MON = MONTHS.map(function (m) { return m.slice(0, 3); });
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  /* ---------- small helpers ---------- */

  function uid(prefix) {
    return (prefix || 'x') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function iso(ms) { return new Date(ms).toISOString(); }
  function digits(s) { return String(s == null ? '' : s).replace(/\D+/g, ''); }

  // Date parts on Malé time, whatever the visitor's own time zone is.
  function male(when) {
    var d = new Date((when ? new Date(when).getTime() : Date.now()) + MALE_OFFSET_MIN * 60000);
    return {
      y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(),
      h: d.getUTCHours(), min: d.getUTCMinutes(), dow: d.getUTCDay(),
      key: d.toISOString().slice(0, 10)
    };
  }
  function clock(h, min) {
    var ap = h >= 12 ? 'pm' : 'am';
    var hh = h % 12 === 0 ? 12 : h % 12;
    return hh + (min ? ':' + String(min).padStart(2, '0') : '') + ' ' + ap;
  }
  function clockFromText(t) { // "07:30" -> "7:30 am"
    var p = String(t).split(':');
    return clock(+p[0], +p[1] || 0);
  }

  var fmt = {
    mvr: function (n) { return 'MVR ' + Number(n).toLocaleString('en-US'); },
    time: function (when) { var p = male(when); return clock(p.h, p.min); },
    date: function (when) { var p = male(when); return p.d + ' ' + MON[p.m - 1] + ' ' + p.y; },
    day: function (when) { var p = male(when); return DOW[p.dow] + ' ' + p.d + ' ' + MON[p.m - 1]; },
    monthYear: function (when) { var p = male(when); return MON[p.m - 1] + ' ' + p.y; },
    birthday: function (b) { return b && b.d && b.m ? b.d + ' ' + MONTHS[b.m - 1] : ''; },
    mobile: function (m) { var s = digits(m); return s.length === 7 ? '+960 ' + s.slice(0, 3) + ' ' + s.slice(3) : s; },
    // "just now", "12 min ago", "3 h ago", "Yesterday", then the date
    ago: function (when) {
      var t = new Date(when).getTime(), diff = Date.now() - t;
      if (diff < 60000) return 'Just now';
      if (diff < 3600000) return Math.floor(diff / 60000) + ' min ago';
      var today = male().key, then = male(t).key;
      if (then === today) return Math.floor(diff / 3600000) + ' h ago';
      var days = Math.round((Date.parse(today) - Date.parse(then)) / DAY);   // calendar days, on Malé time
      if (days === 1) return 'Yesterday';
      if (days > 1 && days < 7) return days + ' days ago';
      return fmt.date(t);
    },
    name: function (m) { return m ? (m.first + (m.last ? ' ' + m.last : '')) : ''; },
    // 10 -> "Ten" (used in copy such as "Ten stamps, then one on us")
    word: function (n) { return ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'][n] || String(n); }
  };

  /* ---------- seed data ---------- */

  function seed() {
    var now = Date.now();
    var rnd = (function (s) { return function () { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; })(20260724);
    var pick = function (a) { return a[Math.floor(rnd() * a.length)]; };
    var month = male(now).m;

    var people = [
      // first, last, mobile, lifetime stamps, stamps on card, free drinks waiting, days since last visit, usual, how
      ['Leena', 'Ahmed', '7774821', 19, 9, 0, 2, 'matcha-monkey', 'Less ice, oat milk'],
      ['Zayan', 'Hassan', '7912044', 34, 4, 1, 0, 'dirty-frostbite', ''],
      ['Nuha', 'Mariyam', '7780316', 12, 2, 0, 1, 'marshmallow-bloom', 'Extra marshmallow'],
      ['Shaan', 'Ibrahim', '9937750', 6, 6, 0, 5, 'flat-white', 'Extra hot'],
      ['Eema', 'Fathimath', '7645102', 41, 1, 0, 0, 'spanish-latte', 'Iced, half sweet'],
      ['Yaish', 'Ali', '7998263', 3, 3, 0, 9, 'americano', 'Iced'],
      ['Zara', 'Hawwa', '9150477', 22, 2, 0, 3, 'matcha-monkey', ''],
      ['Ayaan', 'Mohamed', '7721908', 9, 9, 0, 26, 'iced-latte', 'Oat milk'],
      ['Lamha', 'Aminath', '7856631', 15, 5, 0, 4, 'sunset-tonic', ''],
      ['Ziyan', 'Hussain', '9981245', 1, 1, 0, 31, 'cappuccino', ''],
      ['Maeesha', 'Khadheeja', '7703589', 27, 7, 0, 1, 'yuzu-mirage', 'No straw'],
      ['Raaif', 'Abdulla', '7960418', 8, 8, 0, 6, 'espresso', 'Double'],
      ['Shifa', 'Naseer', '7735926', 5, 5, 0, 12, 'iced-latte', 'Vanilla'],
      ['Naail', 'Yoosuf', '9114370', 30, 0, 1, 2, 'dirty-frostbite', ''],
      ['Zeena', 'Adam', '7689054', 2, 2, 0, 24, 'matcha-monkey', 'Less sweet'],
      ['Laiq', 'Ismail', '7847112', 17, 7, 0, 7, 'flat-white', ''],
      ['Nashwa', 'Rasheed', '9902683', 11, 1, 0, 3, 'marshmallow-bloom', ''],
      ['Ilan', 'Shareef', '7753390', 4, 4, 0, 15, 'spanish-latte', 'Hot']
    ];

    var members = people.map(function (p, i) {
      var joinedDays = 20 + Math.floor(rnd() * 100) + p[3] * 2;
      var bday = { d: 1 + Math.floor(rnd() * 27), m: 1 + Math.floor(rnd() * 12) };
      if (i === 0) bday = { d: 28, m: month };            // the demo member has a birthday this month
      if (i === 4) bday = { d: 12, m: month };
      if (i === 9) bday = null;                            // some people skip it
      return {
        id: 'm_' + p[2],
        card: 'CZ-' + p[2].slice(-4),
        first: p[0], last: p[1], mobile: p[2],
        bday: bday, bdayLocked: !!bday,
        joined: iso(now - joinedDays * DAY),
        usual: { drink: p[7], how: p[8] },
        prefs: { rewards: true, personal: i !== 5, drinks: i !== 5 && i !== 12, quiet: i === 2 },
        stamps: p[4], free: p[5], lifetime: p[3],
        lastVisit: iso(now - p[6] * DAY - Math.floor(rnd() * 6) * 3600000),
        birthdayUsedYear: null
      };
    });

    // Two weeks of counter activity so the staff chart has something to show.
    var activity = [];
    for (var day = 13; day >= 0; day--) {
      var visits = 9 + Math.floor(rnd() * 14) + (day % 7 === 5 ? 8 : 0);
      if (day === 0) visits = 7;
      for (var v = 0; v < visits; v++) {
        var m = pick(members);
        var at = now - day * DAY - Math.floor(rnd() * 10) * 3600000 - Math.floor(rnd() * 3600000);
        if (day === 0) at = now - Math.floor(rnd() * 5 * 3600000) - 600000;
        activity.push({ id: uid('a'), at: iso(at), memberId: m.id, type: 'stamp', n: rnd() > 0.82 ? 2 : 1, by: pick(['Counter 1', 'Counter 1', 'Counter 2']), seeded: true });
      }
    }
    activity.push({ id: uid('a'), at: iso(now - 2 * DAY), memberId: 'm_7912044', type: 'redeem', n: 1, reward: 'free', by: 'Counter 1', seeded: true });
    activity.push({ id: uid('a'), at: iso(now - 4 * DAY), memberId: 'm_7645102', type: 'redeem', n: 1, reward: 'free', by: 'Counter 2', seeded: true });
    activity.sort(function (a, b) { return a.at < b.at ? 1 : -1; });

    var leena = 'm_7774821';
    var notes = [
      { id: uid('n'), batch: 'b_seed4', to: leena, kind: 'reward', auto: true, title: 'Your birthday month', body: 'A slice of cheesecake is waiting on your card, Leena. Any day this month.', at: iso(now - 3 * 3600000), read: null, replies: null, reply: null, push: true },
      { id: uid('n'), batch: 'b_seed3', to: leena, kind: 'drinks', auto: false, title: 'First taste, if you want it', body: 'Leena, the Yuzu Mirage Tonic lands this Friday. Shall we keep you a glass?', at: iso(now - 26 * 3600000), read: null, replies: ['Keep me one', 'Not this time'], reply: null, push: true, by: 'Counter 1' },
      { id: uid('n'), batch: 'b_seed2', to: leena, kind: 'reward', auto: true, title: 'Stamp added', body: 'That is 9 of 10. One more and the next drink is on us.', at: iso(now - 2 * DAY), read: iso(now - 2 * DAY + 60000), replies: null, reply: null, push: true },
      { id: uid('n'), batch: 'b_seed1', to: leena, kind: 'personal', auto: false, title: 'We saved your seat', body: 'Leena, the corner booth is free until 5 today if you fancy a quiet one.', at: iso(now - 9 * DAY), read: iso(now - 9 * DAY + 900000), replies: ['On my way', 'Not today'], reply: { text: 'On my way', at: iso(now - 9 * DAY + 960000) }, push: true, by: 'Counter 2' },
      { id: uid('n'), batch: 'b_seed0', to: leena, kind: 'reward', auto: true, title: 'Welcome to the Club', body: 'Your card is ready, Leena. The first stamp is on us.', at: members[0].joined, read: members[0].joined, replies: null, reply: null, push: true }
    ];
    // A few sent notes for other members so the staff log is not empty.
    [['m_7912044', 'personal', 'Your usual is on us', 'Zayan, your Dirty Frostbite is on the house today. Come by before 6.', 30, true, ['On my way', 'Not today'], 'On my way'],
     ['m_7721908', 'personal', 'We have missed you', 'Ayaan, it has been a while. You are one stamp away from a free drink.', 50, false, null, null],
     ['m_7645102', 'reward', 'Your birthday month', 'A slice of cheesecake is waiting on your card, Eema. Any day this month.', 74, true, null, null],
     ['m_7703589', 'drinks', 'First taste, if you want it', 'Maeesha, the Yuzu Mirage Tonic lands this Friday. Shall we keep you a glass?', 26, true, ['Keep me one', 'Not this time'], 'Keep me one']
    ].forEach(function (r, i) {
      var at = now - r[4] * 3600000;
      notes.push({ id: uid('n'), batch: r[2] === 'First taste, if you want it' ? 'b_seed3' : 'b_o' + i, to: r[0], kind: r[1], auto: r[1] === 'reward', title: r[2], body: r[3], at: iso(at), read: r[5] ? iso(at + 1200000) : null, replies: r[6], reply: r[7] ? { text: r[7], at: iso(at + 1500000) } : null, push: true, by: 'Counter 1' });
    });
    notes.sort(function (a, b) { return a.at < b.at ? 1 : -1; });

    return {
      v: VERSION,
      rev: 1,
      settings: {
        stampsForFree: 10,
        welcomeStamp: true,
        open: '07:30',
        close: '23:30',
        address: 'Opposite the STO main office, Kanbaa Aisa Rani Hingun, Maafannu, Malé'
      },
      offers: [
        { id: 'o1', no: '041', when: 'Sunday to Thursday, before 9 am', title: 'Coffee and a chicken roll, MVR 65', body: 'For the office crowd. Any hot coffee with a warm roll from the counter.', valid: 'Valid Sun to Thu', sticker: 'MVR 65 for two', img: 'offer-coffee.webp', tone: 'sun' },
        { id: 'o2', no: '042', when: 'Every day, 2 to 4 pm', title: 'Double stamps on matcha', body: 'Matcha Monkey or any matcha drink earns two stamps on your club card.', valid: 'Club members', sticker: 'Two stamps', img: 'offer-matcha.webp', tone: 'toast' },
        { id: 'o3', no: '043', when: 'Friday, 8 pm', title: 'First taste: Yuzu Mirage Tonic', body: 'Our new citrus tonic, before it reaches the menu. Thirty glasses only.', valid: 'Inner circle first', sticker: '30 glasses', img: 'offer-yuzu.webp', tone: 'espresso' }
      ],
      members: members,
      notes: notes,
      redemptions: [],
      activity: activity
    };
  }

  /* ---------- state, saving and change events ---------- */

  var state = null;
  var listeners = [];
  var memoryOnly = false;   // private windows can refuse localStorage
  var seeding = false;

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      return s && s.v === VERSION ? s : null;
    } catch (e) { return null; }
  }
  function write() {
    if (memoryOnly) return;
    state.tok = Math.random().toString(36).slice(2);   // marks this write, so another tab can tell it is behind
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) {
      // Storage is full or blocked. Carry on in this tab only, and let the page say so.
      memoryOnly = true;
      setTimeout(function () { emit('not-saving'); }, 0);
    }
  }
  // Another tab may have written since this one last looked: a tab brought back by the Back button, or one
  // that missed an event. Pick up the newer copy before changing anything, so an old copy is never written back.
  function sync(tell) {
    if (seeding || memoryOnly || !state) return false;
    var s = read();
    if (!s || s.tok === state.tok) return false;
    state = s;
    if (tell) emit('remote');
    return true;
  }
  function latest() { load(); sync(false); return state; }
  function load() {
    if (state) return state;
    state = read();
    if (!state) {
      // Seed quietly: nobody is told until the data is whole.
      seeding = true;
      state = seed();
      write();
      seeding = false;
    }
    return state;
  }
  function emit(reason) {
    if (seeding) return;
    listeners.slice().forEach(function (fn) {
      try { fn(reason); } catch (e) { if (window.console) console.error(e); }
    });
  }
  function commit(reason) {
    state.rev = (state.rev || 0) + 1;
    if (state.activity.length > 600) state.activity.length = 600;
    write();
    emit(reason || 'change');
  }

  window.addEventListener('storage', function (e) {
    if (e.key === KEY) {
      var s = read();
      if (s) { state = s; emit('remote'); }
      else if (e.newValue === null) { state = null; load(); emit('remote'); }
    } else if (e.key === SESSION_KEY) {
      emit('session');
    }
  });
  window.addEventListener('pageshow', function (e) { if (e.persisted) sync(true); });
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', function () { if (!document.hidden) sync(true); });
  }

  /* ---------- members ---------- */

  function member(id) {
    var list = load().members;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function byMobile(mobile) {
    var m = digits(mobile).slice(-7), list = load().members;
    for (var i = 0; i < list.length; i++) if (list[i].mobile === m) return list[i];
    return null;
  }
  function validMobile(mobile) {
    var m = digits(mobile);
    if (m.length === 10 && m.slice(0, 3) === '960') m = m.slice(3);
    return /^[79]\d{6}$/.test(m) ? m : null;
  }

  // Search by card number, name or mobile. Also accepts what the QR code on a card holds ("COZE:CZ-4821").
  function findMembers(query) {
    var q = String(query || '').trim().toLowerCase().replace(/^coze:/, '');
    var list = load().members.slice();
    if (!q) return list.sort(function (a, b) { return a.lastVisit < b.lastVisit ? 1 : -1; });
    var qd = digits(q);
    if (/^\+\s*960/.test(q) || (qd.length > 7 && qd.slice(0, 3) === '960')) qd = qd.slice(3);   // "+960 777 4821"
    var isCard = /^cz[\s-]?\d+$/.test(q);
    return list.map(function (m) {
      var score = 0;
      var name = (m.first + ' ' + (m.last || '')).toLowerCase();
      if (isCard || (qd && qd.length <= 4 && qd === q.replace(/\s+/g, ''))) {
        if (m.card.slice(3) === qd) score = 100; else if (m.card.slice(3).indexOf(qd) === 0) score = 60;
      }
      if (!isCard && qd.length >= 3 && m.mobile.indexOf(qd) !== -1) score = Math.max(score, m.mobile === qd ? 95 : 50);
      if (!isCard && !qd) {
        if (name.indexOf(q) === 0) score = 80; else if (name.indexOf(' ' + q) !== -1) score = 70; else if (name.indexOf(q) !== -1) score = 40;
      }
      return { m: m, score: score };
    }).filter(function (r) { return r.score > 0; })
      .sort(function (a, b) { return b.score - a.score || (a.m.lastVisit < b.m.lastVisit ? 1 : -1); })
      .map(function (r) { return r.m; });
  }

  function newCard() {
    var used = {};
    load().members.forEach(function (m) { used[m.card] = 1; });
    for (var i = 0; i < 500; i++) {
      var c = 'CZ-' + String(1000 + Math.floor(Math.random() * 9000));
      if (!used[c]) return c;
    }
    return 'CZ-' + String(Date.now()).slice(-4);
  }

  function level(m) {
    var life = m ? m.lifetime : 0, cur = LEVELS[0], next = null;
    for (var i = 0; i < LEVELS.length; i++) {
      if (life >= LEVELS[i].min) cur = LEVELS[i];
      else { next = LEVELS[i]; break; }
    }
    return { id: cur.id, name: cur.name, min: cur.min, perk: cur.perk, next: next, toNext: next ? next.min - life : 0 };
  }

  function pushNote(n) {
    var m = member(n.to);
    var kind = NOTE_KINDS[n.kind] ? n.kind : 'personal';
    var note = {
      id: uid('n'), batch: n.batch || uid('b'), to: n.to, kind: kind, auto: !!n.auto,
      title: merge(n.title, m), body: merge(n.body, m), at: iso(Date.now()), read: null,
      replies: n.replies && n.replies.length ? n.replies.slice(0, 2) : null, reply: null,
      // push = may this one ring the phone. The card always keeps it in the inbox.
      push: !!(m && m.prefs && m.prefs[NOTE_KINDS[kind].pref] !== false),
      by: n.by || null,
      // What staff typed, before the name was filled in. The sent log shows this.
      raw: n.auto ? null : { title: String(n.title || ''), body: String(n.body || '') }
    };
    state.notes.unshift(note);
    return note;
  }

  function merge(text, m) {
    var name = m ? m.first : 'there';
    return String(text == null ? '' : text).replace(/\{name\}/gi, function () { return name; });
  }

  var MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  function validBirthday(d, mo) {
    d = Math.round(+d); mo = Math.round(+mo);
    return d >= 1 && mo >= 1 && mo <= 12 && d <= MONTH_DAYS[mo - 1];
  }
  function cleanBday(b) { return b && validBirthday(b.d, b.m) ? { d: Math.round(+b.d), m: Math.round(+b.m) } : null; }

  function join(data) {
    latest();
    var first = String(data.first || '').trim().replace(/\s+/g, ' ');
    if (first.length < 2) throw new Error('Please enter your first name.');
    var mobile = validMobile(data.mobile);
    if (!mobile) throw new Error('Enter a Maldives mobile number, 7 digits starting with 7 or 9.');
    if (byMobile(mobile)) throw new Error('That number already has a card. Sign in with it instead.');
    var bday = cleanBday(data.bday);
    var prefs = data.prefs || {};
    var start = state.settings.welcomeStamp ? 1 : 0;
    var m = {
      id: 'm_' + mobile, card: newCard(),
      first: first.charAt(0).toUpperCase() + first.slice(1), last: '', mobile: mobile, bday: bday, bdayLocked: !!bday,
      joined: iso(Date.now()),
      usual: { drink: (data.usual && data.usual.drink) || '', how: (data.usual && data.usual.how) || '' },
      prefs: { rewards: prefs.rewards !== false, personal: prefs.personal !== false, drinks: prefs.drinks !== false, quiet: !!prefs.quiet },
      stamps: start, free: 0, lifetime: start, lastVisit: iso(Date.now()), birthdayUsedYear: null
    };
    state.members.unshift(m);
    state.activity.unshift({ id: uid('a'), at: m.joined, memberId: m.id, type: 'join', n: start, by: 'Website' });
    pushNote({ to: m.id, kind: 'reward', auto: true, title: 'Welcome to the Club', body: start ? 'Your card is ready, {name}. The first stamp is on us.' : 'Your card is ready, {name}. Show it at the bar to collect stamps.' });
    setSession(m.id);
    commit('join');
    return m;
  }

  function updateMember(id, patch) {
    latest();
    var m = member(id);
    if (!m) return null;
    if (patch.first != null) { var f = String(patch.first).trim(); if (f.length >= 2) m.first = f; }
    if (patch.last != null) m.last = String(patch.last).trim();
    // A birthday can be added once from the card and removed at any time. Changing it afterwards is done at
    // the bar (patch.staff), or the birthday treat could be moved to whichever month suits.
    if (patch.bday !== undefined) {
      var b = cleanBday(patch.bday);
      if (!b) m.bday = null;
      else if (!m.bdayLocked || patch.staff) { m.bday = b; m.bdayLocked = true; }
    }
    if (patch.usual) m.usual = { drink: patch.usual.drink || '', how: String(patch.usual.how || '').slice(0, 60) };
    if (patch.prefs) Object.keys(patch.prefs).forEach(function (k) { m.prefs[k] = !!patch.prefs[k]; });
    commit('member');
    return m;
  }

  // Removes the member and everything tied to them. Used by "Delete my card".
  function deleteMember(id) {
    latest();
    state.members = state.members.filter(function (m) { return m.id !== id; });
    state.notes = state.notes.filter(function (n) { return n.to !== id; });
    state.redemptions = state.redemptions.filter(function (r) { return r.memberId !== id; });
    state.activity = state.activity.filter(function (a) { return a.memberId !== id; });
    if (sessionId() === id) setSession(null);
    commit('member-deleted');
  }

  function exportMember(id) {
    var m = member(id);
    if (!m) return null;
    return {
      card: clone(m),
      notes: load().notes.filter(function (n) { return n.to === id; }).map(clone),
      visits: state.activity.filter(function (a) { return a.memberId === id; }).map(clone),
      rewardsUsed: state.redemptions.filter(function (r) { return r.memberId === id; }).map(clone)
    };
  }

  // The sample member that the "Try the demo card" buttons open. If her card was deleted, she is put back
  // with her notes, so the demo never reaches a dead end.
  var DEMO_ID = 'm_7774821';
  function demoMember() {
    latest();
    var m = member(DEMO_ID);
    if (m) return m;
    var fresh = seed();
    m = fresh.members.filter(function (x) { return x.id === DEMO_ID; })[0];
    state.members.unshift(m);
    fresh.notes.forEach(function (n) { if (n.to === DEMO_ID) state.notes.push(n); });
    state.notes.sort(function (a, b) { return a.at < b.at ? 1 : -1; });
    commit('member');
    return m;
  }

  /* ---------- the member signed in on this browser ---------- */

  var sessionMem = null, sessionInMemory = false;
  function sessionId() {
    if (sessionInMemory) return sessionMem;
    try { return localStorage.getItem(SESSION_KEY) || null; } catch (e) { return sessionMem; }
  }
  function setSession(id) {
    sessionMem = id || null;
    try {
      if (id) localStorage.setItem(SESSION_KEY, id); else localStorage.removeItem(SESSION_KEY);
      sessionInMemory = false;
    } catch (e) { sessionInMemory = true; }
  }
  function currentMember() { var id = sessionId(); return id ? member(id) : null; }
  function signIn(mobile) {
    var m = byMobile(mobile);
    if (m) { setSession(m.id); emit('session'); }
    return m;
  }
  function signInAs(id) {
    var m = member(id);
    if (m) { setSession(m.id); emit('session'); }
    return m;
  }
  function signOut() { setSession(null); emit('session'); }

  /* ---------- stamps ---------- */

  function addStamps(id, n, opts) {
    latest();
    var m = member(id);
    n = Math.max(1, Math.min(10, Math.round(+n || 1)));
    if (!m) return null;
    opts = opts || {};
    var need = state.settings.stampsForFree;
    var before = { stamps: m.stamps, free: m.free, lifetime: m.lifetime, lastVisit: m.lastVisit };
    var levelBefore = level(m).id;
    m.stamps += n; m.lifetime += n; m.lastVisit = iso(Date.now());
    var earned = 0;
    while (m.stamps >= need) { m.stamps -= need; m.free += 1; earned++; }
    var act = { id: uid('a'), at: m.lastVisit, memberId: m.id, type: 'stamp', n: n, by: opts.by || 'Counter 1', before: before, earned: earned, noteIds: [] };
    state.activity.unshift(act);

    var batch = uid('b');
    if (earned > 1) {
      act.noteIds.push(pushNote({ batch: batch, to: m.id, kind: 'reward', auto: true, title: earned + ' free drinks on your card', body: 'That filled your card ' + earned + ' times over, {name}. Show it at the bar whenever you like.' }).id);
    } else if (earned) {
      act.noteIds.push(pushNote({ batch: batch, to: m.id, kind: 'reward', auto: true, title: 'Your next drink is on us', body: 'That is ' + need + ' stamps, {name}. Show your card and pick anything on the menu.' }).id);
    } else {
      var left = need - m.stamps;
      act.noteIds.push(pushNote({ batch: batch, to: m.id, kind: 'reward', auto: true, title: n > 1 ? n + ' stamps added' : 'Stamp added', body: 'That is ' + m.stamps + ' of ' + need + '. ' + (left === 1 ? 'One more and the next drink is on us.' : left + ' to go for a free drink.') }).id);
    }
    var lv = level(m);
    if (lv.id !== levelBefore) {
      act.noteIds.push(pushNote({ to: m.id, kind: 'reward', auto: true, title: 'You are ' + (lv.id === 'inner' ? 'in the Inner circle' : 'a Regular') + ' now', body: lv.perk }).id);
    }
    commit('stamp');
    return { activityId: act.id, earned: earned, member: m, levelUp: lv.id !== levelBefore ? lv : null };
  }

  // Takes back the most recent stamp entry for a member, if nothing has happened on the card since.
  function undo(activityId) {
    latest();
    var act = null;
    for (var i = 0; i < state.activity.length; i++) if (state.activity[i].id === activityId) { act = state.activity[i]; break; }
    if (!act || act.type !== 'stamp' || !act.before) return false;
    var m = member(act.memberId);
    if (!m) return false;
    // The list is newest first, so anything of theirs that sits above this entry happened after it.
    var at = state.activity.indexOf(act);
    var newer = state.activity.slice(0, at).some(function (a) { return a.memberId === m.id; });
    var redeeming = state.redemptions.some(function (r) { return r.memberId === m.id && r.status === 'pending'; });
    if (newer || redeeming) return false;
    m.stamps = act.before.stamps; m.free = act.before.free; m.lifetime = act.before.lifetime; m.lastVisit = act.before.lastVisit;
    var need = state.settings.stampsForFree;
    while (m.stamps >= need) { m.stamps -= need; m.free += 1; }
    state.notes = state.notes.filter(function (n) { return (act.noteIds || []).indexOf(n.id) === -1; });
    state.activity = state.activity.filter(function (a) { return a.id !== act.id; });
    commit('undo');
    return true;
  }

  /* ---------- rewards ---------- */

  var CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  var REDEEM_MINUTES = 15;

  function expireOld() {
    var now = Date.now(), changed = false;
    load().redemptions.forEach(function (r) {
      if (r.status === 'pending' && new Date(r.expires).getTime() < now) { r.status = 'expired'; changed = true; }
    });
    return changed;
  }

  function rewardsFor(m) {
    if (!m) return [];
    var need = load().settings.stampsForFree, p = male();
    var pending = pendingRedemptions(m.id);
    var has = function (key) { return pending.filter(function (r) { return r.reward === key; })[0] || null; };
    var birthdayMonth = !!(m.bday && m.bday.m === p.m);
    var birthdayUsed = m.birthdayUsedYear === p.y;
    return [
      {
        key: 'free', title: 'Free drink', desc: 'Anything on the menu, any size.',
        count: m.free, available: m.free > 0, pending: has('free'),
        why: m.free > 0 ? (m.free === 1 ? 'Ready to use' : m.free + ' ready to use') : (need - m.stamps) + ' more ' + (need - m.stamps === 1 ? 'stamp' : 'stamps') + ' to go'
      },
      {
        key: 'birthday', title: 'Birthday cheesecake', desc: 'A slice on us, any day in your birthday month.',
        count: birthdayMonth && !birthdayUsed ? 1 : 0, available: birthdayMonth && !birthdayUsed, pending: has('birthday'),
        why: !m.bday ? 'Add your birthday to get this' : birthdayUsed ? 'Used this year' : birthdayMonth ? 'Ready to use this month' : 'Unlocks in ' + MONTHS[m.bday.m - 1]
      }
    ];
  }

  function pendingRedemptions(memberId) {
    if (expireOld()) write();
    return state.redemptions.filter(function (r) { return r.status === 'pending' && (!memberId || r.memberId === memberId); });
  }

  // The member taps "Use now": they get a short code to show at the bar. Nothing is deducted until staff confirm.
  function startRedeem(memberId, key) {
    latest();
    var m = member(memberId);
    if (!m) return null;
    var list = rewardsFor(m), reward = null;
    for (var i = 0; i < list.length; i++) if (list[i].key === key) reward = list[i];
    if (!reward || !reward.available) return null;
    if (reward.pending) return reward.pending;
    var code = '';
    for (var c = 0; c < 4; c++) code += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length));
    var r = { id: uid('r'), memberId: m.id, reward: key, title: reward.title, code: code, at: iso(Date.now()), expires: iso(Date.now() + REDEEM_MINUTES * 60000), status: 'pending' };
    state.redemptions.unshift(r);
    commit('redeem-start');
    return r;
  }
  function cancelRedeem(id) {
    var r = latest().redemptions.filter(function (x) { return x.id === id; })[0];
    if (!r || r.status !== 'pending') return false;
    r.status = 'cancelled';
    commit('redeem-cancel');
    return true;
  }
  // Staff confirm that the drink was handed over. Only now does it leave the card.
  function confirmRedeem(id, by) {
    latest();
    expireOld();
    var r = state.redemptions.filter(function (x) { return x.id === id; })[0];
    if (!r || r.status !== 'pending') return false;
    var m = member(r.memberId);
    if (!m) return false;
    if (r.reward === 'free') { if (m.free < 1) return false; m.free -= 1; }
    if (r.reward === 'birthday') m.birthdayUsedYear = male().y;
    r.status = 'given'; r.givenAt = iso(Date.now()); r.by = by || 'Counter 1';
    m.lastVisit = r.givenAt;
    state.activity.unshift({ id: uid('a'), at: r.givenAt, memberId: m.id, type: 'redeem', n: 1, reward: r.reward, by: r.by });
    pushNote({ to: m.id, kind: 'reward', auto: true, title: 'Enjoy, {name}', body: r.reward === 'free' ? 'Your free drink is on its way.' + (m.stamps === 0 && m.free === 0 ? ' Your card starts a fresh row of stamps.' : '') : 'Happy birthday month. Your cheesecake is on us.' });
    commit('redeem');
    return true;
  }
  // Staff can also give a reward straight from the counter, without the member opening their phone.
  function giveReward(memberId, key, by) {
    var r = startRedeem(memberId, key);
    return r ? confirmRedeem(r.id, by) : false;
  }

  /* ---------- notes (the personal notifications) ---------- */

  function notesFor(memberId) {
    return load().notes.filter(function (n) { return n.to === memberId; });
  }
  function unread(memberId) {
    return notesFor(memberId).filter(function (n) { return !n.read; }).length;
  }
  // msg: { to: id or [ids], kind, title, body, replies: [a, b] or null, by }
  // People who switched that kind of note off are skipped and reported back, never messaged.
  function sendNote(msg) {
    latest();
    var ids = Array.isArray(msg.to) ? msg.to : [msg.to];
    var kind = NOTE_KINDS[msg.kind] ? msg.kind : 'personal';
    var batch = uid('b'), sent = [], skipped = [];
    ids.forEach(function (id) {
      var m = member(id);
      if (!m) return;
      if (m.prefs[NOTE_KINDS[kind].pref] === false) { skipped.push(id); return; }
      sent.push(pushNote({ batch: batch, to: id, kind: kind, title: msg.title, body: msg.body, replies: msg.replies, by: msg.by || 'Counter 1' }).id);
    });
    if (sent.length) commit('note');
    return { batch: batch, sent: sent, skipped: skipped };
  }
  function markRead(noteId) {
    var n = latest().notes.filter(function (x) { return x.id === noteId; })[0];
    if (!n || n.read) return false;
    n.read = iso(Date.now());
    commit('read');
    return true;
  }
  function markAllRead(memberId) {
    var now = iso(Date.now()), any = false;
    latest().notes.forEach(function (n) { if (n.to === memberId && !n.read) { n.read = now; any = true; } });
    if (any) commit('read');
    return any;
  }
  function reply(noteId, text) {
    var n = latest().notes.filter(function (x) { return x.id === noteId; })[0];
    if (!n || !n.replies || n.replies.indexOf(text) === -1) return false;
    n.reply = { text: text, at: iso(Date.now()) };
    if (!n.read) n.read = n.reply.at;
    commit('reply');
    return true;
  }
  // Notes written by staff, grouped by send, newest first. Automatic stamp receipts are left out.
  function sentLog() {
    var groups = {}, order = [];
    load().notes.forEach(function (n) {
      if (n.auto) return;
      if (!groups[n.batch]) {
        groups[n.batch] = { batch: n.batch, at: n.at, kind: n.kind, title: n.title, body: n.body, sample: n.to, rawTitle: n.raw ? n.raw.title : n.title, rawBody: n.raw ? n.raw.body : n.body, by: n.by, notes: [] };
        order.push(n.batch);
      }
      var g = groups[n.batch];
      g.notes.push(n);
      if (n.at > g.at) g.at = n.at;
    });
    return order.map(function (b) {
      var g = groups[b];
      g.count = g.notes.length;
      g.read = g.notes.filter(function (n) { return n.read; }).length;
      g.replies = g.notes.filter(function (n) { return n.reply; }).map(function (n) { return { memberId: n.to, text: n.reply.text, at: n.reply.at }; });
      return g;
    }).sort(function (a, b) { return a.at < b.at ? 1 : -1; });
  }

  // Ready-made groups for the staff note composer and the members list.
  var SEGMENTS = [
    { id: 'all', label: 'Everyone', test: function () { return true; } },
    { id: 'birthday', label: 'Birthday this month', test: function (m) { return !!(m.bday && m.bday.m === male().m); } },
    { id: 'close', label: 'One stamp from a free drink', test: function (m) { return m.stamps === load().settings.stampsForFree - 1; } },
    { id: 'free', label: 'Free drink waiting', test: function (m) { return m.free > 0; } },
    { id: 'away', label: 'Not seen for 3 weeks', test: function (m) { return Date.now() - new Date(m.lastVisit).getTime() > 21 * DAY; } },
    { id: 'inner', label: 'Inner circle', test: function (m) { return level(m).id === 'inner'; } }
  ];
  function segment(id) {
    var s = SEGMENTS.filter(function (x) { return x.id === id; })[0] || SEGMENTS[0];
    return load().members.filter(s.test);
  }

  /* ---------- offers, settings, numbers ---------- */

  function saveOffers(offers) {
    latest();
    var text = function (v, max) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max); };
    state.offers = offers.map(function (o, i) {
      var old = state.offers[i] || {};
      return {
        id: o.id || old.id || uid('o'), no: o.no || old.no || '0' + (41 + i),
        when: text(o.when, 60), title: text(o.title, 70) || old.title || 'This week', body: text(o.body, 160),
        valid: text(o.valid, 40), sticker: text(o.sticker, 22),
        img: o.img || old.img || 'offer-coffee.webp', tone: o.tone || old.tone || 'sun'
      };
    });
    commit('offers');
  }
  function saveSettings(patch) {
    latest();
    if (patch.stampsForFree != null) state.settings.stampsForFree = Math.max(4, Math.min(12, Math.round(+patch.stampsForFree) || 10));
    if (patch.welcomeStamp != null) state.settings.welcomeStamp = !!patch.welcomeStamp;
    if (/^\d\d:\d\d$/.test(patch.open || '')) state.settings.open = patch.open;
    if (/^\d\d:\d\d$/.test(patch.close || '')) state.settings.close = patch.close;
    // A lower target can leave full cards behind: turn them into free drinks.
    var need = state.settings.stampsForFree;
    state.members.forEach(function (m) { while (m.stamps >= need) { m.stamps -= need; m.free += 1; } });
    commit('settings');
  }

  function openNow() {
    var s = load().settings, p = male();
    var now = p.h * 60 + p.min;
    var o = s.open.split(':'), c = s.close.split(':');
    var open = +o[0] * 60 + +o[1], close = +c[0] * 60 + +c[1];
    var isOpen = close > open ? (now >= open && now < close) : (now >= open || now < close);
    return {
      open: isOpen,
      label: isOpen ? 'Open now, until ' + clockFromText(s.close) : 'Closed, opens ' + clockFromText(s.open),
      hours: 'Every day, ' + clockFromText(s.open) + ' to ' + clockFromText(s.close)
    };
  }

  function stats() {
    load();
    var today = male().key, weekAgo = Date.now() - 7 * DAY;
    var stampsToday = 0, visitsToday = 0, freeWeek = 0, days = {};
    for (var i = 13; i >= 0; i--) days[male(Date.now() - i * DAY).key] = 0;
    state.activity.forEach(function (a) {
      var k = male(a.at).key;
      if (a.type === 'stamp') {
        if (k === today) { stampsToday += a.n; visitsToday++; }
        if (days[k] != null) days[k] += 1;
      }
      if (a.type === 'redeem' && new Date(a.at).getTime() > weekAgo) freeWeek++;
    });
    var staffNotes = state.notes.filter(function (n) { return !n.auto; });
    var read = staffNotes.filter(function (n) { return n.read; }).length;
    return {
      members: state.members.length,
      stampsToday: stampsToday,
      visitsToday: visitsToday,
      freeThisWeek: freeWeek,
      notesSent: staffNotes.length,
      readRate: staffNotes.length ? Math.round(read / staffNotes.length * 100) : 0,
      visitsByDay: Object.keys(days).map(function (k) { return { key: k, label: fmt.day(k + 'T07:00:00Z').split(' ')[0], date: +k.slice(8), n: days[k] }; })
    };
  }

  function reset() {
    setSession(null);   // first, so no other tab sees the old member next to a fresh set of "new" notes
    seeding = true;
    state = seed();
    write();
    seeding = false;
    emit('reset');
  }

  /* ---------- staff sign-in (demo passcode, kept for this tab only) ---------- */

  var STAFF_PASSCODE = '2026';
  function staffIn() { try { return sessionStorage.getItem(STAFF_KEY) === '1'; } catch (e) { return !!window.__cozeStaff; } }
  function staffSignIn(code) {
    if (String(code).trim() !== STAFF_PASSCODE) return false;
    try { sessionStorage.setItem(STAFF_KEY, '1'); } catch (e) { window.__cozeStaff = true; }
    return true;
  }
  function staffSignOut() { try { sessionStorage.removeItem(STAFF_KEY); } catch (e) { window.__cozeStaff = false; } }

  window.COZE = {
    VERSION: VERSION,
    DRINKS: DRINKS, MENU: MENU, LEVELS: LEVELS, NOTE_KINDS: NOTE_KINDS, SEGMENTS: SEGMENTS, MONTHS: MONTHS,
    REDEEM_MINUTES: REDEEM_MINUTES, STAFF_PASSCODE: STAFF_PASSCODE, DEMO_ID: DEMO_ID, demoMember: demoMember,
    state: load,
    on: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; },
    drink: function (id) { return DRINKS.filter(function (d) { return d.id === id; })[0] || null; },
    usualText: function (m) { var d = m && m.usual ? window.COZE.drink(m.usual.drink) : null; return d ? d.name + (m.usual.how ? ', ' + m.usual.how.charAt(0).toLowerCase() + m.usual.how.slice(1) : '') : ''; },
    members: function () { return load().members; },
    member: member, byMobile: byMobile, validMobile: validMobile, validBirthday: validBirthday, findMembers: findMembers, level: level,
    saving: function () { return !memoryOnly; },
    join: join, updateMember: updateMember, deleteMember: deleteMember, exportMember: exportMember,
    currentMember: currentMember, signIn: signIn, signInAs: signInAs, signOut: signOut,
    addStamps: addStamps, undo: undo,
    rewardsFor: rewardsFor, pendingRedemptions: pendingRedemptions, startRedeem: startRedeem, cancelRedeem: cancelRedeem, confirmRedeem: confirmRedeem, giveReward: giveReward,
    notesFor: notesFor, unread: unread, sendNote: sendNote, markRead: markRead, markAllRead: markAllRead, reply: reply, sentLog: sentLog, merge: merge,
    segment: segment,
    saveOffers: saveOffers, saveSettings: saveSettings, openNow: openNow, stats: stats, reset: reset,
    staffIn: staffIn, staffSignIn: staffSignIn, staffSignOut: staffSignOut,
    male: male, fmt: fmt
  };
})();
