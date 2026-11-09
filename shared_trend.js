/* 牛群管理アプリ（白川Farm）と月次レポートで共用するグラフ。
   2026-11-09 本人「全てのグラフでカーソルを合わせる（押す）とその数値・個体がわかるように」「Y軸はキリの良い単位に」:
   ・data-tip を持つ図形（と SVG の <title>）に、マウスを乗せる／指で押すと小さな札で値を出す（tip）
   ・目もりは 1・2・2.5・5 ×10^n のキリの良い刻み（nice）
   ・折れ線（render）・横軸が数の折れ線（xy）・箱ひげ（box）・2軸の棒（bars2）
   ライブラリは使わない。文字はすべて esc を通す。 */
(function (root) {
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function md(d) { return (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)); }
  function fmt(v, dg) {
    if (v == null || isNaN(v)) return '—';
    var x = dg == null ? (Math.abs(v) >= 100 ? 0 : 1) : dg;
    return Number(v).toLocaleString('ja-JP', { minimumFractionDigits: x, maximumFractionDigits: x });
  }

  // ---------- キリの良い目もり ----------
  function nice(lo, hi, count, zero) {
    if (zero) lo = Math.min(0, lo);
    if (!(hi > lo)) { hi = lo + 1; }
    var raw = (hi - lo) / Math.max(1, count || 4), p = Math.pow(10, Math.floor(Math.log10(raw))), step = p * 10;
    [1, 2, 2.5, 5, 10].some(function (m) { if (raw <= m * p) { step = m * p; return true; } return false; });
    var a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step, ticks = [];
    for (var v = a; v <= b + step / 1e6; v += step) ticks.push(Math.round(v / step) * step);
    return { lo: a, hi: b, step: step, ticks: ticks };
  }
  function tickLabel(v, step) { return fmt(v, step < 1 ? (step < 0.1 ? 2 : 1) : 0); }

  // ---------- 札（tip） ----------
  var tipEl = null, tipFor = null;
  function tipBox() {
    if (tipEl) return tipEl;
    tipEl = document.createElement('div');
    tipEl.setAttribute('role', 'status');
    tipEl.style.cssText = 'position:fixed;z-index:50;pointer-events:none;background:rgba(25,32,44,.94);color:#fff;font-size:13px;line-height:1.45;' +
      'padding:7px 10px;border-radius:10px;box-shadow:0 6px 18px rgba(0,0,0,.25);max-width:260px;white-space:pre-line;display:none;font-variant-numeric:tabular-nums';
    document.body.appendChild(tipEl);
    return tipEl;
  }
  function tipText(el) {
    var t = el.getAttribute && el.getAttribute('data-tip');
    if (t) return t;
    var c = el.querySelector && el.querySelector(':scope > title');
    return c ? c.textContent : '';
  }
  function findTip(el) {
    while (el && el !== document) {
      if (el.getAttribute && (el.getAttribute('data-tip') || (el.namespaceURI === 'http://www.w3.org/2000/svg' && el.querySelector && el.querySelector(':scope > title')))) return el;
      el = el.parentNode;
    }
    return null;
  }
  function showTip(el, x, y) {
    var t = tipText(el), b = tipBox();
    if (!t) return hideTip();
    tipFor = el;
    b.textContent = t;
    b.style.display = 'block';
    var w = b.offsetWidth, h = b.offsetHeight;
    var left = Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2)), top = y - h - 14;
    if (top < 8) top = y + 18;
    b.style.left = left + 'px'; b.style.top = top + 'px';
  }
  function hideTip() { if (tipEl) tipEl.style.display = 'none'; tipFor = null; }
  if (typeof document !== 'undefined' && !root.__farmTip) {
    root.__farmTip = true;
    document.addEventListener('pointerover', function (e) { if (e.pointerType !== 'mouse') return; var el = findTip(e.target); if (el) showTip(el, e.clientX, e.clientY); else hideTip(); });
    document.addEventListener('pointermove', function (e) { if (e.pointerType === 'mouse' && tipFor) showTip(tipFor, e.clientX, e.clientY); });
    // 指: 押したところの札を出す。同じところをもう一度押すか、ほかを押すと消える。下へ送っても消える
    document.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') return;
      var el = findTip(e.target);
      if (el && el !== tipFor) showTip(el, e.clientX, e.clientY); else hideTip();
    }, { passive: true });
    window.addEventListener('scroll', function () { if (tipFor) hideTip(); }, { passive: true });
  }

  // ---------- 折れ線（横軸は日付。点の数が少なくても日付の並び順） ----------
  function render(series, unit, monthly) {
    var ds = [];
    series.forEach(function (s) { s.pts.forEach(function (p) { if (ds.indexOf(p.d) < 0) ds.push(p.d); }); });
    ds.sort();
    if (ds.length < 2) return '';
    var vals = [];
    series.forEach(function (s) { s.pts.forEach(function (p) { if (p.v != null) vals.push(+p.v); }); });
    if (!vals.length) return '';
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals), pad = (mx - mn) * 0.1 || Math.abs(mx) * 0.05 || 1;
    var sc = nice(Math.max(mn >= 0 ? 0 : -Infinity, mn - pad), mx + pad, 3);
    var lo = sc.lo, hi = sc.hi;
    var W = 320, H = 120, L = 32, R = 6, T = 8, B = 20;
    var X = function (d) { return L + ds.indexOf(d) / (ds.length - 1) * (W - L - R); };
    var Y = function (v) { return T + (1 - (v - lo) / (hi - lo)) * (H - T - B); };
    var lab = typeof monthly === 'function' ? monthly
      : function (d) { return monthly ? d.slice(2, 4) + '/' + (+d.slice(5, 7)) : md(d); };
    var g = '';
    // 終わりの「まだ分からない」区間
    var known = [];
    series.forEach(function (s) { s.pts.forEach(function (p) { if (p.v != null) known.push(p.d); }); });
    var lastKnown = known.sort()[known.length - 1];
    if (lastKnown && lastKnown < ds[ds.length - 1]) {
      g += '<rect x="' + X(lastKnown).toFixed(1) + '" y="' + T + '" width="' + (X(ds[ds.length - 1]) - X(lastKnown)).toFixed(1) +
        '" height="' + (H - T - B) + '" class="unknown"/>';
    }
    var ticks = sc.ticks.map(function (v) {
      return '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" class="grid"/>' +
        '<text x="' + (L - 4) + '" y="' + (Y(v) + 3.5).toFixed(1) + '" text-anchor="end">' + tickLabel(v, sc.step) + '</text>';
    }).join('');
    series.forEach(function (s) {
      var d = '', on = false;
      s.pts.forEach(function (p) {
        if (p.v == null) { on = false; return; }
        d += (on ? 'L' : 'M') + X(p.d).toFixed(1) + ' ' + Y(p.v).toFixed(1) + ' ';
        on = true;
      });
      g += '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="2"/>';
      if (ds.length <= 40) s.pts.forEach(function (p) { if (p.v != null) g += '<circle cx="' + X(p.d).toFixed(1) + '" cy="' + Y(p.v).toFixed(1) + '" r="2.2" fill="' + s.color + '"/>'; });
    });
    // 日付ごとの縦の帯（見えない）に札。押しやすいよう帯は日付の間隔いっぱい
    var step = (W - L - R) / Math.max(1, ds.length - 1);
    ds.forEach(function (d) {
      var lines = [lab(d) === md(d) ? d : lab(d)];
      series.forEach(function (s) {
        var p = s.pts.filter(function (q) { return q.d === d; })[0];
        if (p && p.v != null) lines.push(s.name + ' ' + fmt(p.v) + ' ' + unit + (p.n != null ? '（' + p.n + '）' : '') + (p.tip ? '　' + p.tip : ''));
      });
      if (lines.length > 1) g += '<rect x="' + (X(d) - step / 2).toFixed(1) + '" y="' + T + '" width="' + step.toFixed(1) + '" height="' + (H - T - B) +
        '" fill="transparent" data-tip="' + esc(lines.join('\n')) + '"/>';
    });
    var mk = '<text x="' + L + '" y="' + (H - 5) + '" text-anchor="start">' + lab(ds[0]) + '</text>' +
      '<text x="' + (W - R) + '" y="' + (H - 5) + '" text-anchor="end">' + lab(ds[ds.length - 1]) + '</text>';
    var legend = series.length > 1 ? '<div class="legend">' + series.map(function (s) {
      return '<span><i style="background:' + s.color + '"></i>' + esc(s.name) + '</span>';
    }).join('') + '</div>' : '';
    return legend + '<svg class="herd" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' +
      esc(series.map(function (s) { return s.name; }).join('・')) + '（' + esc(unit) + '）の移り変わり">' + ticks + g + mk + '</svg>';
  }

  // ---------- 横軸が数（月齢・泌乳日数など）の折れ線 ----------
  // series: [{name, color, pts:[{x, y, tip}], dash:bool, dots:bool}]  opt: {xlab, ylab, unit, zero:true で 0 の線を太く}
  function xy(series, opt) {
    opt = opt || {};
    var xs = [], ys = [];
    series.forEach(function (s) { s.pts.forEach(function (p) { if (p.y != null && p.x != null) { xs.push(+p.x); ys.push(+p.y); } }); });
    if (xs.length < 1) return '';
    var W = 320, H = 150, L = 36, R = 8, T = 8, B = 30;
    var sx = nice(Math.min.apply(null, xs), Math.max.apply(null, xs), 5), mnY = Math.min.apply(null, ys), mxY = Math.max.apply(null, ys);
    var padY = (mxY - mnY) * 0.08 || 1, sy = nice(mnY - padY, mxY + padY, 4, opt.zero && mnY > 0 && !opt.free);
    if (opt.zero) { sy = nice(Math.min(mnY, 0) - padY, Math.max(mxY, 0) + padY, 4); }
    var X = function (v) { return L + (v - sx.lo) / (sx.hi - sx.lo || 1) * (W - L - R); };
    var Y = function (v) { return T + (1 - (v - sy.lo) / (sy.hi - sy.lo || 1)) * (H - T - B); };
    var g = sy.ticks.map(function (v) {
      return '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" class="grid"' + (opt.zero && v === 0 ? ' style="stroke:var(--muted);stroke-width:1.2"' : '') + '/>' +
        '<text x="' + (L - 4) + '" y="' + (Y(v) + 3.5).toFixed(1) + '" text-anchor="end">' + tickLabel(v, sy.step) + '</text>';
    }).join('') + sx.ticks.map(function (v) {
      return '<text x="' + X(v).toFixed(1) + '" y="' + (H - 16) + '" text-anchor="middle">' + tickLabel(v, sx.step) + '</text>';
    }).join('') + (opt.xlab ? '<text x="' + ((L + W - R) / 2) + '" y="' + (H - 3) + '" text-anchor="middle">' + esc(opt.xlab) + '</text>' : '');
    series.forEach(function (s) {
      var pts = s.pts.filter(function (p) { return p.y != null && p.x != null; }).sort(function (a, b) { return a.x - b.x; });
      if (pts.length > 1 && s.line !== false) g += '<path d="' + pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p.x).toFixed(1) + ' ' + Y(p.y).toFixed(1); }).join(' ') +
        '" fill="none" stroke="' + s.color + '" stroke-width="2"' + (s.dash ? ' stroke-dasharray="5 4"' : '') + '/>';
      pts.forEach(function (p) {
        g += '<circle cx="' + X(p.x).toFixed(1) + '" cy="' + Y(p.y).toFixed(1) + '" r="' + (s.dots === false ? 0 : 2.6) + '" fill="' + s.color + '"/>' +
          '<circle cx="' + X(p.x).toFixed(1) + '" cy="' + Y(p.y).toFixed(1) + '" r="9" fill="transparent" data-tip="' + esc(p.tip || (s.name + ' ' + fmt(p.y) + (opt.unit || ''))) + '"/>';
      });
    });
    var legend = series.length > 1 ? '<div class="legend">' + series.map(function (s) {
      return '<span><i style="background:' + s.color + '"></i>' + esc(s.name) + '</span>';
    }).join('') + '</div>' : '';
    return legend + '<svg class="herd" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opt.label || '') + '">' + g + '</svg>';
  }

  // ---------- 箱ひげ ----------
  // 値は数か {v, tip}。箱は25〜75%、中の線は中央値、ひげは1.5倍まで、点はそれより外（点の札にその牛）
  function quart(a, p) { var i = (a.length - 1) * p, lo = Math.floor(i); return lo + 1 < a.length ? a[lo] + (a[lo + 1] - a[lo]) * (i - lo) : a[lo]; }
  function boxStat(list) {
    var a = list.map(function (x) { return typeof x === 'number' ? { v: x } : x; }).sort(function (p, q) { return p.v - q.v; });
    if (!a.length) return null;
    var v = a.map(function (x) { return x.v; }), q1 = quart(v, 0.25), mdn = quart(v, 0.5), q3 = quart(v, 0.75), iqr = q3 - q1;
    var inside = a.filter(function (x) { return x.v >= q1 - 1.5 * iqr && x.v <= q3 + 1.5 * iqr; });
    return { n: a.length, q1: q1, md: mdn, q3: q3, lo: inside[0].v, hi: inside[inside.length - 1].v,
             out: a.filter(function (x) { return x.v < q1 - 1.5 * iqr || x.v > q3 + 1.5 * iqr; }) };
  }
  // groups: [{label, note, sets:[{name, color, stat}]}]  opt: {unit, ref:{v, label}}
  function box(groups, opt) {
    opt = opt || {};
    var n = groups.length, per = groups[0] ? groups[0].sets.length : 1, slot = Math.max(30, per * 15), L = 36, R = 6, T = 8, B = 30;
    var W = Math.max(320, L + R + n * slot), H = 220;
    var vals = opt.ref ? [opt.ref.v] : [];
    groups.forEach(function (gp) { gp.sets.forEach(function (s) { if (s.stat) vals = vals.concat([s.stat.lo, s.stat.hi], s.stat.out.map(function (o) { return o.v; })); }); });
    if (!vals.length) return '';
    var sc = nice(Math.min.apply(null, vals), Math.max.apply(null, vals), 5);
    var Y = function (v) { return T + (1 - (v - sc.lo) / (sc.hi - sc.lo)) * (H - T - B); };
    var g = sc.ticks.map(function (v) {
      return '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" class="grid"/>' +
        '<text x="' + (L - 4) + '" y="' + (Y(v) + 3.5).toFixed(1) + '" text-anchor="end">' + tickLabel(v, sc.step) + '</text>';
    }).join('');
    if (opt.ref) g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(opt.ref.v).toFixed(1) + '" y2="' + Y(opt.ref.v).toFixed(1) + '" class="ref"' +
      (opt.ref.label ? ' data-tip="' + esc(opt.ref.label) + '"' : '') + '/>';
    var every = n > 20 ? 3 : n > 10 ? 2 : 1, u = opt.unit || '';
    groups.forEach(function (gp, i) {
      var cx = L + i * slot + slot / 2, off = per > 1 ? 12 : 0;
      gp.sets.forEach(function (s, j) {
        var st = s.stat, c = cx + (per > 1 ? (j - (per - 1) / 2) * off : 0), w = 4.8;
        if (!st) return;
        var tip = gp.label + (gp.note ? '（' + gp.note + '）' : '') + '\n' + s.name + ' ' + st.n + '頭\n中央値 ' + fmt(st.md, 0) + u +
          '\n真ん中の半分 ' + fmt(st.q1, 0) + '〜' + fmt(st.q3, 0) + u + '\nひげ ' + fmt(st.lo, 0) + '〜' + fmt(st.hi, 0) + u;
        g += '<g data-tip="' + esc(tip) + '">' +
          '<line x1="' + c + '" x2="' + c + '" y1="' + Y(st.hi).toFixed(1) + '" y2="' + Y(st.lo).toFixed(1) + '" stroke="' + s.color + '" stroke-width="1.2"/>' +
          '<rect x="' + (c - w) + '" y="' + Y(st.q3).toFixed(1) + '" width="' + (2 * w) + '" height="' + Math.max(1, Y(st.q1) - Y(st.q3)).toFixed(1) +
          '" fill="' + s.color + '" fill-opacity=".35" stroke="' + s.color + '"/>' +
          '<line x1="' + (c - w) + '" x2="' + (c + w) + '" y1="' + Y(st.md).toFixed(1) + '" y2="' + Y(st.md).toFixed(1) + '" stroke="' + s.color + '" stroke-width="2.2"/>' +
          '<rect x="' + (c - w - 3) + '" y="' + Y(st.hi).toFixed(1) + '" width="' + (2 * w + 6) + '" height="' + Math.max(8, Y(st.lo) - Y(st.hi)).toFixed(1) + '" fill="transparent"/></g>';
        st.out.forEach(function (o) {
          g += '<circle cx="' + c + '" cy="' + Y(o.v).toFixed(1) + '" r="2" fill="' + s.color + '"/>' +
            '<circle cx="' + c + '" cy="' + Y(o.v).toFixed(1) + '" r="7" fill="transparent" data-tip="' + esc(gp.label + '\n' + s.name + ' ' + fmt(o.v, 0) + u + (o.tip ? '\n' + o.tip : '')) + '"/>';
        });
      });
      if (i % every === (n - 1) % every) g += '<text x="' + cx + '" y="' + (H - B + 13) + '" text-anchor="middle">' + esc(gp.label) + '</text>';
      if (gp.mark) g += '<text x="' + cx + '" y="' + (H - B + 25) + '" text-anchor="middle" class="cap">' + esc(gp.mark) + '</text>';
    });
    return '<svg class="herd boxplot" viewBox="0 0 ' + W + ' ' + H + '" style="min-width:' + (W > 360 ? W : 0) + 'px" role="img" aria-label="' + esc(opt.label || '箱ひげ図') + '">' + g + '</svg>';
  }

  // ---------- 2軸の棒（左の軸と右の軸。例: 販売金額と頭数） ----------
  // rows: [{label, a, b, tip}]  opt: {a:{name,color,unit}, b:{name,color,unit}}
  function bars2(rows, opt) {
    if (!rows.length) return '';
    var n = rows.length, L = 40, R = 30, T = 10, B = 22, W = 360, H = 180;   // 横に送らず1枚に収める（左右の目もりが両方見えるように）
    var av = rows.map(function (r) { return r.a || 0; }), bv = rows.map(function (r) { return r.b || 0; });
    var sa = nice(0, Math.max.apply(null, av) || 1, 4, true), sb = nice(0, Math.max.apply(null, bv) || 1, 4, true);
    // 2つの軸の目もりの数をそろえる（横線を共有するため）
    var k = Math.max(sa.ticks.length, sb.ticks.length) - 1;
    sa.hi = sa.step * k; sb.hi = sb.step * k;
    var Ya = function (v) { return T + (1 - v / sa.hi) * (H - T - B); }, Yb = function (v) { return T + (1 - v / sb.hi) * (H - T - B); };
    var g = '';
    for (var i = 0; i <= k; i++) {
      var y = Ya(sa.step * i).toFixed(1);
      g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" class="grid"/>' +
        '<text x="' + (L - 4) + '" y="' + (+y + 3.5) + '" text-anchor="end" style="fill:' + opt.a.color + '">' + tickLabel(sa.step * i, sa.step) + '</text>' +
        '<text x="' + (W - R + 4) + '" y="' + (+y + 3.5) + '" text-anchor="start" style="fill:' + opt.b.color + '">' + tickLabel(sb.step * i, sb.step) + '</text>';
    }
    var slot = (W - L - R) / n, bw = Math.min(10, slot * 0.36), every = Math.max(1, Math.ceil(30 / slot));
    rows.forEach(function (r, i) {
      var x = L + i * slot + slot / 2;
      if (r.a != null) g += '<rect x="' + (x - bw - 1).toFixed(1) + '" y="' + Ya(r.a).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (Ya(0) - Ya(r.a)).toFixed(1) + '" fill="' + opt.a.color + '" rx="1.5"/>';
      if (r.b != null) g += '<rect x="' + (x + 1).toFixed(1) + '" y="' + Yb(r.b).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (Yb(0) - Yb(r.b)).toFixed(1) + '" fill="' + opt.b.color + '" rx="1.5"/>';
      g += '<rect x="' + (x - slot / 2).toFixed(1) + '" y="' + T + '" width="' + slot.toFixed(1) + '" height="' + (H - T - B) + '" fill="transparent" data-tip="' +
        esc(r.tip || (r.label + '\n' + opt.a.name + ' ' + fmt(r.a, 0) + opt.a.unit + '\n' + opt.b.name + ' ' + fmt(r.b, 0) + opt.b.unit)) + '"/>';
      if (i % every === (n - 1) % every) g += '<text x="' + x.toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(r.label) + '</text>';
    });
    var legend = '<div class="legend"><span><i style="background:' + opt.a.color + '"></i>' + esc(opt.a.name) + '（左・' + esc(opt.a.unit) + '）</span><span><i style="background:' +
      opt.b.color + '"></i>' + esc(opt.b.name) + '（右・' + esc(opt.b.unit) + '）</span></div>';
    return legend + '<svg class="herd" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opt.a.name + 'と' + opt.b.name) + '">' + g + '</svg>';
  }

  root.FarmTrend = { render: render, xy: xy, box: box, boxStat: boxStat, bars2: bars2, nice: nice, fmt: fmt, hideTip: hideTip };
})(window);
