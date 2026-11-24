/*
 * Small DOM helpers shared by the site, the member card and the staff counter.
 * Text always goes in as text nodes, never as HTML, so names and notes typed by people cannot inject markup.
 */
(function () {
  'use strict';
  var SVG = 'http://www.w3.org/2000/svg';

  function append(parent, child) {
    if (child == null || child === false || child === true) return;
    if (Array.isArray(child)) { child.forEach(function (c) { append(parent, c); }); return; }
    parent.appendChild(child.nodeType ? child : document.createTextNode(String(child)));
  }

  // h('button', { class: 'btn', onclick: fn, dataset: { id: 1 }, hidden: false }, 'Save')
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs && (attrs.nodeType || typeof attrs !== 'object' || Array.isArray(attrs))) {
      append(el, attrs);
    } else if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'dataset') Object.keys(v).forEach(function (d) { el.dataset[d] = v[d]; });
        else if (k === 'style' && typeof v === 'object') Object.keys(v).forEach(function (s) { el.style.setProperty(s, v[s]); });
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }

  function use(id, cls) {
    var svg = document.createElementNS(SVG, 'svg');
    if (cls) svg.setAttribute('class', cls);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var u = document.createElementNS(SVG, 'use');
    u.setAttribute('href', '#' + id);
    svg.appendChild(u);
    return svg;
  }
  function icon(name, cls) { return use('i-' + name, 'icon' + (cls ? ' ' + cls : '')); }
  function wordmark(cls) {
    var svg = use('coze', 'wm' + (cls ? ' ' + cls : ''));
    svg.setAttribute('viewBox', '0 0 3244 1046');
    return svg;
  }

  // sticker('Ten stamps', { shape: 'scallop' | 'burst', tone: 'toast', size: 96, tilt: -8, big: '10' })
  function sticker(text, o) {
    o = o || {};
    var el = h('div', { class: 'sticker' + (o.tone ? ' is-' + o.tone : '') + (o.class ? ' ' + o.class : '') });
    if (o.size) el.style.setProperty('--size', o.size + 'px');
    if (o.tilt != null) el.style.setProperty('--tilt', o.tilt + 'deg');
    el.appendChild(use(o.shape === 'burst' ? 'burst' : 'scallop'));
    el.appendChild(h('span', null, o.big ? h('b', null, o.big) : null, text));
    return el;
  }

  // A real, scannable QR code as an SVG element. Needs assets/vendor/qrcode.js.
  function qr(text, o) {
    o = o || {};
    var svg = document.createElementNS(SVG, 'svg');
    if (typeof window.qrcode !== 'function') return svg;
    var q = window.qrcode(0, 'M');
    q.addData(String(text));
    q.make();
    var n = q.getModuleCount(), quiet = o.quiet == null ? 2 : o.quiet, d = '';
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) if (q.isDark(r, c)) d += 'M' + (c + quiet) + ' ' + (r + quiet) + 'h1v1h-1z';
    }
    svg.setAttribute('viewBox', '0 0 ' + (n + quiet * 2) + ' ' + (n + quiet * 2));
    svg.setAttribute('shape-rendering', 'crispEdges');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', o.label || 'QR code');
    if (o.class) svg.setAttribute('class', o.class);
    var bg = document.createElementNS(SVG, 'rect');
    bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%'); bg.setAttribute('fill', o.bg || '#fff');
    var p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', d); p.setAttribute('fill', o.fg || '#2c1b11');
    svg.appendChild(bg); svg.appendChild(p);
    return svg;
  }

  // toast('Stamp added', { action: 'Undo', onAction: fn, ms: 6000 })
  function toast(message, o) {
    o = o || {};
    var wrap = document.querySelector('.toast-wrap');
    if (!wrap) {
      wrap = h('div', { class: 'toast-wrap', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(wrap);
    }
    // Keep it inside an open dialog, or the dialog's top layer would cover it.
    var open = document.querySelector('dialog[open]');
    var home = open || document.body;
    if (wrap.parentNode !== home) home.appendChild(wrap);
    var timer = null;
    var el = h('div', { class: 'toast' }, h('span', null, message));
    function close() { clearTimeout(timer); if (el.parentNode) el.parentNode.removeChild(el); }
    if (o.action) el.appendChild(h('button', { type: 'button', onclick: function () { close(); if (o.onAction) o.onAction(); } }, o.action));
    while (wrap.children.length > 2) wrap.removeChild(wrap.firstChild);
    wrap.appendChild(el);
    timer = setTimeout(close, o.ms || (o.action ? 7000 : 3600));
    return close;
  }

  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
  function fill(el) { clear(el); for (var i = 1; i < arguments.length; i++) append(el, arguments[i]); return el; }

  window.UI = { h: h, use: use, icon: icon, wordmark: wordmark, sticker: sticker, qr: qr, toast: toast, clear: clear, fill: fill };
})();
