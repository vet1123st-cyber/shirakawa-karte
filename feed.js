// 白川Farm「餌」— 飼料分析・TMR給与量・糞洗い・PSPS・総合分析。
//
// 2026-11-08 本人と決めたこと:
//   ・5ページ（飼料分析・TMR給与量・糞洗い・PSPS・総合分析）。乳検はまだ入れない
//   ・糞洗い・PSPS は現場で農家さんも入れる。はかった g を打てば % が出る（% を直接打つこともできる）
//   ・糞洗い: 上段・中段・下段・ムチン（あり／なし）・泡・コメント
//   ・PSPS: 上段・中段・下段・受け皿。試料は TMR（搾乳／乾乳・給与時／残飼）か単味粗飼料（粗飼料ロット）
//   ・TMR給与量: 合計kg と頭数を入れて1頭あたりを出す（見るのは1頭あたり）。群は搾乳と乾乳
// 送り方は繁殖・記録と同じ（repro.js の FarmQueue → 箱の input_record）。PC が毎朝 import_box.py で
// farm.db の feces・psps・tmr_feed に入れ、箱へ送り返す。% の出し方は import_box.pct_of と同じ（小数1桁）。
// 飼料分析は PC が farm_summary（section='飼料'）に置いたものを読むだけ（推移のHTMLと同じ値）。

(function () {
  'use strict';

  var F = null, Q = null;
  var TABLE = 'input_record';
  // 2026-11-09 本人「デザイン・配置はこのように」（LIG vets「飼料・消化分析」の画面）: 紺の見出し＋黄の線、
  // 上のタブ 入力・記録・分析・設定、その下で PSPS／糞洗い／TMR給与（分析は 飼料分析／反芻／総合）を切り替える。
  // 住所は #/feed/<タブ>/<種類>。前の #/feed/psps などは入力へ回す
  var VIEWS = [['input', '入力'], ['record', '記録'], ['analysis', '分析'], ['settings', '設定']];
  var KINDS = { input: [['psps', 'PSPS'], ['feces', '糞洗い'], ['tmr', 'TMR給与']],
                record: [['psps', 'PSPS'], ['feces', '糞洗い'], ['tmr', 'TMR給与']],
                analysis: [['analysis', '飼料分析'], ['rumen', '反芻'], ['summary', '総合']],
                settings: [] };
  var KIND = { tmr: 'TMR給与', feces: '糞洗い', psps: 'PSPS' };
  // 目安の範囲（2026-11-09 本人「文献値で仮置き→画面で直せる」）。[下限, 上限]、null は「なし」。
  // PSPS（TMR・19/8/1.18mm＋受け皿）: Penn State DAS 02-42・Kononoff 2003（WSU 資料の再掲）
  // 糞洗い: NWF Agriculture の dung sieving（上 <10・中 <20・下 >50）。ふるいの目開きで変わるので要確認
  // 直した値は箱の input_record（kind「餌の目安」）に入り、全員の画面に出る。直せるのは owner（佐藤さん）だけ
  var TARGET_KIND = '餌の目安';
  var DEFAULT_TARGETS = {
    feces: { upper: [null, 10], middle: [null, 20], lower: [50, null] },
    psps: { upper: [2, 8], middle: [30, 50], lower: [30, 50], pan: [null, 20] }
  };
  var TARGET_SRC = { feces: '糞洗い: NWF Agriculture（英国）の目安', psps: 'PSPS（TMR）: Penn State DAS 02-42・Kononoff 2003' };
  var RUM = null;          // 反芻の箱ひげ（farm_summary の section='反芻'）
  var GROUPS = ['搾乳', '乾乳'];
  var STEPS = { feces: [['upper', '上段'], ['middle', '中段'], ['lower', '下段']],
                psps: [['upper', '上段（19mm〜）'], ['middle', '中段（8〜19mm）'], ['lower', '下段（1.18〜8mm）'], ['pan', '受け皿（〜1.18mm）']] };
  var DEFAULT_TMR = ['デントコーンサイレージ', 'グラスサイレージ', '乾草', '配合飼料'];
  var SHOW4 = ['乾物', 'CP', 'aNDF', 'NDFD30'];
  var S = { view: 'input', sub: 'psps', data: {}, unit: 'g', grp: '搾乳', stype: 'TMR', kind: null, lot: null, item: 'NDFD30',
            psample: null, rdays: 30, tgt: null, tgtAt: null, tgtEdit: false };
  var P = null;            // 飼料分析（farm_summary の section='飼料'）
  var LASTTMR = {};        // 群ごとのいちばん新しい TMR（箱の tmr_feed から）。欄の名前を前回から写すため

  function today() { return Q.localDate(); }
  // 住所 → [タブ, 種類]
  function routeOf(hash) {
    var m = hash.match(/^#\/feed(?:\/(\w+))?(?:\/(\w+))?/) || [], a = m[1], b = m[2];
    var has = function (v, k) { return KINDS[v].some(function (x) { return x[0] === k; }); };
    if (!a) return ['input', S.view === 'input' && has('input', S.sub) ? S.sub : 'psps'];
    if (KINDS[a]) {
      if (a === 'settings') return ['settings', 'settings'];
      return [a, b && has(a, b) ? b : (S.view === a && has(a, S.sub) ? S.sub : KINDS[a][0][0])];
    }
    if (has('input', a)) return ['input', a];                 // 前の住所 #/feed/psps・feces・tmr
    if (has('analysis', a)) return ['analysis', a];           // #/feed/rumen・summary
    return ['input', 'psps'];
  }
  function href(view, sub) { return '#/feed/' + view + (sub && view !== 'settings' ? '/' + sub : ''); }
  function num(v) { var x = parseFloat(v); return isNaN(x) ? undefined : x; }
  function r1(x) { return Math.round(x * 10) / 10; }
  function r2(x) { return Math.round(x * 100) / 100; }

  function show(hash) {
    F = window.Farm;
    Q = window.FarmQueue;
    var r = routeOf(hash);
    if (r[1] !== S.sub || r[0] !== S.view) {
      if (r[1] !== S.sub) S.data = {};
      S.view = r[0]; S.sub = r[1]; S.tgtEdit = false;
    }
    F.app.innerHTML = '<div class="feedui">' + head() + '<p class="muted pad">読み込んでいます…</p></div>';
    need().then(function () {
      if (F.tabOf() !== 'feed') return;
      if (S.view === 'input' && S.sub === 'tmr' && !S.data.items) S.data = tmrStart(S.grp);
      render();
    });
    Q.send();
  }

  // 要るものを読む（飼料分析は1回だけ）。読めなくても入力はできるようにする
  function need() {
    var jobs = [];
    if (!P) jobs.push(F.get('farm_summary?select=note,date&section=eq.' + encodeURIComponent('飼料') + '&key=eq.payload')
      .then(function (rows) { P = rows.length ? JSON.parse(rows[0].note) : { lots: [], samples: [], items: [], kinds: [] }; })
      .catch(function () { P = { lots: [], samples: [], items: [], kinds: [], err: true }; }));
    if (S.sub === 'tmr' || S.sub === 'summary') jobs.push(F.get('tmr_feed?select=date,grp,ingredient,lot,total_kg,heads,per_head_kg,note,source&order=date.asc')
      .then(function (rows) { S.tmrRows = rows; LASTTMR = {}; rows.forEach(function (r) { (LASTTMR[r.grp] = LASTTMR[r.grp] || {})[r.date] = 1; }); })
      .catch(function () { S.tmrRows = null; }));
    if (S.sub === 'feces' || S.sub === 'summary') jobs.push(F.get('feces?select=date,target,item,value,note,source&order=date.asc')
      .then(function (rows) { S.fecesRows = rows; }).catch(function () { S.fecesRows = null; }));
    if (S.sub === 'psps' || S.sub === 'summary') jobs.push(F.get('psps?select=date,sample,item,value,note,source&order=date.asc')
      .then(function (rows) { S.pspsRows = rows; }).catch(function () { S.pspsRows = null; }));
    if (S.sub === 'feces' || S.sub === 'psps' || S.sub === 'settings') jobs.push(F.get('input_record?select=data,updated_at,deleted&kind=eq.' + encodeURIComponent(TARGET_KIND))
      .then(function (rows) { pickTargets(rows); }).catch(function () { pickTargets([]); }));
    if (S.sub === 'rumen' && !RUM) jobs.push(F.get('farm_summary?select=note,date&section=eq.' + encodeURIComponent('反芻') + '&key=eq.payload')
      .then(function (rows) { RUM = rows.length ? JSON.parse(rows[0].note) : { blocks: [] }; })
      .catch(function () { RUM = { blocks: [], err: true }; }));
    // 2026-11-09 本人「入れたらすぐ全員の記録に出るように」: 箱に届いた入力（input_record）を「速報」として重ねる。
    // PC の取り込み（毎朝）を待たない。翌朝 PC が取り込んだら正式な記録になる（同じ日・同じ試料なら入力のほうを出す＝直し・取り消しもすぐ効く）
    var quick = S.sub === 'summary' ? ['feces', 'psps', 'tmr'] : (KIND[S.sub] ? [S.sub] : []);
    var inputs = [];
    quick.forEach(function (k) {
      jobs.push(F.get('input_record?select=id,target,date,kind,data,deleted,updated_at&kind=eq.' + encodeURIComponent(KIND[k]))
        .then(function (rows) { inputs = inputs.concat(rows || []); }).catch(function () { /* 読めなければ PC の分だけ */ }));
    });
    return Promise.all(jobs).then(function () { if (quick.length) mergeQuick(quick, inputs); });
  }

  // ---------- 速報（箱の入力を、PC が取り込んだ表と同じ形にして重ねる） ----------
  // 形は import_box.records と同じ: % は全部の段に g があるときだけ g から（小数1桁）、無ければ打った %
  function pctOf(d, keys, k) {
    var g = keys.map(function (x) { return num(d[x + '_g']); }), tot = g.reduce(function (a, b) { return a + (b || 0); }, 0);
    if (g.every(function (x) { return x !== undefined; }) && tot > 0) return r1(num(d[k + '_g']) / tot * 100);
    return num(d[k]);
  }
  function mergeQuick(kinds, rows) {
    // 同じ id は新しいほう。このスマホの控え（まだ送れていない分も）も入れる
    var byId = {};
    rows.forEach(function (r) { byId[r.id] = { r: r, t: Date.parse(r.updated_at) || 0 }; });
    var s = Q.store();
    Object.keys(s).forEach(function (k) {
      var r = s[k];
      if (r.table !== TABLE || !kinds.some(function (x) { return KIND[x] === r.kind; })) return;
      if (!byId[r.id] || r.at > byId[r.id].t) byId[r.id] = { r: r, t: r.at };
    });
    // 同じ 種類×日×試料（群）なら、あとで入れたもの
    var by = {};
    Object.keys(byId).forEach(function (id) {
      var x = byId[id], key = x.r.kind + '|' + x.r.date + '|' + x.r.target;
      if (!by[key] || x.t > by[key].t) by[key] = x;
    });
    var add = { feces: [], psps: [], tmr: [] }, own = { feces: {}, psps: {}, tmr: {} };
    Object.keys(by).forEach(function (key) {
      var r = by[key].r, d = r.data || {}, k = r.kind === 'PSPS' ? 'psps' : r.kind === '糞洗い' ? 'feces' : 'tmr';
      own[k][r.date + '|' + r.target] = 1;
      if (r.deleted) return;
      var Q2 = '速報', out = add[k];
      if (k === 'tmr') {
        var heads = num(d.heads);
        (d.items || []).forEach(function (it) {
          var total = num(it.total_kg), per = total !== undefined && heads ? r2(total / heads) : num(it.per_head_kg);
          if (!it.name || (total === undefined && per === undefined)) return;
          out.push({ date: r.date, grp: r.target, ingredient: it.name, lot: it.lot || null, total_kg: total, heads: heads, per_head_kg: per, note: d.note || null, source: Q2 });
        });
        return;
      }
      var keys = k === 'psps' ? ['upper', 'middle', 'lower', 'pan'] : ['upper', 'middle', 'lower'];
      var names = { upper: '上段', middle: '中段', lower: '下段', pan: '受け皿' };
      var who = k === 'psps' ? 'sample' : 'target';
      var row = function (item, value, note) { var o = { date: r.date, item: item, value: value === undefined ? null : value, note: note || null, source: Q2 }; o[who] = r.target; out.push(o); };
      keys.forEach(function (x) {
        var p = pctOf(d, keys, x);
        if (p !== undefined) row(names[x], p, k === 'psps' ? d.note : null);
        if (num(d[x + '_g']) !== undefined) row(names[x] + 'g', num(d[x + '_g']));
        if (d['memo_' + x]) row(names[x] + 'メモ', null, d['memo_' + x]);
      });
      if (k === 'feces') {
        if (d.mucin) row('ムチン', null, d.mucin);
        if (d.foam) row('泡', null, d.foam);
        var memo = [d.corn, d.note].filter(Boolean).join(' / ');
        if (memo) row('メモ', null, memo);
      } else {
        if (d.stype) row('試料の種類', null, d.stype);
        if (d.lot) row('ロット', null, d.lot);
        if (d.sdate) row('採取日', null, d.sdate);
        if (num(d.hours) !== undefined) row('給与後の時間', num(d.hours));
      }
    });
    // PC が取り込んだ「白川Farm」の行は、入力のほうを出す（直し・取り消しがすぐ効くように）。糞洗い.xlsx などはそのまま
    var keep = function (rows, k, who) {
      if (rows == null) return add[k].length ? add[k] : null;
      return rows.filter(function (r) { return !(r.source === '白川Farm' && own[k][r.date + '|' + r[who]]); }).concat(add[k])
        .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    };
    if (kinds.indexOf('feces') >= 0) S.fecesRows = keep(S.fecesRows, 'feces', 'target');
    if (kinds.indexOf('psps') >= 0) S.pspsRows = keep(S.pspsRows, 'psps', 'sample');
    if (kinds.indexOf('tmr') >= 0) S.tmrRows = keep(S.tmrRows, 'tmr', 'grp');
  }

  // ---------- 目安の範囲 ----------
  // 箱の「餌の目安」のいちばん新しいもの。このスマホで直してまだ送れていないものがあれば、そちらが新しい
  function pickTargets(rows) {
    var best = null, at = 0;
    (rows || []).forEach(function (r) {
      var t = Date.parse(r.updated_at) || 0;
      if (t >= at) { at = t; best = r.deleted ? null : r.data; }
    });
    var s = Q.store();
    Object.keys(s).forEach(function (k) {
      var r = s[k];
      if (r.table === TABLE && r.kind === TARGET_KIND && r.at > at) { at = r.at; best = r.deleted ? null : r.data; }
    });
    S.tgt = best && best.targets ? best.targets : null;
    S.tgtAt = best && best.targets ? at : null;
  }
  function tg(sub) {
    var t = (S.tgt && S.tgt[sub]) || {}, d = DEFAULT_TARGETS[sub], out = {};
    Object.keys(d).forEach(function (k) { out[k] = t[k] || d[k]; });
    return out;
  }
  function inRange(v, r) {
    if (v == null || !r || (r[0] == null && r[1] == null)) return null;
    return !((r[0] != null && v < r[0]) || (r[1] != null && v > r[1]));
  }
  function rangeText(r) {
    if (!r || (r[0] == null && r[1] == null)) return '—';
    if (r[0] != null && r[1] != null) return r[0] + '〜' + r[1] + '%';
    return r[1] != null ? r[1] + '%以下' : r[0] + '%以上';
  }
  // PSPS の目安は TMR の試料だけに当てる（単味粗飼料には当てない）
  // 糞洗い.xlsx の昔の PSPS（試料名の記録なし）は TMR とみなす（前の線のまとめ方と同じ・要確認）
  function hasTarget(who) { return S.sub === 'feces' || /^TMR/.test(who || '') || who === '（試料名の記録なし）'; }
  // 目安の表（設定タブ）。直しているのは S.tgtEdit の種類（'feces'／'psps'）だけ
  function targetBox(sub) {
    var t = tg(sub), owner = F.role && F.role() === 'owner', ed = S.tgtEdit === sub;
    var from = S.tgtAt ? '佐藤さんが直した値（' + F.day(new Date(S.tgtAt).toISOString()) + '）' : '文献値の仮置き（' + TARGET_SRC[sub] + '）';
    var html = '<table class="tbl"><thead><tr><th>段</th><th>目安</th>' + (ed ? '<th>下限</th><th>上限</th>' : '') + '</tr></thead><tbody>' +
      STEPS[sub].map(function (st) {
        var r = t[st[0]];
        return '<tr><td class="l">' + F.esc(st[1]) + '</td><td>' + rangeText(r) + '</td>' + (ed
          ? '<td><input type="number" inputmode="decimal" step="any" class="tgtin" data-tgt="' + st[0] + '.0" value="' + (r[0] == null ? '' : r[0]) + '"></td>' +
            '<td><input type="number" inputmode="decimal" step="any" class="tgtin" data-tgt="' + st[0] + '.1" value="' + (r[1] == null ? '' : r[1]) + '"></td>' : '') + '</tr>';
      }).join('') + '</tbody></table>' +
      '<p class="small muted">' + F.esc(from) + (sub === 'psps' ? '。TMR の試料だけに当てます。' : '。ふるいの目開きで変わるので要確認。') + '</p>';
    if (owner && !ed) html += '<button type="button" class="link" data-tgtedit="' + sub + '">目安を直す</button>';
    if (owner && ed) html += '<p class="small muted">空欄は「なし」。直すと全員の画面の目安が変わります。</p>' +
      '<div class="opts"><button type="button" data-tgtsave="' + sub + '">この目安にする</button><button type="button" data-tgtreset="' + sub + '">文献値に戻す</button>' +
      '<button type="button" data-tgtcancel="1">やめる</button></div>';
    return F.box((sub === 'psps' ? 'PSPS' : '糞洗い') + ' の目標の範囲（%）', html);
  }
  function saveTargets(sub, reset) {
    var all = {};
    ['feces', 'psps'].forEach(function (k) { all[k] = tg(k); });
    if (reset) all[sub] = DEFAULT_TARGETS[sub];
    else {
      var bad = false;
      [].forEach.call(document.querySelectorAll('[data-tgt]'), function (el) {
        var p = el.getAttribute('data-tgt').split('.'), v = num(el.value);
        all[sub][p[0]] = all[sub][p[0]].slice();
        all[sub][p[0]][+p[1]] = v === undefined ? null : v;
      });
      STEPS[sub].forEach(function (st) { var r = all[sub][st[0]]; if (r[0] != null && r[1] != null && r[0] > r[1]) bad = true; });
      if (bad) { alert('下限が上限より大きい段があります'); return; }
    }
    Q.keep({ table: TABLE, id: Q.uuid(), date: today(), kind: TARGET_KIND, target: '目安', data: { targets: all } });
    S.tgt = all; S.tgtAt = Date.now(); S.tgtEdit = false;
    render();
  }

  // 紺の見出し（牧場・題・中身）＋ 上のタブ（入力・記録・分析・設定）＋ 黄の線 ＋ 種類の切り替え
  function head() {
    var kinds = KINDS[S.view] || [];
    // タブは見出しの外に置く（見出しの中だと、下へ送ったときに上に貼りつかない）
    return '<header class="fhead"><p class="fco">白川牧場</p><h2>飼料・消化分析</h2><p class="fsub">PSPS ・ 糞洗い ・ TMR ・ 反芻</p></header>' +
      '<nav class="ftabs">' + VIEWS.map(function (v) {
        return '<a href="' + href(v[0], v[0] === S.view ? S.sub : '') + '"' + (v[0] === S.view ? ' class="on"' : '') + '>' + v[1] + '</a>';
      }).join('') + '</nav>' +
      (kinds.length ? '<div class="fseg">' + kinds.map(function (k) {
        return '<a href="' + href(S.view, k[0]) + '"' + (k[0] === S.sub ? ' class="on"' : '') + '>' + k[1] + '</a>';
      }).join('') + '</div>' : '') + '<div id="rbar" class="rbar"></div>';
  }

  function render() {
    if (F.tabOf() !== 'feed') return;
    var html = head();
    if (S.view === 'settings') html += settingsPage();
    else if (S.sub === 'analysis') html += analysisPage();
    else if (S.sub === 'summary') html += summaryPage();
    else if (S.sub === 'rumen') html += rumenPage();
    else if (S.view === 'record') html += S.sub === 'tmr' ? tmrHistory() : groupHistory();
    else html += (S.sub === 'tmr' ? tmrForm() : S.sub === 'feces' ? fecesForm() : pspsForm()) + '<div id="rmine">' + mine() + '</div>';
    F.app.innerHTML = '<div class="feedui">' + html + '</div>';
    var sw = document.getElementById('stackwrap');    // 積み上げは、はじめ新しい回（右端）を見せる
    if (sw) { sw.scrollLeft = S.stackScroll != null ? S.stackScroll : sw.scrollWidth; S.stackScroll = null; }
    Q.bar();
    F.app.onclick = onClick;
    F.app.oninput = onInput;
    // 段の欄で「次へ／改行」を押したら次の段へ（最後の段なら閉じる）
    // 入れる欄に入ったら、キーボードと下の「残す」バーに隠れないよう真ん中へ（キーボードが出きってから）
    if (!F.app._feedFocus) F.app._feedFocus = F.app.addEventListener('focusin', function (e) {
      var el = e.target;
      if (F.tabOf() !== 'feed') return;
      if (!el.matches || !el.matches('input[type=number],input[type=text],textarea')) return;
      setTimeout(function () { if (document.activeElement === el) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 300);
    }) || true;
    F.app.onkeydown = function (e) {
      if (e.key !== 'Enter' || !e.target.hasAttribute || !e.target.hasAttribute('data-step-in')) return;
      e.preventDefault();
      var all = [].slice.call(document.querySelectorAll('[data-step-in]')), i = all.indexOf(e.target);
      if (all[i + 1]) all[i + 1].focus(); else e.target.blur();
    };
    F.app.onchange = onInput;
  }

  // ---------- ロット ----------
  function lotById(id) { return (P.lots || []).filter(function (l) { return l.id === id; })[0]; }
  function lotsNewest() {
    return (P.lots || []).slice().sort(function (a, b) {
      var la = lastSample(a.id), lb = lastSample(b.id);
      return (lb ? lb.date : '') < (la ? la.date : '') ? -1 : 1;
    });
  }
  function lastSample(lot, upto) {
    var hit = null;
    (P.samples || []).forEach(function (s) { if (s.lot === lot && (!upto || s.date <= upto)) hit = s; });
    return hit;
  }
  function lotSelect(key, v, emptyLabel) {
    var kinds = {};
    (P.kinds || []).forEach(function (k) { kinds[k.id] = k.label; });
    var by = {};
    lotsNewest().forEach(function (l) { (by[l.kind] = by[l.kind] || []).push(l); });
    return '<select data-sel="' + key + '"><option value="">' + F.esc(emptyLabel) + '</option>' + Object.keys(by).map(function (k) {
      return '<optgroup label="' + F.esc(kinds[k] || k) + '">' + by[k].map(function (l) {
        return '<option value="' + F.esc(l.id) + '"' + (v === l.id ? ' selected' : '') + '>' + F.esc(l.name) + '</option>';
      }).join('') + '</optgroup>';
    }).join('') + '</select>';
  }

  // ---------- 飼料分析（見るだけ） ----------
  function analysisPage() {
    if (P.err) return F.box('飼料分析', F.none('飼料分析が読めませんでした。電波を確かめて開き直してください。'));
    if (!P.lots.length) return F.box('飼料分析', F.none('まだ飼料分析が入っていません（PC の朝の取り込みで入ります）。'));
    if (!S.lot || !lotById(S.lot)) S.lot = lotsNewest()[0].id;
    var lot = lotById(S.lot);
    var ss = P.samples.filter(function (s) { return s.lot === S.lot; });
    var unit = {};
    P.items.forEach(function (i) { unit[i.id] = i.unit; });
    var has = P.items.filter(function (i) { return ss.some(function (s) { return s.v[i.id] != null; }); });
    if (!has.some(function (i) { return i.id === S.item; })) S.item = has.length ? has[0].id : 'NDFD30';
    var html = F.box('粗飼料ロット', '<div class="pickers">' + lotSelect('lot', S.lot, 'ロットを選ぶ') + '</div>' +
      '<p class="small muted">' + F.esc(lot.name) + '・収穫日 ' + (lot.harvest ? F.day(lot.harvest) : '記載なし') + '・分析 ' + ss.length + '回' +
      (lot.note ? '<br>' + F.esc(lot.note) : '') + '</p>');
    var chart = F.trend([{ name: S.item, color: 'var(--accent)', pts: ss.filter(function (s) { return s.v[S.item] != null; })
      .map(function (s) { return { d: s.date, v: s.v[S.item] }; }) }], unit[S.item] || '');
    html += F.box('成分の移り変わり', '<div class="opts">' + has.map(function (i) {
      return '<button type="button" data-item="' + F.esc(i.id) + '"' + (i.id === S.item ? ' class="on"' : '') + '>' + F.esc(i.id) + '</button>';
    }).join('') + '</div>' + (chart || '<p class="small muted">採取日が1日だけなので線は引けません。下の表を見てください。</p>'));
    var cols = SHOW4.concat(SHOW4.indexOf(S.item) < 0 ? [S.item] : []);
    html += F.box('採取日ごとの値', '<div class="scroll"><table class="tbl"><thead><tr><th>採取日</th>' + cols.map(function (c) {
      return '<th>' + F.esc(c) + '<br><span class="small">' + F.esc(unit[c] || '') + '</span></th>';
    }).join('') + '<th>サンプル</th></tr></thead><tbody>' + ss.slice().reverse().map(function (s) {
      return '<tr><td>' + F.day(s.date) + '</td>' + cols.map(function (c) { return '<td>' + (s.v[c] != null ? F.esc(fmt(s.v[c])) : '—') + '</td>'; }).join('') +
        '<td class="l small">' + F.esc(s.no) + '</td></tr>';
    }).join('') + '</tbody></table></div>' +
      '<p class="small muted">乾物は原物中、ほかは乾物中。ロットの分け方は 粗飼料ロット.csv（推定・要確認のものを含む）。</p>' +
      F.src('全酪連の飼料分析（PDF・Excel）。同じサンプルが両方にあるときは PDF'));
    return html;
  }
  function fmt(v) { return String(Math.round(v * 100) / 100); }

  // ---------- TMR給与量 ----------
  // 前回（同じ群のいちばん新しい記録）の原料とロットを写して始める。量は空にする
  function tmrStart(grp) {
    var rows = (S.tmrRows || []).filter(function (r) { return r.grp === grp; });
    var last = rows.length ? rows[rows.length - 1].date : null;
    var items = last ? rows.filter(function (r) { return r.date === last; }).map(function (r) { return { name: r.ingredient, lot: r.lot || '' }; })
      : DEFAULT_TMR.map(function (n) { return { name: n, lot: '' }; });
    var heads = last ? rows.filter(function (r) { return r.date === last; })[0].heads : undefined;
    return { items: items, heads: heads == null ? undefined : String(heads), from: last };
  }
  function perHead(it, heads) {
    var t = num(it.total_kg), h = num(heads);
    if (t !== undefined && h) return r2(t / h);
    return num(it.per_head_kg);
  }
  function tmrForm() {
    var d = S.data, html = '';
    html += F.box('群', '<div class="opts">' + GROUPS.map(function (g) {
      return '<button type="button" data-grp="' + g + '"' + (S.grp === g ? ' class="on"' : '') + '>' + g + '</button>';
    }).join('') + '</div>' + (d.from ? '<p class="small muted">原料とロットは前回（' + F.day(d.from) + '）から写しました。量を入れてください。</p>' : '') +
      numField('heads', 'そのときの頭数', d.heads, '1'));
    html += F.box('原料（現物 kg）', '<p class="small muted">1回の調製の合計kg を入れると、頭数で割って1頭あたりを出します。合計が分からないときは1頭あたりを直接打てます。</p>' +
      d.items.map(function (it, i) {
        var auto = num(it.total_kg) !== undefined && num(d.heads);
        return '<div class="tmrrow"><div class="tmrname"><input type="text" data-text="it.' + i + '.name" value="' + F.esc(it.name || '') + '" placeholder="原料の名前">' +
          '<button type="button" class="link danger" data-delrow="' + i + '">外す</button></div>' +
          '<div class="pickers">' + lotSelect('it.' + i + '.lot', it.lot, '粗飼料ロット（分かれば）') + '</div>' +
          '<div class="tmrnums"><label>合計kg<input type="number" inputmode="decimal" step="any" data-text="it.' + i + '.total_kg" value="' + F.esc(it.total_kg == null ? '' : it.total_kg) + '"></label>' +
          '<label>1頭kg<input type="number" inputmode="decimal" step="any" data-text="it.' + i + '.per_head_kg" id="ph' + i + '"' +
          (auto ? ' disabled value="' + perHead(it, d.heads) + '"' : ' value="' + F.esc(it.per_head_kg == null ? '' : it.per_head_kg) + '"') + '></label></div></div>';
      }).join('') + '<button type="button" class="link" data-addrow="1">＋ 原料を足す</button>' +
      '<p class="small" id="tmrsum">' + tmrSum() + '</p>');
    html += F.box('メモ', textField('note', 'メモ（切り替えた理由など）', d.note)) +
      '<div class="pickers"><label class="small muted" for="rdate">給与した日</label><input id="rdate" type="date" value="' + (d.date || today()) + '"></div>' +
      saveBar();
    return html;
  }
  function tmrSum() {
    var d = S.data, sum = 0, n = 0;
    d.items.forEach(function (it) { var p = perHead(it, d.heads); if (p !== undefined) { sum += p; n++; } });
    return n ? '1頭あたり 合計 <b>' + r1(sum) + ' kg</b>（現物・' + n + '原料）' : '';
  }
  function tmrHistory() {
    // 記録タブでは群をここで切り替える（入力タブは入力欄の上で切り替える）
    var pick = S.view === 'record' ? F.box('群', '<div class="opts">' + GROUPS.map(function (g) {
      return '<button type="button" data-grp="' + g + '"' + (S.grp === g ? ' class="on"' : '') + '>' + g + '</button>';
    }).join('') + '</div>') : '';
    var rows = S.tmrRows;
    if (rows == null) return pick + F.box('これまで', F.none('これまでの記録が読めませんでした。'));
    rows = rows.filter(function (r) { return r.grp === S.grp; });
    if (!rows.length) return pick + F.box('これまで（' + S.grp + '）', F.none('まだ記録がありません。'));
    var quickDates = {};
    rows.forEach(function (r) { if (r.source === '速報') quickDates[r.date] = 1; });
    var dates = [];
    rows.forEach(function (r) { if (dates.indexOf(r.date) < 0) dates.push(r.date); });
    // 2026-11-09 本人「過去の推移」: 1頭あたり合計（現物kg）の移り変わり。いちばん新しい回と前回の差も出す
    var tot = function (d) { return rows.filter(function (r) { return r.date === d && r.per_head_kg != null; }).reduce(function (a, r) { return a + +r.per_head_kg; }, 0); };
    var chart = F.trend([{ name: '1頭あたり合計', color: 'var(--accent)', pts: dates.map(function (d) { return { d: d, v: r1(tot(d)) }; }) }], 'kg');
    var diff = dates.length > 1 ? r1(tot(dates[dates.length - 1]) - tot(dates[dates.length - 2])) : null;
    var trendBox = F.box('1頭あたり合計の推移（' + S.grp + '・現物kg）', (chart || '<p class="small muted">記録が2回になると線が出ます。</p>') +
      (diff != null ? '<p class="small">いちばん新しい回（' + F.day(dates[dates.length - 1]) + '）は前回より <b>' + (diff > 0 ? '+' : '') + diff + ' kg</b></p>' : ''));
    dates = dates.slice(-6);
    var names = [];
    rows.forEach(function (r) { if (dates.indexOf(r.date) >= 0 && names.indexOf(r.ingredient) < 0) names.push(r.ingredient); });
    var at = function (d, n) { return rows.filter(function (r) { return r.date === d && r.ingredient === n; })[0]; };
    return pick + trendBox + F.box('これまで（' + S.grp + '・1頭あたり 現物kg・新しい6回）', '<div class="scroll"><table class="tbl"><thead><tr><th>原料</th>' +
      dates.map(function (d) { return '<th>' + F.md(d) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      names.map(function (n) {
        return '<tr><td class="l">' + F.esc(n) + '</td>' + dates.map(function (d) { var r = at(d, n); return '<td>' + (r && r.per_head_kg != null ? F.n(r.per_head_kg, 1) : '—') + '</td>'; }).join('') + '</tr>';
      }).join('') + '<tr><td class="l"><b>合計</b></td>' + dates.map(function (d) {
        var s = rows.filter(function (r) { return r.date === d && r.per_head_kg != null; }).reduce(function (a, r) { return a + +r.per_head_kg; }, 0);
        return '<td><b>' + F.n(s, 1) + '</b></td>';
      }).join('') + '</tr><tr><td class="l small muted">頭数</td>' + dates.map(function (d) {
        var r = rows.filter(function (x) { return x.date === d; })[0];
        return '<td class="small muted">' + (r && r.heads != null ? r.heads : '—') + '</td>';
      }).join('') + '</tr></tbody></table></div>' +
      (Object.keys(quickDates).length ? '<p class="small muted"><span class="badge quick">速報</span> ' + Object.keys(quickDates).sort().map(F.md).join('・') +
        ' は入れたばかり（PC の取り込み前）。翌朝 PC が取り込むと正式な記録になります。</p>' : '') +
      F.src('白川Farm で入れた分（PC が毎朝取り込んだもの）と速報'));
  }

  // ---------- 糞洗い・PSPS ----------
  // g と % の切り替えはめったに使わないので小さく（2026-11-09 iPhone で入れやすく）
  function unitSeg() {
    return '<p class="unitlink">' + (S.unit === 'g' ? 'g を入れると % が出ます。' : '% を直接入れています。') +
      ' <button type="button" class="link" data-unit="' + (S.unit === 'g' ? 'pct' : 'g') + '">' + (S.unit === 'g' ? '% で入れる' : 'g で入れる') + '</button></p>';
  }
  // 画面の下に固定する「残す」バー。左に入れ具合（段がいくつ入ったか・合計）、右に残す。警告もここに出す（alert を使わない）
  function saveBar() {
    return '<div class="savebar"><p id="savemsg" class="savemsg" role="alert"></p><div class="sbrow"><div class="sbinfo" id="sbinfo">' + sbInfo() +
      '</div><button type="button" class="sbbtn" data-save="1">残す</button></div></div>';
  }
  function sbInfo() {
    if (S.sub === 'tmr') return tmrSum() || '原料の量を入れてください';
    var steps = STEPS[S.sub], d = S.data, n = 0, tot = 0;
    steps.forEach(function (st) { var v = num(d[S.unit === 'g' ? st[0] + '_g' : st[0]]); if (v !== undefined) { n++; tot += v; } });
    return '<b>' + n + '</b>/' + steps.length + '段' + (n ? '・合計 ' + r1(tot) + (S.unit === 'g' ? ' g' : ' %') : '') +
      (n === steps.length ? ' <span class="ok">✓</span>' : '');
  }
  function fail(msg, sel) {
    var m = document.getElementById('savemsg');
    if (m) { m.textContent = msg; m.className = 'savemsg on'; }
    var el = typeof sel === 'string' ? document.querySelector(sel) : null;
    if (sel === 'step') el = [].filter.call(document.querySelectorAll('[data-step-in]'), function (x) { return x.value === ''; })[0];
    if (el) { el.focus(); el.scrollIntoView({ block: 'center' }); }
  }
  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'ftoast';
    t.innerHTML = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add('go'); }, 2600);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3200);
  }
  // 2026-11-09 本人「デザイン・配置はこのように」（LIG vets の飼料・消化分析アプリの画面）:
  // 段ごとに［段の名前・ふるい］［g の欄］［%］→ 目標の帯と今の位置 →「目標 ○〜○%」→ この段のメモ
  function stepName(st) { return st[1].replace(/（.*$/, ''); }
  function stepSize(st) { var m = st[1].match(/（(.*)）/); return m ? m[1] : ''; }
  function useTargetNow() { return S.sub === 'feces' || S.stype === 'TMR'; }
  function stepFields() {
    var steps = STEPS[S.sub], d = S.data, t = tg(S.sub), useT = useTargetNow();
    return F.box('残った重さ ' + (S.unit === 'g' ? 'g' : '%'), unitSeg() + steps.map(function (st) {
      var k = S.unit === 'g' ? st[0] + '_g' : st[0];
      return '<div class="step" data-field="' + k + '"><div class="steph">' +
        '<span class="stepn s-' + st[0] + '">' + F.esc(stepName(st)) + '</span><span class="stepsz">' + F.esc(stepSize(st)) + '</span>' +
        // 段の欄だけを続けて並べる（iPhone のキーボードの「∨（次へ）」で 上→中→下→受け皿 と移れる。メモは最後にまとめて）
        '<input type="number" inputmode="decimal" step="any" placeholder="0" enterkeyhint="next" autocomplete="off" data-step-in="1" data-text="' + k + '" value="' + F.esc(d[k] == null ? '' : d[k]) + '">' +
        '<span class="pct" id="pct_' + st[0] + '">' + pctText(st[0]) + '</span></div>' +
        (useT ? '<div class="tbar" id="bar_' + st[0] + '">' + barInner(st[0]) + '</div><p class="tlabel">目標 ' + rangeText(t[st[0]]) + '</p>' : '') +
        '</div>';
    }).join('') + '<p class="small" id="psum">' + sumText() + '</p>' +
      (useT ? '' : '<p class="small muted">単味粗飼料には目標を当てていません。</p>')) +
      F.box('今回の構成比', '<div id="live">' + liveStack() + '</div>');
  }
  // 入れている回の 100%積み上げ（横の棒）。下に、同じ試料の前回を並べる（2026-11-09 本人「入力したらその画面で積み上げ棒グラフ％」）
  function hbar(v, label) {
    var steps = STEPS[S.sub], tot = 0;
    steps.forEach(function (st) { tot += v[st[0]] || 0; });
    if (!tot) return '';
    return '<div class="hrow"><span class="hlab">' + F.esc(label) + '</span><div class="hb">' + steps.map(function (st) {
      var w = (v[st[0]] || 0) / tot * 100;
      return w > 0 ? '<span class="hs s-' + st[0] + 'b" style="width:' + w.toFixed(2) + '%">' + (w >= 9 ? Math.round(v[st[0]]) : '') + '</span>' : '';
    }).join('') + '</div></div>';
  }
  function liveStack() {
    var p = pcts(), steps = STEPS[S.sub];
    var now = steps.every(function (st) { return p[st[0]] !== undefined; }) ? hbar(p, '今回') : '';
    var who = S.sub === 'psps' ? pspsTarget() : (S.data.target || '').trim();
    var rows = S.sub === 'psps' ? S.pspsRows : S.fecesRows, prev = null;
    if (rows && who) gather(rows, S.sub === 'psps' ? 'sample' : 'target').forEach(function (x) {
      var same = S.sub === 'psps' && who === 'TMR（搾乳）・給与時' ? isMainPsps(x) : x.who === who;   // 昔の試料名なしは TMR とみなす
      if (same && steps.every(function (st) { return x.v[stepName(st)] != null; })) prev = x;
    });
    var pv = {};
    if (prev) steps.forEach(function (st) { pv[st[0]] = prev.v[stepName(st)]; });
    return (now || '<p class="small muted">全部の段を入れると、ここに今回の構成比が出ます。</p>') +
      (prev ? hbar(pv, '前回 ' + F.md(prev.date)) : '') +
      '<div class="legend">' + steps.map(function (st) { return '<span><i class="sw s-' + st[0] + '"></i>' + F.esc(stepName(st)) + '</span>'; }).join('') + '</div>';
  }
  // 目標の帯（0〜100% の上に緑の帯）と、いまの % の印
  function barInner(k) {
    var r = tg(S.sub)[k], v = pcts()[k];
    var lo = r && r[0] != null ? r[0] : 0, hi = r && r[1] != null ? r[1] : 100;
    var ok = inRange(v, r);
    return '<span class="band" style="left:' + lo + '%;width:' + Math.max(1, hi - lo) + '%"></span>' +
      (v === undefined ? '' : '<span class="mark' + (ok === false ? ' out' : '') + '" style="left:' + Math.min(100, Math.max(0, v)) + '%"></span>');
  }
  // g から % を出す（import_box.pct_of と同じ: 全部の段に g があるときだけ、小数1桁）
  function pcts() {
    var steps = STEPS[S.sub], d = S.data, out = {};
    if (S.unit === 'g') {
      var g = steps.map(function (st) { return num(d[st[0] + '_g']); });
      var tot = g.reduce(function (a, b) { return a + (b || 0); }, 0);
      if (g.every(function (x) { return x !== undefined; }) && tot > 0) steps.forEach(function (st, i) { out[st[0]] = r1(g[i] / tot * 100); });
      out._tot = tot;
      out._all = g.every(function (x) { return x !== undefined; });
    } else steps.forEach(function (st) { out[st[0]] = num(d[st[0]]); });
    return out;
  }
  function pctText(k) {
    var p = pcts()[k];
    if (p === undefined) return '<span class="none">— %</span>';
    var ok = useTargetNow() ? inRange(p, tg(S.sub)[k]) : null;
    return '<b class="' + (ok === false ? 'outv' : '') + '">' + p + '</b> %';
  }
  function sumText() {
    var p = pcts(), steps = STEPS[S.sub];
    if (S.unit === 'g') return p._all ? '合計 ' + r1(p._tot) + ' g → % を出しました' : '全部の段の g を入れると % が出ます（無い段は 0 を入れてください）';
    var v = steps.map(function (st) { return p[st[0]]; });
    if (v.some(function (x) { return x === undefined; })) return '合計 —';
    var s = v.reduce(function (a, b) { return a + b; }, 0);
    return Math.abs(s - 100) <= 5 ? '合計 ' + r1(s) + ' %' : '<span class="warn">合計 ' + r1(s) + ' %（100 から離れています。打ち間違いがないか見てください）</span>';
  }

  // はかった日はいちばん上（2026-11-09 本人「測った日が最初に来て」）
  // はかった日はいちばん上（2026-11-09 本人「測った日が最初に来て」）。サンプル情報は2列（見本と同じ並び）
  function dateTop(label) {
    return '<div class="field"><label for="rdate">' + label + '</label><input id="rdate" type="date" value="' + (S.data.date || today()) + '"></div>';
  }
  function selField(k, label, list, v, blank) {
    return '<div class="field"><label>' + F.esc(label) + '</label><select data-sel="' + k + '">' + (blank ? '<option value="">' + F.esc(blank) + '</option>' : '') +
      list.map(function (o) {
        var val = Array.isArray(o) ? o[0] : o, lab = Array.isArray(o) ? o[1] : o;
        return '<option value="' + F.esc(val) + '"' + (String(v) === String(val) ? ' selected' : '') + '>' + F.esc(lab) + '</option>';
      }).join('') + '</select></div>';
  }
  function fecesForm() {
    var d = S.data;
    return F.box('サンプル情報', '<div class="grid2">' + dateTop('はかった日') +
        textField('target', '採取した牛', d.target) + '</div>' +
        '<p class="small muted">採取した牛の例: 5頭初産DIM60-80・1510 1533</p>') +
      stepFields() +
      F.box('所見', '<div class="grid2">' + selField('mucin', 'ムチン', ['あり', 'なし'], d.mucin, '—') +
        selField('foam', '泡', ['−', '＋', '＋＋', '＋＋＋'], d.foam, '—') + '</div>' +
        textField('corn', 'コーン・繊維の残り', d.corn) + areaField('note', 'コメント', d.note)) +
      saveBar();
  }

  function pspsTarget() {
    var d = S.data;
    if (S.stype === 'TMR') return 'TMR（' + (d.grp || '搾乳') + '）・' + (d.timing || '給与時');
    var l = d.lot ? lotById(d.lot) : null;
    var name = l ? l.name : (d.rname || '').trim();
    return name ? '単味：' + name : '';
  }
  function pspsForm() {
    // 2026-11-09 本人「PSPS は採取の日等も入れてほしい」: はかった日・採取日・給与後の時間・試料・メモを上の「サンプル情報」に
    var d = S.data, html = '';
    html += F.box('サンプル情報', '<div class="grid2">' + dateTop('はかった日') +
      '<div class="field"><label for="sdate">採取日</label><input id="sdate" type="date" data-text="sdate" value="' + F.esc(d.sdate || d.date || today()) + '"></div>' +
      selField('stype', '飼料タイプ', [['TMR', 'TMR'], ['単味', '単味粗飼料']], S.stype) +
      (S.stype === 'TMR' ? selField('grp', '牛群', GROUPS, d.grp || '搾乳') + selField('timing', '採取区分', [['給与時', '給与直後'], ['残飼', '残飼']], d.timing || '給与時')
        : '<div class="field"><label>粗飼料ロット</label>' + lotSelect('lot', d.lot, '一覧に無い') + '</div><div class="field"></div>') +
      '<div class="field"><label>給与後の時間</label><input type="number" inputmode="decimal" step="any" placeholder="任意 例: 0, 4, 8" data-text="hours" value="' +
        F.esc(d.hours == null ? '' : d.hours) + '"></div></div>' +
      (S.stype !== 'TMR' && !d.lot ? textField('rname', '粗飼料の名前（例: グラス 2番 ロール）', d.rname) : '') +
      '<p class="small muted" id="ptarget">記録の名前: ' + F.esc(pspsTarget() || '—') + '</p>');
    html += stepFields() + F.box('メモ', areaField('note', '所見など（まとめて）', d.note)) + saveBar();
    return html;
  }

  // ---------- 欄 ----------
  function numField(k, label, v, step) {
    return '<div class="field" data-field="' + k + '"><label>' + F.esc(label) + '</label><input type="number" inputmode="decimal" step="' + (step || 'any') +
      '" data-text="' + k + '" value="' + F.esc(v == null ? '' : v) + '"></div>';
  }
  function textField(k, label, v) {
    return '<div class="field" data-field="' + k + '"><label>' + F.esc(label) + '</label><input type="text" data-text="' + k + '" value="' + F.esc(v || '') + '"></div>';
  }
  function areaField(k, label, v) {
    return '<div class="field" data-field="' + k + '"><label>' + F.esc(label) + '</label><textarea data-text="' + k + '">' + F.esc(v || '') + '</textarea></div>';
  }
  function opts(k, label, list, v) {
    return '<div class="field big" data-field="' + k + '"><label>' + F.esc(label) + '</label><div class="opts">' + list.map(function (o) {
      return '<button type="button" data-set="' + k + '" data-val="' + F.esc(o) + '"' + (String(v) === o ? ' class="on"' : '') + '>' + F.esc(o) + '</button>';
    }).join('') + '</div></div>';
  }

  function setPath(path, v) {
    var m = path.match(/^it\.(\d+)\.(\w+)$/);
    if (m) { S.data.items[+m[1]][m[2]] = v; return; }
    S.data[path] = v;
  }

  function onInput(e) {
    var t = e.target, k = t.getAttribute && (t.getAttribute('data-text') || t.getAttribute('data-sel'));
    if (!k) return;
    if ((t.tagName === 'SELECT') !== (e.type === 'change')) return;   // 選ぶ欄は change、打つ欄は input で1回だけ
    var v = t.value === '' ? undefined : t.value;
    if (k === 'lot' && S.sub === 'analysis') { S.lot = v; return render(); }
    if (k === 'stype') { S.stype = v || 'TMR'; return render(); }
    setPath(k, v);
    if (S.sub === 'tmr') {
      // 合計kg と頭数から1頭あたりを出し直す（打っている欄は描き直さない）
      S.data.items.forEach(function (it, i) {
        var el = document.getElementById('ph' + i), auto = num(it.total_kg) !== undefined && num(S.data.heads);
        if (!el) return;
        if (auto) { el.disabled = true; el.value = perHead(it, S.data.heads); }
        else if (el.disabled) { el.disabled = false; el.value = it.per_head_kg == null ? '' : it.per_head_kg; }
      });
      document.getElementById('tmrsum').innerHTML = tmrSum();
      var sb2 = document.getElementById('sbinfo');
      if (sb2) sb2.innerHTML = sbInfo();
      return;
    }
    if (S.sub === 'psps' && k === 'lot') return render();     // ロットを選んだら名前の欄を出し入れする
    STEPS[S.sub] && STEPS[S.sub].forEach(function (st) {
      var el = document.getElementById('pct_' + st[0]); if (el) el.innerHTML = pctText(st[0]);
      var bar = document.getElementById('bar_' + st[0]); if (bar) bar.innerHTML = barInner(st[0]);
    });
    var sb = document.getElementById('sbinfo');
    if (sb) sb.innerHTML = sbInfo();
    var sm = document.getElementById('savemsg');
    if (sm && sm.className !== 'savemsg') { sm.className = 'savemsg'; sm.textContent = ''; }
    var lv = document.getElementById('live');
    if (lv) lv.innerHTML = liveStack();
    var ps = document.getElementById('psum');
    if (ps) ps.innerHTML = sumText();
    var pt = document.getElementById('ptarget');
    if (pt) pt.innerHTML = '記録の名前: ' + F.esc(pspsTarget() || '—');
  }

  function keepDate() { var el = document.getElementById('rdate'); if (el) S.data.date = el.value; }

  function onClick(e) {
    var pk = e.target.closest && e.target.closest('[data-pick]');
    if (pk) {                                   // 積み上げの棒を押した → その回の詳細（横の位置はそのまま）
      var sw = document.getElementById('stackwrap');
      S.stackScroll = sw ? sw.scrollLeft : null;
      S.pick = pk.getAttribute('data-pick');
      keepDate();
      return render();
    }
    var stp = e.target.closest('.step');
    if (stp && !e.target.closest('input,button,a')) { var si = stp.querySelector('[data-step-in]'); if (si) si.focus(); return; }
    var t = e.target.closest('button');
    if (!t) return;
    keepDate();
    if (t.hasAttribute('data-tgtedit')) { S.tgtEdit = t.getAttribute('data-tgtedit'); return render(); }
    if (t.hasAttribute('data-tgtcancel')) { S.tgtEdit = false; return render(); }
    if (t.hasAttribute('data-tgtsave')) return saveTargets(t.getAttribute('data-tgtsave'), false);
    if (t.hasAttribute('data-tgtreset')) { if (confirm('文献値の目安に戻しますか？')) saveTargets(t.getAttribute('data-tgtreset'), true); return; }
    if (t.hasAttribute('data-psample')) { S.psample = t.getAttribute('data-psample'); return render(); }
    if (t.hasAttribute('data-pcmp')) { S.pcmp = t.getAttribute('data-pcmp'); return render(); }
    if (t.hasAttribute('data-rdays')) { S.rdays = +t.getAttribute('data-rdays'); return render(); }
    if (t.hasAttribute('data-item')) { S.item = t.getAttribute('data-item'); return render(); }
    if (t.hasAttribute('data-grp')) { S.grp = t.getAttribute('data-grp'); S.data = tmrStart(S.grp); return render(); }
    if (t.hasAttribute('data-addrow')) { S.data.items.push({ name: '', lot: '' }); return render(); }
    if (t.hasAttribute('data-delrow')) { S.data.items.splice(+t.getAttribute('data-delrow'), 1); return render(); }
    if (t.hasAttribute('data-unit')) { S.unit = t.getAttribute('data-unit'); return render(); }
    if (t.hasAttribute('data-stype')) { S.stype = t.getAttribute('data-stype'); return render(); }
    if (t.hasAttribute('data-set')) {
      var k = t.getAttribute('data-set'), v = t.getAttribute('data-val');
      S.data[k] = String(S.data[k]) === v && k !== 'grp' && k !== 'timing' ? undefined : v;     // もう一度押したら取り消し
      [].forEach.call(document.querySelectorAll('[data-set="' + k + '"]'), function (b) {
        b.className = String(S.data[k]) === b.getAttribute('data-val') ? 'on' : '';
      });
      var pt = document.getElementById('ptarget');
      if (pt) pt.innerHTML = '記録の名前: ' + F.esc(pspsTarget() || '—');
      return;
    }
    if (t.hasAttribute('data-save')) return save();
    if (t.hasAttribute('data-undo-id')) {
      var s = Q.store(), r = s[t.getAttribute('data-undo-id')];
      if (r && confirm('この記録を取り消しますか？（箱には「取り消し」として残ります）')) { r.deleted = true; Q.keep(r); render(); }
    }
  }

  function save() {
    var d = S.data, date = (document.getElementById('rdate') || {}).value || today();
    var rec = { table: TABLE, id: Q.uuid(), date: date, kind: KIND[S.sub], data: {} };
    if (S.sub === 'tmr') {
      var heads = num(d.heads);
      var items = d.items.map(function (it) {
        return { name: (it.name || '').trim(), lot: it.lot || undefined, total_kg: num(it.total_kg), per_head_kg: perHead(it, d.heads) };
      }).filter(function (it) { return it.name && (it.total_kg !== undefined || it.per_head_kg !== undefined); });
      if (!items.length) { return fail('原料の量を1つ以上入れてください'); }
      if (items.some(function (it) { return it.total_kg !== undefined; }) && !heads) { return fail('合計kg を入れたときは頭数も入れてください（1頭あたりを出すため）', '[data-text="heads"]'); }
      var names = items.map(function (it) { return it.name; });
      if (names.some(function (n, i) { return names.indexOf(n) !== i; })) { return fail('同じ名前の原料が2つあります。名前を分けてください'); }
      rec.target = S.grp;
      rec.data = { heads: heads, items: items, note: d.note || undefined };
    } else {
      var p = pcts(), steps = STEPS[S.sub];
      steps.forEach(function (st) {
        if (S.unit === 'g') rec.data[st[0] + '_g'] = num(d[st[0] + '_g']);
        rec.data[st[0]] = p[st[0]];
        rec.data['memo_' + st[0]] = (d['memo_' + st[0]] || '').trim() || undefined;     // この段のメモ
      });
      var any = steps.some(function (st) { return rec.data[st[0]] !== undefined || rec.data[st[0] + '_g'] !== undefined; });
      if (S.unit === 'g' && any && !p._all) { return fail('g は全部の段に入れてください（無い段は 0）', 'step'); }
      if (S.sub === 'feces') {
        if (!any && !d.note && !d.mucin) { return fail('数字かコメントを入れてください', 'step'); }
        rec.target = (d.target || '').trim();
        if (!rec.target) { return fail('採取した牛を入れてください', '[data-text="target"]'); }
        rec.data.mucin = d.mucin; rec.data.foam = d.foam; rec.data.corn = d.corn || undefined;
      } else {
        if (!any) { return fail('数字を入れてください', 'step'); }
        rec.target = pspsTarget();
        if (!rec.target) { return fail('粗飼料ロットを選ぶか、名前を入れてください', '[data-sel="lot"]'); }
        // 採取日（はかった日と別。ふつうは同じか前）と給与後の時間
        var sd = (document.getElementById('sdate') || {}).value || date;
        if (sd > date) { return fail('採取日がはかった日より後になっています', '#sdate'); }
        rec.data.sdate = sd;
        rec.data.hours = num(d.hours);
        rec.data.stype = S.stype === 'TMR' ? 'TMR' : '単味粗飼料';
        rec.data.lot = S.stype === '単味' ? (d.lot || undefined) : undefined;
      }
      rec.data.note = d.note || undefined;
    }
    Object.keys(rec.data).forEach(function (k) { if (rec.data[k] === undefined) delete rec.data[k]; });
    Q.keep(rec);
    S.data = S.sub === 'tmr' ? tmrStart(S.grp) : (S.sub === 'psps' ? { grp: d.grp, timing: d.timing } : {});
    if (S.sub === 'tmr') S.data.from = null;
    render();
    window.scrollTo(0, 0);
    toast('残しました。<a href="' + href('record', S.sub) + '">記録</a>にすぐ出ます');
  }

  // ---------- このスマホで入れたもの ----------
  function mine() {
    var s = Q.store(), kind = KIND[S.sub];
    var rows = Object.keys(s).map(function (k) { return s[k]; })
      .filter(function (r) { return r.table === TABLE && r.kind === kind && !r.deleted; })
      .sort(function (a, b) { return b.at - a.at; }).slice(0, 20);
    if (!rows.length) return '';
    return F.box('このスマホで入れたもの', '<ul class="list">' + rows.map(function (r) {
      var d = r.data || {}, what;
      if (S.sub === 'tmr') {
        var sum = (d.items || []).reduce(function (a, it) { return a + (it.per_head_kg || 0); }, 0);
        what = (d.items || []).length + '原料・1頭 ' + r1(sum) + 'kg' + (d.heads ? '・' + d.heads + '頭' : '');
      } else {
        what = STEPS[S.sub].filter(function (st) { return d[st[0]] != null; }).map(function (st) { return d[st[0]]; }).join(' / ') + ' %' +
          (d.mucin ? '・ムチン' + d.mucin : '') + (d.foam ? '・泡' + d.foam : '');
      }
      return '<li><span class="d">' + F.day(r.date) + '</span>　<b>' + F.esc(r.target) + '</b> ' + F.esc(what) +
        (r.sent === false ? ' <span class="small warn">送信待ち</span>' : '') +
        ' <button type="button" class="link danger" data-undo-id="' + r.id + '">取り消す</button></li>';
    }).join('') + '</ul>');
  }

  // ---------- これまで（糞洗い・PSPS） ----------
  // 設定タブ: PSPS・糞洗いの目標の範囲（出典つき）。直せるのは owner だけ
  function settingsPage() {
    return targetBox('psps') + targetBox('feces') +
      F.box('出典', '<p class="small">' + F.esc(TARGET_SRC.psps) + '<br>' + F.esc(TARGET_SRC.feces) +
        '<br>白川の PSPS は 19mm・8mm・1.18mm＋受け皿（2026-11-09 確認）。糞洗いのふるいの目開きは要確認。</p>');
  }

  function gather(rows, key) {
    var by = {}, order = [];
    (rows || []).forEach(function (r) {
      var k = r.date + '|' + r[key];
      if (!by[k]) { by[k] = { key: k, date: r.date, who: r[key], v: {}, g: {}, tag: {}, sm: {}, note: [] }; order.push(k); }
      var x = by[k], m = r.item.match(/^(上段|中段|下段|受け皿)メモ$/);
      if (r.source === '速報') x.quick = true;
      if (m) x.sm[m[1]] = r.note;                                      // この段のメモ（2026-11-09〜）
      else if (/g$/.test(r.item) && r.value != null) x.g[r.item.slice(0, -1)] = +r.value;
      else if (r.item === '給与後の時間' && r.value != null) x.tag[r.item] = +r.value;
      else if (r.value != null) { x.v[r.item] = +r.value; if (r.note && x.note.indexOf(r.note) < 0) x.note.push(r.note); }
      else if (['ムチン', '泡', '試料の種類', 'ロット', '採取日'].indexOf(r.item) >= 0) x.tag[r.item] = r.note;
      else if (r.note && x.note.indexOf(r.note) < 0) x.note.push(r.note);
    });
    return order.map(function (k) { return by[k]; });
  }

  // 目標の外れの向きごとの見直し候補（一般的なもの。判断は獣医師）
  var HINTS = {
    psps: {
      upper: { hi: ['上段（長物）が多い', '切断長が長い・混合が足りない可能性。理論切断長とミキサーの混合時間を見直す。選び食いにも注意。'],
               lo: ['上段（長物）が少ない', '長い繊維が少ない。切断長・乾草の量を見直す。'] },
      middle: { hi: ['中段が多い', '粗い粒子が多め。上段・下段とあわせて切断長と混合を確かめる。'],
                lo: ['中段が少ない', '有効繊維が足りない可能性。粗飼料の切断長と割合を見直す。'] },
      lower: { hi: ['下段が多い', '細かめの粒子が多い。濃厚飼料の割合・加工、混ぜすぎ（細断）を確かめる。'],
               lo: ['下段が少ない', '中くらいの粒子が少ない。濃厚飼料・粗飼料の粒度のバランスを確かめる。'] },
      pan: { hi: ['受け皿（細かい粒子）が多い', '濃厚飼料や細断が多く、発酵が速くなりやすい（SARA に注意）。濃厚飼料の割合・加工・混合時間を見直す。'],
             lo: ['受け皿が少ない', '細かい粒子が少ない。大きな問題になりにくいが、上段とあわせて見る。'] }
    },
    feces: {
      upper: { hi: ['上段（未消化の長い繊維・粒）が多い', '繊維・穀粒が消化しきれていない可能性。切断長、コーンの破砕・加工、通過の速さ（濃厚飼料・水分）を確かめる。'],
               lo: ['上段が少ない', ''] },
      middle: { hi: ['中段が多い', '消化しきれない中くらいの粒子が多い。でんぷん源の加工と選び食いを確かめる。'],
                lo: ['中段が少ない', ''] },
      lower: { hi: ['下段が多い', ''],
               lo: ['下段（よく消化された細かいもの）が少ない', '消化が十分でない可能性。上段・中段の中身（繊維か穀粒か）を見て、粗飼料の質・切断長・コーン加工を確かめる。'] }
    }
  };

  // 2026-11-09 本人「デザイン・配置はこのように」: 段の構成比（100%積み上げ）→ 棒を押すとその回の詳細（段ごとの%・目標から外れた段・見直し候補）。
  // 下に表と目標の範囲
  function groupHistory() {
    var feces = S.sub === 'feces', rows = feces ? S.fecesRows : S.pspsRows;
    if (rows == null) return F.box('これまで', F.none('これまでの記録が読めませんでした。'));
    var all = gather(rows, feces ? 'target' : 'sample');
    if (!all.length) return F.box('これまで', F.none('まだ記録がありません。'));
    var steps = STEPS[S.sub], t = tg(S.sub), html = '', list = all;
    var cmp = [];
    if (!feces) {
      // 2026-11-09 本人「記録は TMR（PMR）のみのグラフで良い」「比べる飼料（ソルガム・GS・DC 単味）を選んで比較」。
      // 昔の PSPS（糞洗い.xlsx・試料名の記録なし）は TMR とみなしてここに入れる（要確認）
      list = all.filter(isMainPsps);
      var names = [];
      all.slice().reverse().forEach(function (x) { if (!isMainPsps(x) && names.indexOf(x.who) < 0) names.push(x.who); });
      if (S.pcmp && names.indexOf(S.pcmp) < 0) S.pcmp = '';
      html += F.box('TMR と比べるもの', names.length ? '<div class="opts">' + [''].concat(names).map(function (nm) {
        return '<button type="button" data-pcmp="' + F.esc(nm) + '"' + ((S.pcmp || '') === nm ? ' class="on"' : '') + '>' + F.esc(nm ? whoLabel(nm) : 'なし') + '</button>';
      }).join('') + '</div>' : '<p class="small muted">単味粗飼料・残飼の記録はまだありません。入力で飼料タイプを「単味粗飼料」にして入れると、ここで TMR と比べられます。</p>');
      if (S.pcmp) cmp = all.filter(function (x) { return x.who === S.pcmp; });
      if (!list.length) return html + F.box('TMR（搾乳）', F.none('TMR の記録がまだありません。')) + (cmp.length ? compareBox(null, cmp) : '');
    }
    // 数字の無い回（メモだけ）は棒にしない
    var withV = list.filter(function (x) { return steps.some(function (st) { return x.v[stepName(st)] != null; }); });
    if (!withV.length) return html + F.box('これまで', F.none('数字の入った記録がまだありません。'));
    var keys = withV.map(function (x) { return x.key; });
    if (keys.indexOf(S.pick) < 0) S.pick = keys[keys.length - 1];
    html += F.box(feces ? '段の構成比（100%積み上げ）' : 'TMR（搾乳）の構成比（100%積み上げ）', '<p class="small muted">棒を押すと、その回の詳細が下に出ます。' + withV.length + '回・' +
      F.day(withV[0].date) + '〜' + F.day(withV[withV.length - 1].date) + '</p>' +
      '<div class="scroll" id="stackwrap">' + stackChart(withV) + '</div>' +
      '<div class="legend">' + steps.map(function (st) { return '<span><i class="sw s-' + st[0] + '"></i>' + F.esc(stepName(st)) + ' ' + F.esc(stepSize(st)) + '</span>'; }).join('') + '</div>');
    var i = keys.indexOf(S.pick);
    html += pickBox(withV[i], i > 0 ? withV[i - 1] : null);
    if (cmp.length) html += compareBox(withV[i], cmp);
    var items = steps.map(stepName), useT = hasTarget(list[0].who);
    var tb = '<div class="scroll"><table class="tbl"><thead><tr><th>はかった日</th>' + items.map(function (it) { return '<th>' + it.slice(0, 2) + '</th>'; }).join('') +
      (feces ? '<th>ムチン</th><th>泡</th>' : '') + '<th>' + (feces ? '採取した牛・コメント' : '試料・コメント') + '</th></tr></thead><tbody>' +
      list.slice().reverse().map(function (x) {
        return '<tr' + (x.key === S.pick ? ' class="picked"' : '') + '><td>' + F.day(x.date) + (x.tag['採取日'] && x.tag['採取日'] !== x.date ? '<br><span class="small muted">採取 ' + F.md(x.tag['採取日']) + '</span>' : '') + '</td>' +
          items.map(function (it, j) {
            var ok = useT ? inRange(x.v[it], t[steps[j][0]]) : null;
            return '<td class="' + (ok === false ? 'out' : '') + '">' + (x.v[it] != null ? F.n(x.v[it], 1) : '—') + (x.g[it] != null ? '<br><span class="small muted">' + F.n(x.g[it], 1) + 'g</span>' : '') + '</td>';
          }).join('') + (feces ? '<td>' + F.esc(x.tag['ムチン'] || '—') + '</td><td>' + F.esc(x.tag['泡'] || '—') + '</td>' : '') +
          '<td class="l small">' + (x.quick ? '<span class="badge quick">速報</span> ' : '') + F.esc(whoLabel(x.who)) + (x.note.length ? '<br><span class="muted">' + F.esc(x.note.join(' / ')) + '</span>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      (list.some(function (x) { return x.quick; }) ? '<p class="small muted"><span class="badge quick">速報</span> は入れたばかりの記録（PC の取り込み前）。翌朝 PC が取り込むと正式な記録になります。</p>' : '');
    html += F.box('これまで（%・' + list.length + '回）', tb + F.src('糞洗い.xlsx のこれまでの分と、白川Farm で入れた分（PC が毎朝取り込んだもの）') +
      '<p class="small muted">目標の範囲は <a href="' + href('settings') + '">設定</a> で見られます。</p>');
    return html;
  }

  function isMainPsps(x) { return x.who === 'TMR（搾乳）・給与時' || x.who === '（試料名の記録なし）'; }
  function whoLabel(w) { return w === '（試料名の記録なし）' ? 'TMR（昔の記録・試料名なし）' : w; }
  // TMR（選んだ回）と、比べるもの（単味・残飼など）の いちばん新しい回 を段ごとに並べ、比べるものの推移も積み上げで出す
  function compareBox(tmr, cmp) {
    var steps = STEPS.psps;
    var cv = cmp.filter(function (x) { return steps.some(function (st) { return x.v[stepName(st)] != null; }); });
    if (!cv.length) return F.box('比べる: ' + whoLabel(S.pcmp), F.none('数字の入った記録がありません。'));
    var c = cv[cv.length - 1];
    var tbl = '<table class="tbl"><thead><tr><th>段</th><th>TMR<br><span class="small">' + (tmr ? F.md(tmr.date) : '—') + '</span></th><th>' +
      F.esc(whoLabel(S.pcmp)) + '<br><span class="small">' + F.md(c.date) + '</span></th><th>差</th></tr></thead><tbody>' + steps.map(function (st) {
        var k = stepName(st), a = tmr ? tmr.v[k] : null, b = c.v[k], d = a != null && b != null ? r1(b - a) : null;
        return '<tr><td class="l"><span class="s-' + st[0] + '">' + F.esc(k) + '</span></td><td>' + n1(a) + '</td><td><b>' + n1(b) + '</b></td><td>' + (d == null ? '—' : (d > 0 ? '+' : '') + d) + '</td></tr>';
      }).join('') + '</tbody></table>';
    var pv = {}, tv = {};
    steps.forEach(function (st) { pv[st[0]] = c.v[stepName(st)]; if (tmr) tv[st[0]] = tmr.v[stepName(st)]; });
    return F.box('比べる: ' + whoLabel(S.pcmp), (tmr ? hbar(tv, 'TMR') : '') + hbar(pv, F.md(c.date)) + tbl +
      (cv.length > 1 ? '<p class="small muted" style="margin-top:10px">' + F.esc(whoLabel(S.pcmp)) + ' の推移（' + cv.length + '回）</p><div class="scroll">' + stackChart(cv, true) + '</div>' : '') +
      '<p class="small muted">差は「比べるもの − TMR」。単味粗飼料には目標を当てていません。</p>');
  }

  // 100%積み上げの棒。1本＝1回。押した回を枠で囲み、ほかは薄くする
  function stackChart(list, still) {
    // 棒は横いっぱいに並べる（少ない回は太く、多い回は横に送れる）。日付は重ならない間隔で
    var steps = STEPS[S.sub], n = list.length, L = 26, R = 6, T = 8, B = 22, H = 210;
    var W = Math.max(320, L + R + n * 16), slot = (W - L - R) / n, bw = Math.min(30, slot * 0.68), gap = slot - bw;
    var every = Math.max(1, Math.ceil(34 / slot));
    var Y = function (v) { return T + (1 - v / 100) * (H - T - B); };
    var g = [0, 25, 50, 75, 100].map(function (v) {
      return '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" class="grid"/>' +
        '<text x="' + (L - 4) + '" y="' + (Y(v) + 3).toFixed(1) + '" text-anchor="end">' + v + '</text>';
    }).join('');
    list.forEach(function (x, i) {
      var x0 = L + gap / 2 + i * (bw + gap), tot = 0, acc = 0, on = x.key === S.pick;
      steps.forEach(function (st) { tot += x.v[stepName(st)] || 0; });
      if (!tot) return;
      // 下から 受け皿（下段）→ 上段 の順に積む（ふるいの重なりと同じ並び）
      steps.slice().reverse().forEach(function (st) {
        var v = (x.v[stepName(st)] || 0) / tot * 100;
        g += '<rect x="' + x0 + '" y="' + Y(acc + v).toFixed(1) + '" width="' + bw + '" height="' + Math.max(0, Y(acc) - Y(acc + v)).toFixed(1) +
          '" class="sb s-' + st[0] + (still || on ? '' : ' dim') + '"' + (still ? '' : ' data-pick="' + F.esc(x.key) + '"') + '/>';
        acc += v;
      });
      if (on && !still) g += '<rect x="' + (x0 - 1.5) + '" y="' + (Y(100) - 1.5) + '" width="' + (bw + 3) + '" height="' + (Y(0) - Y(100) + 3) + '" class="pickbox"/>';
      if (i % every === (n - 1) % every) g += '<text x="' + (x0 + bw / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + F.md(x.date) + '</text>';
    });
    return '<svg class="herd stack" viewBox="0 0 ' + W + ' ' + H + '" style="min-width:' + (W > 360 ? W : 0) + 'px" role="img" aria-label="段の構成比">' + g + '</svg>';
  }

  // 押した回の詳細: 段ごとの%（前回とくらべた差）・目標から外れた段・見直し候補
  function pickBox(x, prev) {
    var steps = STEPS[S.sub], t = tg(S.sub), useT = hasTarget(x.who), outs = [];
    var meta = (x.quick ? ['速報（PC の取り込み前）'] : []).concat(['はかった日 ' + F.day(x.date)]);
    if (x.tag['採取日'] && x.tag['採取日'] !== x.date) meta.push('採取日 ' + F.day(x.tag['採取日']));
    meta.push(whoLabel(x.who));
    if (x.tag['給与後の時間'] != null) meta.push('給与後 ' + x.tag['給与後の時間'] + '時間');
    if (x.tag['ムチン']) meta.push('ムチン ' + x.tag['ムチン']);
    if (x.tag['泡']) meta.push('泡 ' + x.tag['泡']);
    var cards = '<div class="pcards c' + steps.length + '">' + steps.map(function (st) {
      var k = stepName(st), v = x.v[k], ok = useT ? inRange(v, t[st[0]]) : null, b = prev ? prev.v[k] : null;
      if (ok === false) outs.push({ st: st, v: v, dir: t[st[0]][1] != null && v > t[st[0]][1] ? 'hi' : 'lo' });
      var d = v != null && b != null ? r1(v - b) : null;
      return '<div class="pcard"><div class="pn s-' + st[0] + 't">' + F.esc(k) + '</div>' +
        '<div class="pv' + (ok === false ? ' outv' : '') + '">' + n1(v) + '<small>%</small></div>' +
        (d != null ? '<div class="pd">前回 ' + n1(b) + '（' + (d > 0 ? '+' : '') + d + '）</div>' : '') +
        (x.sm[k] ? '<div class="pm">' + F.esc(x.sm[k]) + '</div>' : '') + '</div>';
    }).join('') + '</div>';
    var dev = '';
    if (useT) {
      dev = '<div class="dev"><span class="badge ' + (outs.length ? 'warnb' : 'okb') + '">' + (outs.length ? '要観察' : '目標内') + '</span> <b>構成比（目標帯からの外れ）</b>' +
        (outs.length ? '<ul class="list">' + outs.map(function (o) {
          var r = t[o.st[0]];
          return '<li>' + F.esc(stepName(o.st)) + 'が ' + n1(o.v) + '% で目標帯（' + rangeText(r) + '）を' + (o.dir === 'hi' ? '上回る' : '下回る') + '</li>';
        }).join('') + '</ul>' : '<p class="small muted">どの段も目標の中です。</p>') + '</div>';
      var hints = outs.map(function (o) { return (HINTS[S.sub][o.st[0]] || {})[o.dir]; }).filter(function (h) { return h && h[1]; });
      if (hints.length) dev += '<div class="hints"><p class="hh">見直しの候補</p>' + hints.map(function (h) {
        return '<div class="hint"><b>' + F.esc(h[0]) + '</b><br>' + F.esc(h[1]) + '</div>';
      }).join('') + '<p class="small muted">一般的な見直し候補です。原因の判断は獣医師が行います。</p></div>';
    } else dev = '<p class="small muted">単味粗飼料には目標を当てていません。</p>';
    return F.box('選んだ記録', '<p class="small muted">' + meta.map(F.esc).join('・') + '</p>' + cards + dev +
      (x.note.length ? '<p class="small"><b>メモ</b> ' + F.esc(x.note.join(' / ')) + '</p>' : ''));
  }

  // ---------- 反芻の箱ひげ（2026-11-09） ----------
  // 3日ずつ区切り、各牛の3日平均を1点。初産（産次1）と経産（産次2以上）を並べる。PC が毎朝 rumen_book.py で作る
  function quart(a, p) {          // 並べた値の p 分位（線形補間・Excel の QUARTILE.INC と同じ）
    var i = (a.length - 1) * p, lo = Math.floor(i);
    return lo + 1 < a.length ? a[lo] + (a[lo + 1] - a[lo]) * (i - lo) : a[lo];
  }
  function boxStat(a) {
    if (!a.length) return null;
    var q1 = quart(a, 0.25), md = quart(a, 0.5), q3 = quart(a, 0.75), iqr = q3 - q1;
    var inside = a.filter(function (v) { return v >= q1 - 1.5 * iqr && v <= q3 + 1.5 * iqr; });
    return { n: a.length, q1: q1, md: md, q3: q3, lo: inside[0], hi: inside[inside.length - 1],
             out: a.filter(function (v) { return v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr; }) };
  }
  function rumenPage() {
    if (!RUM || RUM.err) return F.box('反芻', F.none('反芻のデータが読めませんでした。電波を確かめて開き直してください。'));
    if (!RUM.blocks || !RUM.blocks.length) return F.box('反芻', F.none('まだ反芻のデータがありません（PC の朝の取り込みで入ります）。'));
    var bl = RUM.blocks.slice(-(S.rdays / (RUM.block || 3)));
    var st = bl.map(function (b) { return { b: b, f: boxStat(b.first), m: boxStat(b.multi) }; });
    var html = F.box('反芻時間（分/日）の箱ひげ・3日ごと', '<div class="opts">' + [30, 60, 90].map(function (d) {
      return '<button type="button" data-rdays="' + d + '"' + (S.rdays === d ? ' class="on"' : '') + '>直近' + d + '日</button>';
    }).join('') + '</div>' + '<div class="legend"><span><i style="background:var(--spark2)"></i>初産（産次1）</span><span><i style="background:var(--spark)"></i>経産（産次2以上）</span></div>' +
      '<div class="scroll">' + boxChart(st) + '</div>' +
      '<p class="small muted">箱は真ん中の半分（25〜75%）、中の線は中央値、ひげは箱の長さの1.5倍まで、点はそれより外の牛。1つの点（値）は1頭の3日平均です。' +
      '点線の400分は、ロボットの点検で「反芻が短い」とする線（この牧場の下から1割）。</p>');
    html += F.box('3日ごとの数字', '<div class="scroll"><table class="tbl"><thead><tr><th>期間</th><th>日数</th><th>初産<br><span class="small">頭・中央値</span></th><th>経産<br><span class="small">頭・中央値</span></th></tr></thead><tbody>' +
      st.slice().reverse().map(function (x) {
        var c = function (s) { return s ? s.n + '頭・<b>' + Math.round(s.md) + '</b><br><span class="small muted">' + Math.round(s.q1) + '〜' + Math.round(s.q3) + '</span>' : '—'; };
        return '<tr><td>' + F.md(x.b.start) + '〜' + F.md(x.b.end) + '</td><td class="' + (x.b.days < 3 ? 'out' : '') + '">' + x.b.days + '日分</td><td>' + c(x.f) + '</td><td>' + c(x.m) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="small muted">下の小さい数字は箱の範囲（25〜75%）。日数が3未満の区切りは、LELY を落とせなかった日があります（あった日だけで平均）。</p>' +
      F.src('LELY（ロボット）の反芻時間。' + F.esc(RUM.rule || '') + '。PC が毎朝計算（' + F.day(RUM.last) + ' まで）'));
    return html;
  }
  function boxChart(st) {
    var n = st.length, slot = 30, L = 34, R = 6, T = 8, B = 30, W = Math.max(320, L + R + n * slot), H = 220;
    var vals = [400];
    st.forEach(function (x) { [x.f, x.m].forEach(function (s) { if (s) vals = vals.concat([s.lo, s.hi], s.out); }); });
    var lo = Math.floor(Math.min.apply(null, vals) / 50) * 50, hi = Math.ceil(Math.max.apply(null, vals) / 50) * 50;
    if (hi === lo) hi = lo + 50;
    var Y = function (v) { return T + (1 - (v - lo) / (hi - lo)) * (H - T - B); };
    var g = '', step = hi - lo > 300 ? 100 : 50;
    for (var v = lo; v <= hi; v += step) {
      g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" class="grid"/>' +
        '<text x="' + (L - 4) + '" y="' + (Y(v) + 3).toFixed(1) + '" text-anchor="end">' + v + '</text>';
    }
    g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(400).toFixed(1) + '" y2="' + Y(400).toFixed(1) + '" class="ref"/>';
    var every = n > 20 ? 3 : n > 10 ? 2 : 1;
    st.forEach(function (x, i) {
      var cx = L + i * slot + slot / 2;
      [[x.f, -6, 'var(--spark2)'], [x.m, 6, 'var(--spark)']].forEach(function (a) {
        var s = a[0], c = cx + a[1], w = 4.5;
        if (!s) return;
        g += '<line x1="' + c + '" x2="' + c + '" y1="' + Y(s.hi).toFixed(1) + '" y2="' + Y(s.lo).toFixed(1) + '" stroke="' + a[2] + '" stroke-width="1.2"/>' +
          '<rect x="' + (c - w) + '" y="' + Y(s.q3).toFixed(1) + '" width="' + (2 * w) + '" height="' + Math.max(1, Y(s.q1) - Y(s.q3)).toFixed(1) +
          '" fill="' + a[2] + '" fill-opacity=".35" stroke="' + a[2] + '"/>' +
          '<line x1="' + (c - w) + '" x2="' + (c + w) + '" y1="' + Y(s.md).toFixed(1) + '" y2="' + Y(s.md).toFixed(1) + '" stroke="' + a[2] + '" stroke-width="2.2"/>' +
          s.out.map(function (o) { return '<circle cx="' + c + '" cy="' + Y(o).toFixed(1) + '" r="1.8" fill="' + a[2] + '"/>'; }).join('');
      });
      if (i % every === (n - 1) % every) g += '<text x="' + cx + '" y="' + (H - B + 13) + '" text-anchor="middle">' + F.md(x.b.end) + '</text>';
      if (x.b.days < 3) g += '<text x="' + cx + '" y="' + (H - B + 25) + '" text-anchor="middle" class="cap">' + x.b.days + '日</text>';
    });
    return '<svg class="herd boxplot" viewBox="0 0 ' + W + ' ' + H + '" style="min-width:' + (W > 360 ? W : 0) + 'px" role="img" aria-label="反芻時間の箱ひげ図">' + g + '</svg>';
  }

  // ---------- 総合分析 ----------
  // 糞洗い・PSPS をはかった日ごとに、そのときの TMR（その日以前のいちばん新しい記録）と、
  // そのときの粗飼料の分析（その日以前のいちばん新しい分析）を並べる。同じ日の分析ではないので「推定」と書く
  function tmrAt(grp, date) {
    var rows = (S.tmrRows || []).filter(function (r) { return r.grp === grp && r.date <= date; });
    if (!rows.length) return null;
    var last = rows[rows.length - 1].date;
    return { date: last, rows: rows.filter(function (r) { return r.date === last; }) };
  }
  function analysisLine(s, why) {
    return '<li><b>' + F.esc(lotById(s.lot) ? lotById(s.lot).name : s.name) + '</b> <span class="small muted">' + F.day(s.date) + ' の分析・' + F.esc(why) + '</span><br>' +
      SHOW4.concat(['でんぷん']).filter(function (c) { return s.v[c] != null; }).map(function (c) { return F.esc(c) + ' ' + fmt(s.v[c]); }).join('・') + '</li>';
  }
  function summaryPage() {
    var fe = gather(S.fecesRows, 'target'), ps = gather(S.pspsRows, 'sample');
    var dates = [];
    fe.concat(ps).forEach(function (x) { if (dates.indexOf(x.date) < 0) dates.push(x.date); });
    dates.sort().reverse();
    var html = '';
    var chart = F.trend([['上段', 'var(--spark2)'], ['下段', 'var(--warn)']].map(function (it) {
      return { name: '糞洗い ' + it[0], color: it[1], pts: fe.filter(function (x) { return x.v[it[0]] != null; }).map(function (x) { return { d: x.date, v: x.v[it[0]] }; }) };
    }), '%', function (d) { return d.slice(2, 4) + '/' + (+d.slice(5, 7)); });
    html += F.box('総合分析', '<p class="small muted">糞洗い・PSPS をはかった日ごとに、そのときの TMR と粗飼料の分析を並べます。' +
      'TMR はその日以前のいちばん新しい記録、粗飼料はその日以前のいちばん新しい分析です（同じ日の分析ではないので推定）。乳検はまだ入れていません。</p>' + (chart || ''));
    if (!dates.length) return html + F.box('はかった日', F.none('まだ糞洗い・PSPS の記録がありません。'));
    var kinds = {};
    (P.kinds || []).forEach(function (k) { kinds[k.id] = k.label; });
    html += dates.slice(0, 24).map(function (date) {
      var inner = '';
      fe.filter(function (x) { return x.date === date; }).forEach(function (x) {
        inner += '<p><b>糞洗い</b> ' + F.esc(x.who) + '<br>上段 ' + n1(x.v['上段']) + '・中段 ' + n1(x.v['中段']) + '・下段 ' + n1(x.v['下段']) + ' %' +
          (x.tag['ムチン'] ? '・ムチン ' + F.esc(x.tag['ムチン']) : '') + (x.tag['泡'] ? '・泡 ' + F.esc(x.tag['泡']) : '') +
          (x.note.length ? '<br><span class="small muted">' + F.esc(x.note.join(' / ')) + '</span>' : '') + '</p>';
      });
      ps.filter(function (x) { return x.date === date; }).forEach(function (x) {
        inner += '<p><b>PSPS</b> ' + F.esc(x.who) + '<br>上段 ' + n1(x.v['上段']) + '・中段 ' + n1(x.v['中段']) + '・下段 ' + n1(x.v['下段']) + '・受け皿 ' + n1(x.v['受け皿']) + ' %</p>';
      });
      var lots = {};
      GROUPS.forEach(function (g) {
        var t = tmrAt(g, date);
        if (!t) return;
        var sum = t.rows.reduce(function (a, r) { return a + (r.per_head_kg == null ? 0 : +r.per_head_kg); }, 0);
        inner += '<p><b>TMR（' + g + '）</b> <span class="small muted">' + F.day(t.date) + ' の記録' + (t.rows[0].heads ? '・' + t.rows[0].heads + '頭' : '') + '</span><br>' +
          t.rows.map(function (r) { if (r.lot) lots[r.lot] = 'TMR の記録から'; return F.esc(r.ingredient) + ' ' + F.n(r.per_head_kg, 1); }).join('・') +
          '<br>1頭あたり 合計 ' + r1(sum) + ' kg（現物）</p>';
      });
      ps.filter(function (x) { return x.date === date && x.tag['ロット']; }).forEach(function (x) { lots[x.tag['ロット']] = 'PSPS の試料'; });
      var lines = Object.keys(lots).map(function (id) { var s = lastSample(id, date); return s ? analysisLine(s, lots[id]) : ''; }).filter(Boolean);
      if (!lines.length) {
        // TMR の記録が無い日は、粗飼料の種類ごとにその日以前の直近の分析を出す（実際に給与していたかは要確認）
        ['DC', 'グラス'].forEach(function (k) {
          var hit = null;
          (P.samples || []).forEach(function (s) { if (s.kind === k && s.date <= date) hit = s; });
          if (hit) lines.push(analysisLine(hit, kinds[k] + 'の直近・給与していたかは要確認'));
        });
      }
      inner += lines.length ? '<p><b>粗飼料の分析（推定）</b></p><ul class="list">' + lines.join('') + '</ul>' : '<p class="small muted">この日以前の粗飼料の分析がありません。</p>';
      return F.box(F.day(date), inner);
    }).join('');
    return html + F.src('糞洗い.xlsx・白川Farm で入れた分・全酪連の飼料分析');
  }
  function n1(v) { return v == null ? '—' : F.n(v, 1); }

  window.FeedPage = {
    show: show,
    sent: function () { var el = document.getElementById('rmine'); if (el && F && F.tabOf() === 'feed') el.innerHTML = mine(); }
  };
})();
