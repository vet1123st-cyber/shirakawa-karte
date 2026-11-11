// 白川Farm「繁殖」— 検診リスト・妊娠鑑定／繁殖検診の所見・発情／処置・ET の一覧。
//
// 所見の入れ方は、前の検診アプリ（webapp_kenshin）をそのまま移したもの。送り先だけが GAS から箱（input_repro）に変わった。
//   * 打った瞬間に**スマホの中に**書く（localStorage）。送るのはそのあと。牛舎は電波が切れる。送れなくても入力は消えない
//   * 押しても画面が飛ばない。押した欄のボタンの色だけ塗り替え、出し入れが要るとき（watch している欄が動いたとき）だけ組み直す
//   * ハンドラは入れ物に onclick で1本だけ（addEventListener だと描き直すたびに増え、1回が2回になる）
//   * 卵巣は左右それぞれ1語（Cl / F / Cl+F …）。現場のメモ「LCl RF」の形のまま押せる
// 箱の決まり: 書けるのは牧場の人だけ・直せるのは自分が入れた行だけ・消せない（取り消しは deleted の印）。
// 1件は「牛×日×種類」で1つ。id はスマホが作るので、送り直しても二重にならない。
// PC が毎朝 import_box.py で farm.db に入れる（所見は repro_exam、発情・処置は repro_event）。
// app.js より先に読み込まれる。window.Farm（app.js の道具）は画面を出すときに初めて触る。

(function () {
  'use strict';

  var F = null;                       // app.js の道具（show で受け取る）
  var STORE = 'farm.inputs.v1';       // まだ送れていない／送った入力の控え

  // ---------- 入れるもの（検診アプリと同じ。項目の名前は farm.db の repro_exam の列と同じ） ----------
  // 卵巣は片側に黄体・卵胞が2個以上あることがある（2026-11-11 本人）。1個ずつ足して、それぞれ mm を入れる。
  // 箱には「CL15・F12・F10」の1つの文字で入れる（本人のメモ「LCl RF」と同じ並び。farm.db の列は ov_left / ov_right のまま）
  var OVT = ['CL', 'F', 'F嚢腫', 'CL嚢腫', '静止'];
  // よく使う大きさ（2026-11-11 本人）: F は 5〜15mm、CL は 18〜28mm をボタンで。ほかは 5〜30 の残りを選ぶ。
  // 嚢腫（F嚢腫・CL嚢腫）は大きさを書かない
  function mmMain(t) {
    var lo = t === 'CL' ? 18 : 5, hi = t === 'CL' ? 28 : 15, a = [];
    for (var n = lo; n <= hi; n++) a.push(n);
    return a;
  }
  function mmRest(t) {
    var main = mmMain(t), a = [];
    for (var n = 5; n <= 30; n++) if (main.indexOf(n) < 0) a.push(n);
    return a;
  }
  function noSize(t) { return /嚢腫/.test(t); }
  function parseOv(v) {
    return String(v || '').split('・').filter(Boolean).map(function (x) {
      var m = /^(CL嚢腫|F嚢腫|CL|F|静止)(\d+)?$/.exec(x);
      return m ? { t: m[1], mm: m[2] ? Number(m[2]) : null } : { t: x, mm: null };   // 前の書き方（Cl+F など）はそのまま残す
    });
  }
  function fmtOv(a) { return a.map(function (x) { return x.t + (x.mm || ''); }).join('・') || undefined; }
  function inList(v, x) { return [].concat(v || []).indexOf(x) >= 0; }
  // 処置（2026-11-11 本人。妊鑑・検診で同じ）。SS は「当日」か「何日後に始めるか」を1つだけ選ぶ（3dS = 3日後 SS）
  var SSG = ['SS', '1dS', '2dS', '3dS', '4dS', '5dS'];
  var TREAT_F = { k: 'treatment', label: '処置', multi: true, big: true, group: SSG,
                  opts: SSG.concat(['シダー', '短縮SS', '蓄膿PG×2', '様子見', '薬注', '発情', '出血', '除外']) };
  var DRUG_F = { k: 'drug', label: '　薬の名前', text: true, watch: 'treatment',
                 when: function (r) { return inList(r.treatment, '薬注'); } };

  // BCS・ルーメンフィルは毎回押せる位置に出す（2026-11-10 本人「BCS、ルーメンフィルスコアもみたい」→ 前回の値も上に出す）
  var BCS_F = { k: 'bcs', label: 'BCS', num: true, opts: ['2.50', '2.75', '3.00', '3.25', '3.50', '3.75', '4.00', '4.25'] };
  var RF_F = { k: 'rumen_fill', label: 'ルーメンフィルスコア', opts: ['1', '2', '3', '4', '5'], num: true };
  var PREG = [
    { k: 'preg_check', label: '妊娠鑑定', big: true, opts: ['＋', '−', '再妊鑑', '流産・胚死滅'] },
    { k: 'twin', label: '双子', opts: ['単胎', '双胎(同側)', '双胎(両側)'],
      watch: 'preg_check', when: function (r) { return r.preg_check === '＋'; } },
    { k: 'sire_embryo', label: '種雄牛・受精卵（ちがうときだけ）', text: true, placeholder: 'last_semen' },
    // 妊鑑がマイナスなら、その場で卵巣を診て処置を決める（2026-11-11 本人）
    { k: 'ov_right', label: '卵巣 右', ov: true, big: true, watch: 'preg_check', when: function (r) { return r.preg_check === '−'; } },
    { k: 'ov_left', label: '卵巣 左', ov: true, big: true, watch: 'preg_check', when: function (r) { return r.preg_check === '−'; } },
    TREAT_F, DRUG_F,
    BCS_F, RF_F,
    { k: 'note', label: 'メモ', text: true, long: true }
  ];
  var EXAM = [
    { k: 'ov_right', label: '卵巣 右', ov: true, big: true },
    { k: 'ov_left', label: '卵巣 左', ov: true, big: true },
    { k: 'uterus', label: '子宮所見', big: true, opts: ['正常', '貯留少', '貯留多い', '蓄膿'] },
    { k: 'm_score', label: 'Mスコア（粘液）', opts: ['0', '1', '2', '3'], num: true },
    TREAT_F, DRUG_F,
    BCS_F, RF_F,
    { k: 'note', label: 'メモ', text: true, long: true }
  ];
  // 毎回は入れないもの。全部並べると1頭の巻き取りが長くなって、40頭が終わらないため
  var MORE = [
    { k: 'locomotion', label: '跛行スコア', opts: ['1', '2', '3', '4', '5'], num: true },
    { k: 'bhb', label: 'BHB', number: true, step: '0.1' },
    { k: 'temp_c', label: '直腸温', number: true, step: '0.1' }
  ];
  // 発情・処置（検診の日以外のこと）
  var EVENT = {
    '発情': [{ k: 'detail', label: '見たこと', multi: true, big: true,
               opts: ['スタンディング', 'マウンティング', '粘液', '活動量（レリー）', '出血', 'その他'] },
             { k: 'note', label: 'メモ', text: true, long: true }],
    '処置': [{ k: 'detail', label: '処置', multi: true, big: true,
               opts: ['PG', 'シダー挿入', 'シダー抜去', 'E2', 'GnRH', 'hCG', '洗浄', '薬注', 'その他'] },
             { k: 'drug', label: '薬の名前', text: true },
             { k: 'note', label: 'メモ', text: true, long: true }]
  };
  var MODES = { '妊鑑': ['妊娠鑑定', PREG], '検診': ['繁殖検診', EXAM] };

  // ---------- 持ちもの ----------
  var S = {
    sub: 'list', list: [], listDate: '', server: [], farm: '', tab: '妊鑑',
    open: null, mode: '', more: false, ev: null, err: '', edit: false
  };
  function fieldsOf() { return S.ev ? EVENT[S.ev.kind] : MODES[S.mode][1].concat(S.more ? MORE : []); }
  // いま出している欄から先に探す（発情と処置は同じ名前 detail で中身がちがう。全部から探すと発情のほうを掴んだ）
  function fieldByKey(k) {
    var all = fieldsOf().concat(PREG, EXAM, MORE);
    for (var i = 0; i < all.length; i++) if (all[i].k === k) return all[i];
    return null;
  }

  // 日付は「このスマホの時計の日」。toISOString() は世界標準時なので、朝9時より前だと前の日になる（実際に踏んだ）
  function localDate(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function workDate() {
    try { return sessionStorage.getItem('repro.date') || localDate(); } catch (e) { return localDate(); }
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }

  // ---------- 控え（スマホの中） ----------
  function store(v) {
    try {
      if (v === undefined) return JSON.parse(localStorage.getItem(STORE) || '{}');
      localStorage.setItem(STORE, JSON.stringify(v));
    } catch (e) { return {}; }
  }
  function unsent() {
    var s = store();
    return Object.keys(s).map(function (k) { return s[k]; }).filter(function (r) { return !r.sent; });
  }
  // 牛×日×種類 の1件を探す。自分が入れた行（控え・箱）なら同じ id を使う。ほかの人の行は直せないので、自分の行を新しく作る
  function recFor(cow, date, kind) {
    var s = store(), me = F.me();
    var mine = Object.keys(s).map(function (k) { return s[k]; })
      .filter(function (r) { return r.cow_id === cow && r.date === date && r.kind === kind && !r.deleted; })[0];
    if (mine) return mine;
    var srv = S.server.filter(function (r) {
      return r.cow_id === cow && r.date === date && r.kind === kind && !r.deleted && r.entered_name === me;
    })[0];
    if (srv) return { id: srv.id, cow_id: cow, date: date, kind: kind, data: srv.data || {}, sent: true };
    return { id: uuid(), cow_id: cow, date: date, kind: kind, data: {}, sent: true, fresh: true };
  }
  function others(cow, date, kind) {
    var me = F.me();
    return S.server.filter(function (r) {
      return r.cow_id === cow && r.date === date && r.kind === kind && !r.deleted && r.entered_name !== me;
    });
  }
  function keep(r) {
    var s = store();
    r.sent = false;
    r.at = Date.now();
    delete r.fresh;
    s[r.id] = r;
    // 送り終わって14日たった控えは消す（スマホの置き場を食いつぶさない）
    var old = Date.now() - 14 * 86400000;
    Object.keys(s).forEach(function (k) { if (s[k].sent && s[k].at < old) delete s[k]; });
    store(s);
    later();
  }

  // ---------- 送る ----------
  var timer = null, sending = false;
  function later() { clearTimeout(timer); timer = setTimeout(send, 1200); }
  function send() {
    var rows = unsent();
    if (!rows.length || sending) { bar(); return Promise.resolve(); }
    sending = true;
    return farmId().then(function (farm) {
      var stamp = {}, by = {};
      // 表ごとにまとめて送る（繁殖は input_repro、記録は input_record。記録は牛の代わりに target を持つことがある）
      rows.forEach(function (r) {
        stamp[r.id] = r.at;
        var t = r.table || 'input_repro', row = { id: r.id, farm_id: farm, cow_id: r.cow_id || null, date: r.date, kind: r.kind,
                                                 data: r.data || {}, deleted: !!r.deleted };
        if (t === 'input_record') row.target = r.target || null;
        (by[t] = by[t] || []).push(row);
      });
      return Promise.all(Object.keys(by).map(function (t) { return F.upsert(t, by[t]); })).then(function () {
        var s = store();
        Object.keys(stamp).forEach(function (id) { if (s[id] && s[id].at === stamp[id]) s[id].sent = true; });
        store(s);
        S.err = '';
        var el = document.getElementById('rrecent');        // 「送信待ち」の字を消す
        if (el) el.innerHTML = recentEvents();
        if (window.RecordPage) window.RecordPage.sent();
        if (window.FeedPage) window.FeedPage.sent();
      });
    }).catch(function (err) {
      S.err = err.status === 404 ? '箱にまだ入力の表がありません（佐藤さんが箱の表を流すと送れます）'
        : (err.status === 401 || err.status === 403 ? '送れませんでした（' + err.message + '）' : '電波が戻ったら送ります');
    }).then(function () { sending = false; bar(); });
  }
  window.addEventListener('online', function () { if (F) send(); });

  function farmId() {
    if (S.farm) return Promise.resolve(S.farm);
    // 餌屋さん（role='feed'）は my_farms に入らないので、餌屋さんも含む my_feed_farms から引く（2026-11-09）。
    // まだ関数が無い古い箱なら my_farms
    return F.get('rpc/my_feed_farms').catch(function (e) {
      if (e.status === 404) return F.get('rpc/my_farms');
      throw e;
    }).then(function (r) {
      var v = Array.isArray(r) ? r[0] : r;
      S.farm = (v && typeof v === 'object') ? (v.my_feed_farms || v.my_farms || Object.keys(v).map(function (k) { return v[k]; })[0]) : v;
      if (!S.farm) throw new Error('牧場に入っていません');
      return S.farm;
    });
  }

  function bar() {
    var b = document.getElementById('rbar');
    if (!b) return;
    var n = unsent().length;
    b.className = 'rbar' + (n ? ' wait' : '');
    b.textContent = n ? 'まだ送れていない入力 ' + n + ' 件。' + (S.err || '送っています…') : '入力はぜんぶ送れています';
  }

  // ---------- 画面の入口 ----------
  function show(hash) {
    F = window.Farm;
    var m = hash.match(/^#\/repro\/cow\/(\d{10})/);
    // 一覧からタップした牛は、タップしたタブ（妊鑑／検診）の入力をすぐ出す（前の牛の種類を引きずらない。2026-11-11 本人）
    if (m) { if (S.open !== m[1]) { S.mode = ''; S.more = false; } S.open = m[1]; S.ev = null; return loadAll().then(renderCow); }
    if (/^#\/repro\/report/.test(hash)) { S.ev = null; return loadAll().then(renderReport); }
    if (/^#\/repro\/event/.test(hash)) { S.ev = S.ev || { kind: '処置', cow: null }; return loadAll().then(renderEvent); }
    S.ev = null;
    if (/^#\/repro\/et/.test(hash)) return renderEt();
    return loadAll().then(renderList);
  }

  function loadAll() {
    var a = F.get('exam_list?select=*&order=list_date.desc,mgmt_no.asc').then(function (r) {
      S.listDate = r.length ? r[0].list_date : '';
      S.list = r.filter(function (x) { return x.list_date === S.listDate; });
    }).catch(function () { S.list = S.list || []; });
    var since = localDate(new Date(Date.now() - 30 * 86400000));
    var b = F.get('input_repro?select=*&date=gte.' + since + '&order=updated_at.asc').then(function (r) { S.server = r || []; })
      .catch(function (err) { S.err = err.status === 404 ? '箱にまだ入力の表がありません（佐藤さんが箱の表を流すと送れます）' : ''; });
    send();
    return Promise.all([a, b]);
  }

  function head(active) {
    var subs = [['list', '検診リスト', '#/repro'], ['event', '発情・処置', '#/repro/event'], ['et', 'ET', '#/repro/et']];
    return '<div class="seg">' + subs.map(function (s) {
      return '<a class="segbtn' + (s[0] === active ? ' on' : '') + '" href="' + s[2] + '">' + s[1] + '</a>';
    }).join('') + '</div><div id="rbar" class="rbar"></div>';
  }

  // ---------- 検診リスト ----------
  function isPreg(c) { return String(c.reason || '').indexOf('妊鑑') >= 0; }
  function inTab(c, tab) { return byTab(tab).some(function (x) { return x.cow_id === c.cow_id; }); }
  function inputsOf(cow) {
    var s = store(), d = S.listDate || workDate();
    var mine = Object.keys(s).map(function (k) { return s[k]; })
      .filter(function (r) { return r.cow_id === cow && r.date >= d && !r.deleted && (r.kind === '妊娠鑑定' || r.kind === '繁殖検診'); });
    var ids = mine.map(function (r) { return r.id; });
    return mine.concat(S.server.filter(function (r) {
      return r.cow_id === cow && r.date >= d && !r.deleted && ids.indexOf(r.id) < 0 && (r.kind === '妊娠鑑定' || r.kind === '繁殖検診');
    }));
  }
  function summary(r) {
    r = r || {};
    var bits = [];
    if (r.preg_check) bits.push('妊鑑' + r.preg_check);
    // いまの書き方（CL15・F12）は大きさが入っているので、そのまま出す。前の書き方（Cl+F と別の欄の大きさ）も読めるように残す
    var side = function (s, ov, cl, fol) {
      if (!ov) return '';
      return /^(CL|F|静止)/.test(ov) ? s + ov : s + ov + (cl ? '(' + cl + ')' : '') + (fol ? '(' + fol + 'mm)' : '');
    };
    var ov = [side('L', r.ov_left, r.cl_left, r.fol_left), side('R', r.ov_right, r.cl_right, r.fol_right)].filter(Boolean).join(' ');
    if (ov) bits.push(ov);
    if (r.uterus && r.uterus !== '正常') bits.push(r.uterus);
    if (r.treatment && [].concat(r.treatment).length) bits.push([].concat(r.treatment).join('・'));
    if (r.plan) bits.push(r.plan + (r.plan_days ? '(' + r.plan_days + '日後)' : ''));
    return bits.join(' / ') || '入力あり';
  }
  // ---------- リストを直す（2026-11-10 本人「PC で作り、アプリで直す」） ----------
  // 1頭×リストの日 で input_repro の kind「リスト」1行。data = { added, removed, tab, pos }。
  // 3人が直すので、牛ごとに**いちばん新しく直した行**が勝つ（直せるのは自分の行だけ＝箱の決まり。ほかの人の直しは自分の新しい行で上書きされる）。
  // リストの日が変わる（PC で作り直す）と、直しは前のリストに残ったままになる。PC の import_box はこの種類を所見として読まない。
  function editRows() {
    var s = store(), d = S.listDate;
    var mine = Object.keys(s).map(function (k) { return s[k]; }).filter(function (r) { return r.kind === 'リスト' && r.date === d; });
    var ids = mine.map(function (r) { return r.id; });
    return mine.concat(S.server.filter(function (r) { return r.kind === 'リスト' && r.date === d && ids.indexOf(r.id) < 0; }));
  }
  function edits() {
    var by = {};
    editRows().forEach(function (r) {
      if (r.deleted) return;
      var t = r.at || Date.parse(r.updated_at) || 0;
      if (!by[r.cow_id] || by[r.cow_id].t < t) by[r.cow_id] = { t: t, d: r.data || {} };
    });
    return by;
  }
  // PC が作ったリスト ＋ アプリでの直し。pos は並び（PC の並びを 1000 おきに置き、動かした牛だけ間に入れる）
  function listNow() {
    var ed = edits(), out = [], seen = {};
    S.list.forEach(function (c, i) {
      seen[c.cow_id] = 1;
      var e = ed[c.cow_id], row = Object.assign({}, c, { pos: i * 1000 });
      if (e) { row.removed = !!e.d.removed; if (e.d.pos != null) row.pos = e.d.pos; }
      out.push(row);
    });
    Object.keys(ed).forEach(function (id) {
      var e = ed[id];
      if (seen[id] || !e.d.added) return;
      var led = F.byId()[id] || {};
      out.push({ cow_id: id, mgmt_no: led.mgmt_no, reason: e.d.tab === '妊鑑' ? '手で追加・妊鑑' : '手で追加', added: true,
                 removed: !!e.d.removed, pos: e.d.pos != null ? e.d.pos : 1e9 + e.t / 1e6 });
    });
    return out;
  }
  function byTab(tab, removed) {
    return listNow().filter(function (c) { return !!c.removed === !!removed && (tab === '妊鑑' ? isPreg(c) : !isPreg(c)); })
      .sort(function (a, b) { return a.pos - b.pos; });
  }
  function setEdit(cow, patch) {
    if (!S.listDate) return;
    var cur = edits()[cow], rec = recFor(cow, S.listDate, 'リスト');
    rec.data = Object.assign({}, cur ? cur.d : {}, patch);
    keep(rec);
    renderList();
  }
  function move(cow, d) {
    var rows = byTab(S.tab), i = rows.map(function (c) { return c.cow_id; }).indexOf(cow), j = i + d;
    if (i < 0 || j < 0 || j >= rows.length) return;
    var far = rows[j + d];
    setEdit(cow, { pos: far ? (rows[j].pos + far.pos) / 2 : rows[j].pos + d * 1000 });
  }

  function renderList() {
    if (F.tabOf() !== 'repro') return;
    var html = head('list');
    if (!S.list.length) {
      html += F.box('検診リスト', F.none('リストがまだ箱にありません。訪問の前に PC で「J_検診リストを作る」を押すと出ます。'));
    } else {
      var tabs = ['妊鑑', '検診'], n = listNow().filter(function (c) { return !c.removed; }).length;
      html += '<div class="head"><div class="name"><b>検診リスト</b></div><div class="id">' + F.day(S.listDate) + ' に作ったリスト・' +
        n + ' 頭（入力の日 ' + F.day(workDate()) + '）</div>' +
        '<button type="button" class="link" data-edit="1">' + (S.edit ? '✓ 直し終わり' : '✎ リストを直す（足す・外す・並べ替え）') + '</button>' +
        '<a class="link" href="#/repro/report">📄 今日の検診レポート（PDF）</a></div>' +
        '<div class="seg">' + tabs.map(function (t) {
          var rows = byTab(t), done = rows.filter(function (c) { return inputsOf(c.cow_id).length; }).length;
          return '<button type="button" data-rtab="' + t + '"' + (S.tab === t ? ' class="on"' : '') + '>' +
            (t === '妊鑑' ? '妊娠鑑定' : '繁殖検診') + ' ' + done + '/' + rows.length + '</button>';
        }).join('') + '</div>';
      html += '<ul class="hits">' + byTab(S.tab).map(function (c) {
        var got = inputsOf(c.cow_id);
        var facts = [c.parity != null ? c.parity + '産' : '', c.dim != null ? 'DIM ' + c.dim : '',
                     c.days_after_ai != null ? 'AI後' + c.days_after_ai + '日' : '', c.last_semen || '',
                     c.milk_kg != null ? F.n(c.milk_kg, 1) + 'kg' : ''].filter(Boolean).join('・');
        var body = '<span class="no">' + F.no(c.cow_id, c.mgmt_no) + '</span><span>' + F.esc(c.reason || '') +
          (c.repro_status ? '<span class="small muted">（' + F.esc(c.repro_status) + '）</span>' : '') +
          (facts ? '<br><span class="small muted">' + F.esc(facts) + '</span>' : '') +
          (c.note ? '<br><span class="small">' + F.esc(c.note) + '</span>' : '') +
          (got.length ? '<br><span class="small ok">✓ ' + F.esc(got.map(function (r) { return summary(r.data); }).join('｜')) + '</span>' : '') +
          '</span>';
        if (S.edit) {
          return '<li class="editrow"><div class="editbody">' + body + '</div><div class="editbtns">' +
            '<button type="button" data-up="' + c.cow_id + '" aria-label="上へ">↑</button>' +
            '<button type="button" data-down="' + c.cow_id + '" aria-label="下へ">↓</button>' +
            '<button type="button" class="danger" data-rm="' + c.cow_id + '">外す</button></div></li>';
        }
        return '<li><a href="#/repro/cow/' + c.cow_id + '"' + (got.length ? ' class="done"' : '') + '>' + body + '</a></li>';
      }).join('') + '</ul>';
      var gone = byTab('妊鑑', true).concat(byTab('検診', true));
      if (gone.length) {
        html += F.box('外した牛（' + gone.length + '頭）', '<ul class="list">' + gone.map(function (c) {
          return '<li><b>' + F.no(c.cow_id, c.mgmt_no) + '</b> ' + F.esc(c.reason || '') +
            ' <button type="button" class="link" data-back="' + c.cow_id + '">戻す</button></li>';
        }).join('') + '</ul>');
      }
    }
    html += F.box(S.list.length ? 'リストに無い牛（診る・リストに足す）' : 'リストに無い牛',
      '<input id="rq" type="search" inputmode="numeric" pattern="[0-9]*" placeholder="4桁" autocomplete="off" aria-label="4桁">' +
      '<ul class="hits" id="rhits"></ul>');
    F.app.innerHTML = html;
    bar();
    F.app.oninput = null;
    F.app.onclick = function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-rtab')) { S.tab = b.getAttribute('data-rtab'); return renderList(); }
      if (b.hasAttribute('data-edit')) { S.edit = !S.edit; return renderList(); }
      if (b.hasAttribute('data-up')) return move(b.getAttribute('data-up'), -1);
      if (b.hasAttribute('data-down')) return move(b.getAttribute('data-down'), 1);
      if (b.hasAttribute('data-rm')) return setEdit(b.getAttribute('data-rm'), { removed: true });
      if (b.hasAttribute('data-back')) return setEdit(b.getAttribute('data-back'), { removed: false });
      if (b.hasAttribute('data-add')) {
        var id = b.getAttribute('data-add'), on = listNow().filter(function (c) { return c.cow_id === id; })[0];
        if (on) return setEdit(id, { removed: false });
        return setEdit(id, { added: true, removed: false, tab: S.tab });
      }
    };
    var q = document.getElementById('rq'), hits = document.getElementById('rhits');
    q.oninput = function () {
      var on = {};
      listNow().forEach(function (c) { if (!c.removed) on[c.cow_id] = 1; });
      hits.innerHTML = F.find(q.value).slice(0, 8).map(function (c) {
        return '<li class="editrow"><a class="editbody" href="#/repro/cow/' + c.cow_id + '"><span class="no">' + F.no(c) + '</span><span>' +
          F.esc(c.name || '') + '<br><span class="small muted">' + F.day(c.birth_date) + '生</span></span></a>' +
          (S.listDate && !on[c.cow_id] ? '<div class="editbtns"><button type="button" data-add="' + c.cow_id + '">＋ ' +
            (S.tab === '妊鑑' ? '妊鑑' : '検診') + 'に足す</button></div>' : '') + '</li>';
      }).join('');
    };
  }


  // ---------- 検診レポート（2026-11-11 本人「検診が終わったらすぐ、今日記録した牛のレポートを農家に PDF で」） ----------
  // 1.概要 2.区分別の結果 3.次回までの予定（案） 4.処置表 5.確認事項。
  // PDF は外の部品を使わずに作る: 画面と同じ絵を canvas に描き、その絵（JPEG）を1ページずつ PDF に入れる。
  var FARM_NAME = '白川牧場';
  function addDays(d, n) {
    var t = new Date(d + 'T00:00:00');
    t.setDate(t.getDate() + n);
    return localDate(t);
  }
  function md(d) { return Number(d.slice(5, 7)) + '/' + Number(d.slice(8, 10)); }
  // SS（ショートシンク）は全部午前で PG → PG → E2 → 発情 の4日間。
  //   SS    … 1回目の PG は獣医が当日に打った。あす・あさって・しあさってをお願いする
  //   NdS   … N日後から4日間（4dS を 11日に決めたら 15PG・16PG・17E2・18発情）
  //   シダー … 8日間入れておく（11日に入れたら 19抜去＋PG・20PG・21E2・22発情）
  //   短縮SS   … PG（当日・獣医）→ E2（あす）の2日間。発情はその次の日
  //   蓄膿PG×2 … PG を2日間。当日は獣医、あすだけ農家さん
  function schedule(tr, d) {
    if (tr === '短縮SS') return [md(d) + ' 済', '—', md(addDays(d, 1)), md(addDays(d, 2))];
    if (tr === '蓄膿PG×2') return [md(d) + ' 済', md(addDays(d, 1)), '—', '—'];
    var m = /^(\d)dS$/.exec(tr), s;
    if (tr === 'SS') s = 0; else if (m) s = Number(m[1]); else if (tr === 'シダー') s = 8; else return null;
    return [md(addDays(d, s)) + (tr === 'SS' ? ' 済' : (tr === 'シダー' ? ' 抜去＋PG' : '')),
            md(addDays(d, s + 1)), md(addDays(d, s + 2)), md(addDays(d, s + 3))];
  }
  function reportData(d) {
    var s = store(), by = {};
    var mine = Object.keys(s).map(function (k) { return s[k]; });
    var ids = mine.map(function (r) { return r.id; });
    var rows = mine.concat(S.server.filter(function (r) { return ids.indexOf(r.id) < 0; })).filter(function (r) {
      return r.date === d && !r.deleted && (r.kind === '妊娠鑑定' || r.kind === '繁殖検診');
    }).sort(function (a, b) { return String(a.updated_at || '').localeCompare(String(b.updated_at || '')); });
    rows.forEach(function (r) {
      var o = by[r.cow_id] = by[r.cow_id] || { cow_id: r.cow_id, treatment: [] }, x = r.data || {};
      Object.keys(x).forEach(function (k) {
        if (k === 'treatment') [].concat(x[k] || []).forEach(function (t) { if (o.treatment.indexOf(t) < 0) o.treatment.push(t); });
        else if (k === 'note' && o.note && o.note !== x[k]) o.note += ' ' + x[k];
        else o[k] = x[k];
      });
    });
    var led = F.byId(), onList = {};
    listNow().forEach(function (c) { onList[c.cow_id] = c; });
    var cows = Object.keys(by).map(function (id) {
      var o = by[id];
      o.no = String((onList[id] && onList[id].mgmt_no) || (led[id] && led[id].mgmt_no) || id.slice(5, 9));
      var tr = o.treatment, has = function (t) { return tr.indexOf(t) >= 0; };
      var ss = tr.filter(function (t) { return t === 'SS' || /^\ddS$/.test(t) || t === '短縮SS'; }).length;
      var t1 = ss ? 'SS' : has('シダー') ? 'シダー' : has('蓄膿PG×2') ? 'PG' : has('薬注') ? '薬注' : has('発情') ? '発情' :
        has('出血') ? '出血' : has('様子見') ? '様子見' : has('除外') ? '除外' : '';
      o.group = o.preg_check === '＋' ? '妊娠＋' : o.preg_check === '−' ? '妊娠せず' + (t1 ? '・' + t1 : '') :
        o.preg_check ? o.preg_check : (t1 || '検診のみ');
      var ov = function (side, v) { return v ? side + String(v).replace(/・/g, ' ') : ''; };
      o.text = [o.preg_check === '＋' ? '妊娠＋' : o.preg_check === '−' ? '−' : (o.preg_check || ''),
                o.twin && o.twin !== '単胎' ? o.twin : '', ov('右', o.ov_right), ov('左', o.ov_left),
                o.uterus && o.uterus !== '正常' ? o.uterus : '', o.m_score != null ? 'm' + o.m_score : '',
                tr.join(' '), o.drug ? '（' + o.drug + '）' : '',
                o.bcs != null ? 'BCS' + o.bcs : '', o.rumen_fill != null ? 'RF' + o.rumen_fill : '', o.note || '']
        .filter(Boolean).join(' ');
      return o;
    });
    var order = ['妊娠＋', '妊娠せず', '再妊鑑', '流産・胚死滅', 'SS', 'シダー', 'PG', '薬注', '発情', '出血', '様子見', '除外', '検診のみ'];
    var rank = function (g) { for (var i = 0; i < order.length; i++) if (g.indexOf(order[i]) === 0) return i; return order.length; };
    cows.sort(function (a, b) { return rank(a.group) - rank(b.group) || a.group.localeCompare(b.group) || a.no.localeCompare(b.no); });
    var groups = [];
    cows.forEach(function (o) {
      var g = groups.filter(function (x) { return x[0] === o.group; })[0];
      if (g) g[1]++; else groups.push([o.group, 1]);
    });
    // 4. 処置表
    var sched = [], other = [];
    cows.forEach(function (o) {
      o.treatment.forEach(function (t) {
        var x = schedule(t, d);
        if (x) sched.push([o.no].concat(x).concat([t === 'SS' ? 'SS（当日PG）' : t === 'シダー' ? 'シダー（8日間）' :
          t === '短縮SS' ? '短縮SS（PG・E2）' : t === '蓄膿PG×2' ? '蓄膿 PG×2' : t.replace('dS', '日後からSS')]));
      });
    });
    sched.sort(function (a, b) {
      // 1回目の PG の日の順（年をまたぐ 12月→1月 も正しく並ぶよう、検診の日より前の月は翌年とみなす）
      var k = function (r) { var m = /^(\d+)\/(\d+)/.exec(r[1]), mo = Number(m[1]); return (mo < Number(d.slice(5, 7)) ? mo + 12 : mo) * 100 + Number(m[2]); };
      return k(a) - k(b) || a[0].localeCompare(b[0]);
    });
    // 3. 次回までの予定（案）
    var nos = function (f) { return cows.filter(f).map(function (o) { return o.no; }); };
    var has = function (t) { return function (o) { return o.treatment.indexOf(t) >= 0; }; };
    var plan = [];
    var push = function (list, text) { if (list.length) plan.push(list.join('、') + '：' + text); };
    push(nos(function (o) { return o.preg_check === '再妊鑑'; }), '次回 再妊鑑');
    push(sched.filter(function (r) { return r[5] !== '蓄膿 PG×2'; }).map(function (r) { return r[0]; })
           .filter(function (v, i, a) { return a.indexOf(v) === i; }),
         '処置表のとおり。発情の日に授精（またはET）、授精後28日から妊娠鑑定');
    push(nos(has('蓄膿PG×2')), '蓄膿。あすも PG（処置表）、次回再検');
    push(nos(function (o) { return /嚢腫/.test(String(o.ov_left) + String(o.ov_right)) && o.treatment.indexOf('除外') < 0; }), '嚢腫。次回再検');
    push(nos(has('様子見')), '様子見。次回再検');
    push(nos(has('発情')), '発情。授精・ET の確認');
    push(nos(has('出血')), '出血。次回確認');
    push(nos(has('薬注')), '薬注。次回再検');
    push(nos(has('除外')), '繁殖から除外（次の分娩まで検診リストに載せません）');
    // 5. 確認事項
    var check = [];
    var miss = listNow().filter(function (c) { return !c.removed && !by[c.cow_id]; }).map(function (c) { return String(c.mgmt_no || ''); });
    if (miss.length) check.push('今回記載のない牛（' + miss.join('、') + '）：未検診');
    var nomm = nos(function (o) {
      return parseOv(o.ov_left).concat(parseOv(o.ov_right)).some(function (x) { return (x.t === 'CL' || x.t === 'F') && !x.mm; });
    });
    if (nomm.length) check.push(nomm.join('、') + '：卵巣所見の大きさ（mm）が未入力');
    var nopc = listNow().filter(function (c) { return !c.removed && isPreg(c) && by[c.cow_id] && !by[c.cow_id].preg_check; })
      .map(function (c) { return String(c.mgmt_no || ''); });
    if (nopc.length) check.push(nopc.join('、') + '：妊娠鑑定の結果が未入力');
    return { date: d, cows: cows, groups: groups, sched: sched, other: other, plan: plan, check: check };
  }

  // canvas に描く（A4 を 150dpi で 1240×1754）
  function drawReport(R) {
    var W = 1240, H = 1754, M = 96, pages = [], ctx, y;
    var FONT = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic","Meiryo","Noto Sans JP",sans-serif';
    function page() {
      var c = document.createElement('canvas');
      c.width = W; c.height = H;
      ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
      ctx.textBaseline = 'middle';
      pages.push(c); y = M;
    }
    function need(h) { if (y + h > H - M) page(); }
    function font(px, bold) { ctx.font = (bold ? 'bold ' : '') + px + 'px ' + FONT; }
    function wrap(text, maxW) {
      var out = [], line = '';
      String(text).split('').forEach(function (ch) {
        if (ctx.measureText(line + ch).width > maxW && line) { out.push(line); line = ch; } else line += ch;
      });
      out.push(line);
      return out;
    }
    function title(t) { need(60); font(40, true); ctx.fillStyle = '#000'; ctx.textAlign = 'left'; ctx.fillText(t, M, y + 22); y += 56; }
    function h2(t) { need(110); y += 26; font(28, true); ctx.fillStyle = '#000'; ctx.textAlign = 'left'; ctx.fillText(t, M, y + 16); y += 40; }
    function para(t, color) {
      font(24);
      wrap(t, W - 2 * M).forEach(function (ln) {
        need(34); ctx.fillStyle = color || '#000'; ctx.textAlign = 'left'; ctx.fillText(ln, M, y + 16); y += 34;
      });
    }
    function table(heads, rows, widths, aligns) {
      var x0 = M, rowH = 36;
      function cells(vals, isHead, lines) {
        var h = rowH * Math.max.apply(null, lines.map(function (l) { return l.length; }));
        need(h);
        var x = x0;
        vals.forEach(function (v, i) {
          ctx.fillStyle = isHead ? '#2F5597' : '#fff';
          ctx.fillRect(x, y, widths[i], h);
          ctx.strokeStyle = '#999'; ctx.lineWidth = 1.5; ctx.strokeRect(x, y, widths[i], h);
          ctx.fillStyle = isHead ? '#fff' : '#000';
          font(24, isHead || v.bold);
          var al = isHead ? 'center' : (aligns && aligns[i]) || 'left';
          ctx.textAlign = al;
          lines[i].forEach(function (ln, j) {
            ctx.fillText(ln, al === 'center' ? x + widths[i] / 2 : al === 'right' ? x + widths[i] - 10 : x + 10, y + rowH * j + rowH / 2);
          });
          x += widths[i];
        });
        y += h;
      }
      font(24, true);
      cells(heads, true, heads.map(function (v) { return [v]; }));
      rows.forEach(function (r) {
        font(24, r.bold);
        var vals = r.map(function (v) { return { toString: function () { return String(v); }, bold: r.bold }; });
        cells(vals, false, r.map(function (v, i) { return wrap(String(v), widths[i] - 20); }));
      });
    }
    page();
    title('繁殖検診報告 ' + R.date.replace(/-/g, '/'));
    para('農場：' + FARM_NAME + '　実施日：' + R.date.replace(/-/g, '/'));
    h2('1. 概要');
    var sum = R.groups.map(function (g) { return [g[0], g[1]]; }), tot = ['合計', R.cows.length];
    tot.bold = true;
    table(['区分', '頭数'], sum.concat([tot]), [300, 200], ['left', 'right']);
    h2('2. 区分別の結果');
    table(['区分', '牛番号', '所見・処置'], R.cows.map(function (o) { return [o.group, o.no, o.text]; }), [250, 130, W - 2 * M - 380], ['left', 'right', 'left']);
    h2('3. 次回までの予定（案）');
    (R.plan.length ? R.plan : ['とくになし']).forEach(function (t) { para('・' + t); });
    h2('4. 処置表（SS＝ショートシンク。処置はすべて午前）');
    if (R.sched.length) {
      table(['牛番号', 'PG', 'PG', 'E2', '発情', '内容'], R.sched, [130, 230, 130, 130, 130, W - 2 * M - 750],
            ['right', 'center', 'center', 'center', 'center', 'left']);
      y += 8;
      para('※「済」は獣医が当日に打った分です。「抜去＋PG」はシダーを抜いて PG を打つ日です。');
    } else para('・今回 SS・シダー・PG の牛はいません');
    R.other.forEach(function (t) { para('・' + t); });
    h2('5. 確認事項');
    (R.check.length ? R.check : ['とくになし']).forEach(function (t) { para('・' + t, R.check.length ? '#C00000' : '#000'); });
    return pages;
  }

  // 絵（JPEG）を1ページずつ入れただけの PDF を組む
  function pdfFrom(pages) {
    var enc = function (str) { var a = new Uint8Array(str.length); for (var i = 0; i < str.length; i++) a[i] = str.charCodeAt(i) & 255; return a; };
    var parts = [], offs = [], pos = 0;
    var put = function (u) { parts.push(u); pos += u.length; };
    var obj = function (n, head, stream) {
      offs[n] = pos;
      put(enc(n + ' 0 obj\n' + head + (stream ? '\nstream\n' : '\n')));
      if (stream) { put(stream); put(enc('\nendstream\n')); }
      put(enc('endobj\n'));
    };
    put(enc('%PDF-1.4\n'));
    var n = pages.length, kids = [];
    pages.forEach(function (c, i) {
      var b64 = c.toDataURL('image/jpeg', 0.9).split(',')[1], bin = atob(b64), img = enc(bin);
      var pg = 3 + i * 3, ct = pg + 1, im = pg + 2;
      kids.push(pg + ' 0 R');
      var content = enc('q 595.28 0 0 841.89 0 0 cm /Im0 Do Q');
      obj(pg, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ' + im + ' 0 R >> >> /Contents ' + ct + ' 0 R >>');
      obj(ct, '<< /Length ' + content.length + ' >>', content);
      obj(im, '<< /Type /XObject /Subtype /Image /Width ' + c.width + ' /Height ' + c.height +
          ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + img.length + ' >>', img);
    });
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Count ' + n + ' /Kids [' + kids.join(' ') + '] >>');
    var total = 3 + n * 3, xref = pos, t = 'xref\n0 ' + total + '\n0000000000 65535 f \n';
    for (var i = 1; i < total; i++) t += ('0000000000' + offs[i]).slice(-10) + ' 00000 n \n';
    t += 'trailer\n<< /Size ' + total + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
    put(enc(t));
    return new Blob(parts, { type: 'application/pdf' });
  }

  function renderReport() {
    if (F.tabOf() !== 'repro') return;
    var d = workDate(), R = reportData(d);
    var html = '<a class="back" href="#/repro">← リスト</a>' +
      '<div class="head"><div class="name"><b>検診レポート</b></div><div class="id">' + F.day(d) + ' に入れた ' + R.cows.length + ' 頭</div></div>' +
      '<div class="pickers"><label class="small muted" for="rdate">入力の日</label><input id="rdate" type="date" value="' + d + '"></div>' +
      '<div id="rbar" class="rbar"></div>';
    if (!R.cows.length) {
      F.app.innerHTML = html + F.box('レポート', F.none('この日に入れた妊娠鑑定・繁殖検診がまだありません。'));
    } else {
      html += '<div class="seg"><button type="button" class="primary" data-pdf="1">PDF を送る・保存する</button></div>' +
        '<p class="small muted" id="rpdfmsg">ボタンを押すと、LINE やメールなどの送り先を選べます。</p><div id="rpages"></div>';
      F.app.innerHTML = html;
      var pages = drawReport(R), box = document.getElementById('rpages');
      pages.forEach(function (c) { c.className = 'rpage'; box.appendChild(c); });
      F.app.onclick = function (e) {
        var b = e.target.closest('button');
        if (!b || !b.hasAttribute('data-pdf')) return;
        var name = '繁殖検診報告_' + d.replace(/-/g, '') + '.pdf', blob = pdfFrom(pages), msg = document.getElementById('rpdfmsg');
        var file = null;
        try { file = new File([blob], name, { type: 'application/pdf' }); } catch (err) { file = null; }
        if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: name }).catch(function () { /* やめたときは何もしない */ });
          return;
        }
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        if (msg) msg.textContent = name + ' を保存しました。';
      };
    }
    F.app.oninput = null;
    bar();
    document.getElementById('rdate').onchange = function () {
      try { sessionStorage.setItem('repro.date', this.value || localDate()); } catch (e) { /* なくてもよい */ }
      renderReport();
    };
  }

  // ---------- 1頭の所見 ----------
  function cowRow() { return listNow().filter(function (c) { return c.cow_id === S.open; })[0] || null; }
  var current = null;                                   // いま開いている1件（控えの形）

  function renderCow() {
    if (F.tabOf() !== 'repro') return;
    var c = cowRow(), led = F.byId()[S.open] || {};
    if (!S.mode) S.mode = c ? (inTab(c, S.tab) ? S.tab : (isPreg(c) ? '妊鑑' : '検診')) : '検診';
    var kind = MODES[S.mode][0];
    current = recFor(S.open, workDate(), kind);
    // 妊鑑・検診のどちらでも同じものを上に出す（2026-11-10 本人「乳量、DIM、直近の乳検の乳脂、乳蛋白、MUN もみたい」）
    var facts = c && !c.added ? [['産次', c.parity], ['DIM', c.dim], ['ロボ乳量', F.n(c.milk_kg, 1)], ['7日平均', F.n(c.milk_7d, 1)],
                     ['乳脂%', F.n(c.fat_pct, 2)], ['乳蛋白%', F.n(c.protein_pct, 2)], ['MUN', F.n(c.mun, 1)],
                     ['反芻分', F.n(c.rumination_min)]] : [];
    if (c && c.days_after_ai) facts.push(['AI-ET後', c.days_after_ai + '日']);
    if (c && c.ai_count) facts.push(['授精回数', c.ai_count]);
    var html = '<a class="back" href="#/repro">← リスト</a>' +
      '<div class="head"><div class="no">' + F.no(S.open, c && c.mgmt_no) + '</div>' +
      '<div class="id">' + F.esc((c && (c.repro_status || c.reason)) || 'リストに無い牛') + '</div>' +
      (facts.length ? '<div class="facts">' + facts.map(function (f) {
        return '<div class="fact"><b>' + F.esc(f[1] == null ? '—' : f[1]) + '</b><span>' + f[0] + '</span></div>';
      }).join('') + '</div>' : '') +
      (c && (c.last_semen || c.last_ai_date) ? '<div class="small muted">最終授精 ' + F.day(c.last_ai_date) + (c.last_semen ? '　' + F.esc(c.last_semen) : '') + '</div>' : '') +
      (c && c.test_ym ? '<div class="small muted">乳検 ' + F.esc(c.test_ym) + '（' + F.esc(c.test_age_days) + '日前' + (c.test_flag ? '・' + F.esc(c.test_flag) : '') +
        '）P/F ' + F.n(c.pf_ratio, 2) + '</div>' : '') +
      (c && c.note ? '<div class="small">' + F.esc(c.note) + '</div>' : '') +
      '<div class="small muted" id="rscore">前回の BCS・RF を読んでいます…</div>' +
      '</div>' +
      '<div class="seg">' + Object.keys(MODES).map(function (m) {
        return '<button type="button" data-mode="' + m + '"' + (S.mode === m ? ' class="on"' : '') + '>' + MODES[m][0] + '</button>';
      }).join('') + '</div>' +
      othersHtml(S.open, workDate(), kind) +
      '<section class="box" id="rform">' + formHtml() + '</section>' +
      '<div class="seg"><button type="button" data-step="-1">‹ 前の牛</button><button type="button" data-step="1" class="primary">次の牛 ›</button></div>' +
      '<div class="pickers"><label class="small muted" for="rdate">入力の日</label><input id="rdate" type="date" value="' + workDate() + '"></div>' +
      '<div id="rbar" class="rbar"></div>' +
      '<div id="rprev"></div>';
    F.app.innerHTML = html;
    bar();
    F.app.onclick = onClick;
    F.app.oninput = onInput;
    document.getElementById('rdate').onchange = function () {
      try { sessionStorage.setItem('repro.date', this.value || localDate()); } catch (e) { /* なくてもよい */ }
      renderCow();
    };
    prevExams();
    prevScore();
  }

  // 前回の BCS・ルーメンフィル（記録の BCS・RFS と、検診で入れた分のうち新しいほう。項目ごとに）
  function prevScore() {
    var cow = S.open, today = workDate();
    var q1 = F.get('cow_score?select=date,bcs,rumen_fill&cow_id=eq.' + cow + '&date=lt.' + today + '&order=date.desc&limit=5').catch(function () { return []; });
    var q2 = F.get('v_repro_exam?select=date,bcs,rumen_fill&cow_id=eq.' + cow + '&date=lt.' + today +
                   '&or=(bcs.not.is.null,rumen_fill.not.is.null)&order=date.desc&limit=5').catch(function () { return []; });
    Promise.all([q1, q2]).then(function (r) {
      var el = document.getElementById('rscore');
      if (!el || S.open !== cow) return;
      var all = (r[0] || []).concat(r[1] || []).sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
      var pick = function (k) { for (var i = 0; i < all.length; i++) if (all[i][k] != null) return all[i]; return null; };
      var b = pick('bcs'), f = pick('rumen_fill');
      el.innerHTML = '前回 BCS <b>' + (b ? F.n(b.bcs, 2) + '</b>（' + F.day(b.date) + '）' : '—</b>') +
        '・RF <b>' + (f ? F.esc(f.rumen_fill) + '</b>（' + F.day(f.date) + '）' : '—</b>');
    });
  }

  function othersHtml(cow, date, kind) {
    var o = others(cow, date, kind);
    return o.length ? '<p class="msg ok">ほかの人がこの日に入れています: ' + o.map(function (r) {
      return F.esc((r.entered_name || '').split('@')[0]) + '「' + F.esc(summary(r.data)) + '」';
    }).join('、') + '。ここで入れると、あなたの分として別に残ります。</p>' : '';
  }

  // 前回までの所見（PC が取り込んだ v_repro_exam。きのうまでの分）と発情・処置
  function prevExams() {
    F.get('v_repro_exam?select=date,preg_check,ov_left,cl_left,fol_left,ov_right,cl_right,fol_right,uterus,treatment,plan,plan_days,vet&cow_id=eq.' +
      S.open + '&order=date.desc&limit=3').then(function (r) {
      var el = document.getElementById('rprev');
      if (!el || !r.length) return;
      el.innerHTML = F.box('前回まで', '<ul class="list">' + r.map(function (x) {
        if (typeof x.treatment === 'string' && x.treatment) x.treatment = x.treatment.split(',');
        // 診た人は、スマホから入れた分はメールアドレスなので @ より前だけ出す
        return '<li><span class="d">' + F.day(x.date) + '</span>　' + F.esc(summary(x)) +
          (x.vet ? '<span class="small muted">（' + F.esc(String(x.vet).split('@')[0]) + '）</span>' : '') + '</li>';
      }).join('') + '</ul>' + F.src('検診の所見（PC が毎朝取り込んだもの）'));
    }).catch(function () { /* 前回が読めなくても入力はできる */ });
  }

  function formHtml() {
    var r = current.data, c = cowRow() || {};
    var set = S.ev ? EVENT[S.ev.kind] : MODES[S.mode][1];
    return set.map(function (f) { return fieldHtml(f, r, c); }).join('') +
      (S.ev ? '' : '<button type="button" class="more" data-more="1">' + (S.more ? '− ほかを閉じる' : '＋ ほかも入れる（跛行・BHB・直腸温）') + '</button>' +
        (S.more ? MORE.map(function (f) { return fieldHtml(f, r, c); }).join('') : '')) +
      (current.fresh ? '' : '<button type="button" class="link danger" data-undo="1">この入力を取り消す</button>');
  }
  function fieldHtml(f, r, c) {
    if (f.when && !f.when(r)) return '';
    var v = r[f.k];
    var h = '<div class="field' + (f.big ? ' big' : '') + '" data-field="' + f.k + '"><label>' + F.esc(f.label) + '</label>';
    if (f.text) {
      var ph = f.placeholder && c ? (c[f.placeholder] || '') : '';
      h += f.long ? '<textarea data-text="' + f.k + '">' + F.esc(v || '') + '</textarea>'
        : '<input type="text" data-text="' + f.k + '" placeholder="' + F.esc(ph) + '" value="' + F.esc(v || '') + '">';
    } else if (f.number) {
      h += '<input type="number" inputmode="decimal" step="' + (f.step || '1') + '" data-text="' + f.k + '" value="' + F.esc(v == null ? '' : v) + '">';
    } else if (f.ov) {
      h += '<div class="opts">' + ovHtml(f, v) + '</div>';
    } else {
      h += '<div class="opts">' + optsHtml(f, v) + '</div>';
      if (f.free) {
        var inOpts = f.opts.some(function (o) { return sameVal(f, v, o); });
        h += '<div class="inline"><input type="number" inputmode="numeric" placeholder="直接入れる" data-text="' + f.k + '" value="' +
          F.esc(v != null && !inOpts ? v : '') + '"></div>';
      }
    }
    return h + '</div>';
  }
  // 数の欄は数として比べる（BCS の「3.00」は 3 として控えるので、文字で比べると 2.75 しか光らなかった。2026-11-11）
  function sameVal(f, v, o) {
    if (v == null || v === '') return false;
    return f && f.num ? Number(v) === Number(o) : String(v) === String(o);
  }
  function optsHtml(f, v) {
    var chosen = f.multi ? [].concat(v || []) : [];
    var btn = function (o) {
      var on = f.multi ? chosen.indexOf(o) >= 0 : sameVal(f, v, o);
      return '<button type="button" data-set="' + f.k + '" data-val="' + F.esc(o) + '"' + (on ? ' class="on"' : '') + '>' + F.esc(o) + '</button>';
    };
    if (!f.group) return f.opts.map(btn).join('');
    // SS〜5dS は1列のタブ（1つだけ選ぶ）。ほかはその下に並べる
    return '<div class="ssrow">' + f.group.map(btn).join('') + '</div>' +
      f.opts.filter(function (o) { return f.group.indexOf(o) < 0; }).map(btn).join('');
  }
  // 卵巣: 上の列で足す → 足したものが1行ずつ並び、それぞれ mm を選ぶ。×で消す
  function ovHtml(f, v) {
    var a = parseOv(v), still = a.some(function (x) { return x.t === '静止'; });
    var h = OVT.map(function (t) {
      return '<button type="button" data-ovadd="' + f.k + '" data-val="' + t + '"' + (t === '静止' && still ? ' class="on"' : '') + '>' +
        (t === '静止' ? t : '＋' + t) + '</button>';
    }).join('');
    a.forEach(function (x, i) {
      if (x.t === '静止') return;
      var del = '<button type="button" class="ovdel" data-ovdel="' + f.k + '" data-i="' + i + '" aria-label="消す">×</button>';
      if (noSize(x.t)) {
        h += '<div class="ovrow"><div class="mm"><span class="ovname">' + F.esc(x.t) + '</span>' + del + '</div></div>';
        return;
      }
      var main = mmMain(x.t);
      h += '<div class="ovrow"><span class="ovname">' + F.esc(x.t) + (x.mm ? ' ' + x.mm + 'mm' : '') + '</span><div class="mm">' +
        main.map(function (n) {
          return '<button type="button" data-ovmm="' + f.k + '" data-i="' + i + '" data-val="' + n + '"' + (x.mm === n ? ' class="on"' : '') + '>' + n + '</button>';
        }).join('') +
        '<select data-ovsel="' + f.k + '" data-i="' + i + '"' + (x.mm && main.indexOf(x.mm) < 0 ? ' class="on"' : '') + '><option value="">ほか</option>' +
        mmRest(x.t).map(function (n) { return '<option value="' + n + '"' + (x.mm === n ? ' selected' : '') + '>' + n + 'mm</option>'; }).join('') +
        '</select>' + del + '</div></div>';
    });
    return h;
  }
  function onOv(key, fn) {
    var a = parseOv(current.data[key]);
    fn(a);
    current.data[key] = fmtOv(a);
    // 前の作りの欄（黄体 小中大・卵胞mm）は、いまの書き方では使わない
    var side = key === 'ov_left' ? 'left' : 'right';
    current.data['cl_' + side] = undefined;
    current.data['fol_' + side] = undefined;
    clean(current.data);
    var wasFresh = !!current.fresh;
    if (!current.deleted) keep(current);
    if (wasFresh) return repaintForm();
    var box = document.querySelector('[data-field="' + key + '"] .opts');
    if (box) box.innerHTML = ovHtml(fieldByKey(key), current.data[key]);
  }
  function paintField(key) {
    var box = document.querySelector('[data-field="' + key + '"] .opts');
    var f = fieldByKey(key);
    if (box && f) box.innerHTML = f.ov ? ovHtml(f, current.data[key]) : optsHtml(f, current.data[key]);
  }
  function hasWatcher(key) { return fieldsOf().some(function (f) { return f.watch === key; }); }
  function repaintForm() {
    var box = document.getElementById('rform');
    if (!box) return;
    var y = window.scrollY;
    box.innerHTML = formHtml();
    window.scrollTo(0, y);                // 欄が増減しても、見ていた場所に戻す
  }

  function onSet(key, val) {
    var f = fieldByKey(key), r = current.data;
    if (f && f.multi) {
      var cur = [].concat(r[key] || []);
      if (val === 'なし') cur = cur.indexOf('なし') >= 0 ? [] : ['なし'];
      else {
        var had = cur.indexOf(val) >= 0;
        cur = cur.filter(function (x) {      // SS〜5dS はどれか1つ（別のを押したら入れ替える）
          return x !== 'なし' && x !== val && !(f.group && f.group.indexOf(val) >= 0 && f.group.indexOf(x) >= 0);
        });
        if (!had) cur.push(val);
      }
      r[key] = cur;
    } else {
      // 同じところをもう一度押したら取り消し（押し間違いをその場で直せるように）
      r[key] = sameVal(f, r[key], val) ? undefined : (f && f.num ? Number(val) : val);
    }
    // 妊鑑をマイナス以外に直したら、マイナスのときに入れた卵巣は消す（見えない所見を残さない）
    if (key === 'preg_check' && !S.ev && S.mode === '妊鑑' && r.preg_check !== '−') { r.ov_right = undefined; r.ov_left = undefined; }
    clean(r);
    // 発情・処置は「残す」を押したときに控えに入れる。所見は押したそばから控えに入れる
    var wasFresh = !!current.fresh;
    if (!S.ev && !current.deleted) keep(current);
    paintField(key);
    // 組み直すのは、出し入れする欄があるときと、はじめて控えに入った（「取り消す」を出す）ときだけ
    if (hasWatcher(key) || (!S.ev && wasFresh)) repaintForm();
  }
  function clean(r) { Object.keys(r).forEach(function (k) { if (r[k] === undefined || r[k] === '' || (Array.isArray(r[k]) && !r[k].length)) delete r[k]; }); }

  function onInput(e) {
    var sel = e.target.getAttribute && e.target.getAttribute('data-ovsel');
    if (sel && current) {
      var si = +e.target.getAttribute('data-i'), sv = e.target.value;
      return onOv(sel, function (a) { if (a[si]) a[si].mm = sv ? Number(sv) : null; });
    }
    var k = e.target.getAttribute && e.target.getAttribute('data-text');
    if (!k || !current) return;
    var f = fieldByKey(k), v = e.target.value;
    current.data[k] = v === '' ? undefined : ((f && (f.num || f.number)) ? Number(v) : v);
    clean(current.data);
    keep(current);
    if (f && f.free) paintField(k);
  }

  function onClick(e) {
    var t = e.target.closest('button');
    if (!t) return;
    if (t.hasAttribute('data-ovadd')) {
      var ot = t.getAttribute('data-val');
      return onOv(t.getAttribute('data-ovadd'), function (a) {
        var still = a.some(function (x) { return x.t === '静止'; });
        if (still || ot === '静止') a.length = 0;                 // 静止と、ほかの所見は一緒には入れない
        if (!(still && ot === '静止')) a.push({ t: ot, mm: null });
      });
    }
    if (t.hasAttribute('data-ovmm')) {
      var mi = +t.getAttribute('data-i'), mv = Number(t.getAttribute('data-val'));
      return onOv(t.getAttribute('data-ovmm'), function (a) { if (a[mi]) a[mi].mm = a[mi].mm === mv ? null : mv; });
    }
    if (t.hasAttribute('data-ovdel')) {
      var di = +t.getAttribute('data-i');
      return onOv(t.getAttribute('data-ovdel'), function (a) { a.splice(di, 1); });
    }
    if (t.hasAttribute('data-set')) return onSet(t.getAttribute('data-set'), t.getAttribute('data-val'));
    if (t.hasAttribute('data-mode')) { S.mode = t.getAttribute('data-mode'); return renderCow(); }
    if (t.hasAttribute('data-more')) { S.more = !S.more; return repaintForm(); }
    if (t.hasAttribute('data-step')) return step(+t.getAttribute('data-step'));
    if (t.hasAttribute('data-undo')) {
      if (!confirm('この入力を取り消しますか？（箱には「取り消し」として残ります）')) return;
      current.deleted = true;
      keep(current);
      return S.ev ? renderEvent() : renderCow();
    }
    if (t.hasAttribute('data-kind')) { S.ev.kind = t.getAttribute('data-kind'); current = null; return renderEvent(); }
    if (t.hasAttribute('data-save')) return saveEvent();
  }

  function step(d) {
    var rows = byTab(S.tab);
    var i = rows.map(function (c) { return c.cow_id; }).indexOf(S.open);
    if (i < 0) rows = byTab('妊鑑').concat(byTab('検診')), i = rows.map(function (c) { return c.cow_id; }).indexOf(S.open);
    if (!rows.length) return;
    var j = Math.min(rows.length - 1, Math.max(0, i + d));
    S.mode = '';
    S.more = false;
    location.hash = '#/repro/cow/' + rows[j].cow_id;
    window.scrollTo(0, 0);
  }

  // ---------- 発情・処置 ----------
  function renderEvent() {
    if (F.tabOf() !== 'repro') return;
    var ev = S.ev;
    if (!current || current.kind !== ev.kind || current.cow_id !== ev.cow) {
      current = { id: uuid(), cow_id: ev.cow, date: workDate(), kind: ev.kind, data: {}, fresh: true };
    }
    var led = ev.cow ? (F.byId()[ev.cow] || {}) : null;
    var html = head('event') +
      '<div class="seg">' + ['発情', '処置'].map(function (k) {
        return '<button type="button" data-kind="' + k + '"' + (ev.kind === k ? ' class="on"' : '') + '>' + k + '</button>';
      }).join('') + '</div>' +
      F.box('牛', (led ? '<p><b class="big">' + F.no(led) + '</b> <span class="small muted">' + F.esc(led.name || '') + '</span></p>' : '') +
        '<input id="eq" type="search" inputmode="numeric" pattern="[0-9]*" placeholder="4桁" autocomplete="off" aria-label="4桁"><ul class="hits" id="ehits"></ul>') +
      '<div class="pickers"><label class="small muted" for="rdate">日</label><input id="rdate" type="date" value="' + current.date + '"></div>' +
      '<section class="box" id="rform">' + formHtml() + '</section>' +
      '<button type="button" class="wide" data-save="1"' + (ev.cow ? '' : ' disabled') + '>' + (ev.cow ? '残す' : '先に牛を選んでください') + '</button>' +
      '<div id="rrecent">' + recentEvents() + '</div>';
    F.app.innerHTML = html;
    bar();
    F.app.onclick = function (e) {
      var pick = e.target.closest('[data-cow]');
      if (pick) { e.preventDefault(); S.ev.cow = pick.getAttribute('data-cow'); current = null; return renderEvent(); }
      var undo = e.target.closest('[data-undo-id]');
      if (undo) {
        var s = store(), r = s[undo.getAttribute('data-undo-id')];
        if (r && confirm('この記録を取り消しますか？')) { r.deleted = true; keep(r); renderEvent(); }
        return;
      }
      onClick(e);
    };
    F.app.oninput = onEventInput;
    var q = document.getElementById('eq'), hits = document.getElementById('ehits');
    q.oninput = function () {
      hits.innerHTML = F.find(q.value).slice(0, 8).map(function (c) {
        return '<li><a href="#" data-cow="' + c.cow_id + '"><span class="no">' + F.no(c) + '</span><span>' +
          F.esc(c.name || '') + '<br><span class="small muted">' + F.day(c.birth_date) + '生</span></span></a></li>';
      }).join('');
    };
    document.getElementById('rdate').onchange = function () { current.date = this.value || localDate(); };
  }
  // 発情・処置は「残す」を押すまで控えに入れない（1回ずつが別の記録なので、押し間違いを送らない）
  function onEventInput(e) {
    var k = e.target.getAttribute && e.target.getAttribute('data-text');
    if (!k || !current) return;
    current.data[k] = e.target.value || undefined;
    clean(current.data);
  }
  function saveEvent() {
    if (!S.ev.cow) return;
    var d = current.data;
    if (!d.detail || !d.detail.length) { alert('「' + (S.ev.kind === '発情' ? '見たこと' : '処置') + '」を1つ以上選んでください'); return; }
    current.cow_id = S.ev.cow;
    keep(current);
    current = null;
    S.ev = { kind: S.ev.kind, cow: null };
    renderEvent();
  }
  function recentEvents() {
    var s = store(), me = F.me();
    var mine = Object.keys(s).map(function (k) { return s[k]; }).filter(function (r) { return r.kind === '発情' || r.kind === '処置'; });
    var ids = mine.map(function (r) { return r.id; });
    var all = mine.concat(S.server.filter(function (r) { return (r.kind === '発情' || r.kind === '処置') && ids.indexOf(r.id) < 0; }))
      .filter(function (r) { return !r.deleted; })
      .sort(function (a, b) { return (b.date + (b.at || b.updated_at || '')).localeCompare(a.date + (a.at || a.updated_at || '')); }).slice(0, 20);
    if (!all.length) return '';
    return F.box('最近の発情・処置', '<ul class="list">' + all.map(function (r) {
      var led = F.byId()[r.cow_id] || {}, d = r.data || {};
      var own = ids.indexOf(r.id) >= 0 || r.entered_name === me;
      return '<li><span class="d">' + F.day(r.date) + '</span>　<b>' + F.no(led) + '</b> ' + F.esc(r.kind) + '：' +
        F.esc([].concat(d.detail || []).join('・')) + (d.drug ? '（' + F.esc(d.drug) + '）' : '') + (d.note ? ' ' + F.esc(d.note) : '') +
        (r.sent === false ? ' <span class="small warn">送信待ち</span>' : '') +
        (own ? ' <button type="button" class="link danger" data-undo-id="' + r.id + '">取り消す</button>' : '') + '</li>';
    }).join('') + '</ul>');
  }

  // ---------- ET（会社の ET アプリと TAF から PC が作った一覧。見るだけ） ----------
  function renderEt() {
    F.app.onclick = F.app.oninput = null;
    F.app.innerHTML = head('et') + '<p class="muted pad">読んでいます…</p>';
    bar();
    F.get('et_list?select=*&order=date.desc&limit=300').then(function (rows) {
      if (F.tabOf() !== 'repro') return;
      var yr = localDate(new Date(Date.now() - 365 * 86400000));
      var y = rows.filter(function (r) { return r.date >= yr; });
      var done = y.filter(function (r) { return r.result === '受胎' || r.result === '不受胎'; });
      var ok = done.filter(function (r) { return r.result === '受胎'; }).length;
      var cls = { '受胎': 'ok', '不受胎': 'hi', '判定待ち': 'muted', '分からない': 'muted' };
      F.app.innerHTML = head('et') +
        F.box('ET（この1年）', '<div class="stats"><div class="stat"><div class="label">移植</div><div class="val">' + y.length + '</div><div class="sub">回</div></div>' +
          '<div class="stat"><div class="label">受胎</div><div class="val">' + (done.length ? Math.round(ok / done.length * 100) + '%' : '—') + '</div><div class="sub">' + ok + '/' + done.length + '（結果の出たもの）</div></div>' +
          '<div class="stat"><div class="label">判定待ち</div><div class="val">' + y.filter(function (r) { return r.result === '判定待ち'; }).length + '</div><div class="sub">移植から90日まで</div></div></div>') +
        // 2026-11-11 本人「移植日・10桁・ドナー・精液・借り腹（豊西）・凍結体内／凍結IVF」: ET記録（年度の表）から。
        // 妊鑑は note の頭（「妊鑑＋・…」）、借り腹は 業者か備考に「豊西」
        F.box('移植の記録', '<ul class="list etlist">' + rows.map(function (r) {
          var note = r.note || '', m = note.match(/^(妊鑑[^・]*|胚死滅)(・|$)/), preg = m ? m[1] : '', rest = m ? note.slice(m[0].length) : note;
          var toyo = /豊西/.test((r.maker || '') + note);
          return '<li><span class="d">' + F.day(r.date) + '</span>　<a href="#/cow/' + r.cow_id + '"><b>' + F.no(r.cow_id, r.mgmt_no) + '</b></a>' +
            ' <span class="small muted">' + F.esc(r.cow_id) + '</span><br>' +
            (r.egg_type ? '<span class="chip">' + F.esc(r.egg_type) + '</span> ' : '') +
            (toyo ? '<span class="chip out">借り腹（豊西）</span> ' : '') +
            '精液 <b>' + F.esc(r.embryo || '—') + '</b>' + (r.donor ? '・ドナー ' + F.esc(r.donor) : '') +
            (r.maker ? ' <span class="small muted">' + F.esc(r.maker) + '</span>' : '') +
            (r.vet ? ' <span class="small muted">' + F.esc(r.vet) + '</span>' : '') + '<br>' +
            (preg ? '<span class="small ' + (/＋/.test(preg) ? 'ok' : 'hi') + '">' + F.esc(preg) + '</span>　' : '') +
            '<span class="small ' + (cls[r.result] || '') + '">' + F.esc(r.result || '') + '</span>' +
            (rest ? ' <span class="small muted">' + F.esc(rest) + '</span>' : '') + '</li>';
        }).join('') + '</ul>' +
          F.src('TAF の繁殖（ET）・会社の ET記録（年度の表）・ET移植アプリ。卵の種類・ドナー・精液・妊鑑は ET記録、受胎は分娩か在籍牛一覧の分娩予定日で確かめる。ET はこのページでは入れない'));
      bar();
    }).catch(function (err) {
      F.app.innerHTML = head('et') + '<p class="msg err">読めませんでした（' + F.esc(err.message) + '）。' +
        (err.status === 404 ? '箱にまだ ET の表がありません。' : '電波を確かめてください。') + '</p>';
      bar();
    });
  }

  window.ReproPage = { show: show, send: function () { return send(); }, unsent: unsent };
  // 記録のページ（record.js）も同じ控え・同じ送り方を使う（電波の切れ方は同じなので、2つ作らない）
  window.FarmQueue = {
    keep: function (r) { F = F || window.Farm; keep(r); }, store: store, unsent: unsent, uuid: uuid,
    localDate: localDate, bar: function () { bar(); }, send: function () { F = F || window.Farm; return send(); }
  };
})();
