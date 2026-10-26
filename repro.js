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
  var CL = ['小', '中', '大'];
  var OV = ['なし', 'Cl', 'F', 'Cl+F', '嚢腫', '静止'];
  function hasCl(v) { return v === 'Cl' || v === 'Cl+F'; }
  function hasF(v) { return v === 'F' || v === 'Cl+F'; }
  function inList(v, x) { return [].concat(v || []).indexOf(x) >= 0; }

  var PREG = [
    { k: 'preg_check', label: '妊娠鑑定', big: true, opts: ['＋', '−', '再妊鑑', '流産・胚死滅'] },
    { k: 'twin', label: '双子', opts: ['単胎', '双胎(同側)', '双胎(両側)'],
      watch: 'preg_check', when: function (r) { return r.preg_check === '＋'; } },
    { k: 'sire_embryo', label: '種雄牛・受精卵（ちがうときだけ）', text: true, placeholder: 'last_semen' },
    { k: 'plan', label: '次の手', big: true, opts: ['このまま', '再妊鑑', '発情待ち', '今日AI', 'ET予定', '飛ばす', '淘汰候補'] },
    { k: 'plan_days', label: '何日後', opts: ['5', '7', '10', '14', '21', '30'], num: true, free: true, watch: 'plan',
      when: function (r) { return r.plan === '再妊鑑' || r.plan === 'ET予定'; } },
    { k: 'note', label: 'メモ', text: true, long: true }
  ];
  var EXAM = [
    { k: 'ov_left', label: '卵巣 左', opts: OV, big: true },
    { k: 'cl_left', label: '　左の黄体', opts: CL, watch: 'ov_left', when: function (r) { return hasCl(r.ov_left); } },
    { k: 'fol_left', label: '　左の卵胞 mm', opts: ['8', '10', '12', '15', '18', '20'], num: true, free: true,
      watch: 'ov_left', when: function (r) { return hasF(r.ov_left); } },
    { k: 'ov_right', label: '卵巣 右', opts: OV, big: true },
    { k: 'cl_right', label: '　右の黄体', opts: CL, watch: 'ov_right', when: function (r) { return hasCl(r.ov_right); } },
    { k: 'fol_right', label: '　右の卵胞 mm', opts: ['8', '10', '12', '15', '18', '20'], num: true, free: true,
      watch: 'ov_right', when: function (r) { return hasF(r.ov_right); } },
    { k: 'uterus', label: '子宮所見', big: true, opts: ['正常', '貯留 少', '貯留 中', '貯留 多', '子宮炎', '蓄膿', '復古不全'] },
    { k: 'fluid_char', label: '　貯留物の性状', opts: ['漿液', '膿様', '血様'], watch: 'uterus',
      when: function (r) { return (r.uterus || '').indexOf('貯留') === 0 || r.uterus === '蓄膿'; } },
    { k: 'm_score', label: 'Mスコア（粘液）', opts: ['0', '1', '2', '3'], num: true },
    { k: 'treatment', label: 'プログラム処置法', multi: true, big: true,
      opts: ['なし', 'SS', '変速SS', 'LH', 'PG', 'シダー挿入', 'シダー抜去', '薬注', '洗浄'] },
    { k: 'drug', label: '　薬の名前', text: true, watch: 'treatment',
      when: function (r) { return inList(r.treatment, '薬注') || inList(r.treatment, '洗浄'); } },
    { k: 'plan', label: '次の手', big: true, opts: ['今日AI', '発情待ち', '飛ばす', '再検', 'ET予定', '様子見', '淘汰候補'] },
    { k: 'plan_days', label: '何日後', opts: ['3', '5', '7', '10', '14', '21'], num: true, free: true, watch: 'plan',
      when: function (r) { return r.plan === '再検' || r.plan === 'ET予定' || r.plan === '様子見'; } },
    { k: 'note', label: 'メモ', text: true, long: true }
  ];
  // 毎回は入れないもの。全部並べると1頭の巻き取りが長くなって、40頭が終わらないため
  var MORE = [
    { k: 'bcs', label: 'BCS', num: true, opts: ['2.50', '2.75', '3.00', '3.25', '3.50', '3.75', '4.00', '4.25'] },
    { k: 'rumen_fill', label: 'ルーメンフィルスコア', opts: ['1', '2', '3', '4', '5'], num: true },
    { k: 'locomotion', label: '跛行スコア', opts: ['1', '2', '3', '4', '5'], num: true },
    { k: 'cyst', label: '嚢腫の別', opts: ['卵胞嚢腫', '黄体嚢腫'] },
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
    open: null, mode: '', more: false, ev: null, err: ''
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
      });
    }).catch(function (err) {
      S.err = err.status === 404 ? '箱にまだ入力の表がありません（佐藤さんが箱の表を流すと送れます）'
        : (err.status === 401 || err.status === 403 ? '送れませんでした（' + err.message + '）' : '電波が戻ったら送ります');
    }).then(function () { sending = false; bar(); });
  }
  window.addEventListener('online', function () { if (F) send(); });

  function farmId() {
    if (S.farm) return Promise.resolve(S.farm);
    return F.get('rpc/my_farms').then(function (r) {
      var v = Array.isArray(r) ? r[0] : r;
      S.farm = (v && typeof v === 'object') ? (v.my_farms || Object.keys(v).map(function (k) { return v[k]; })[0]) : v;
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
    if (m) { S.open = m[1]; S.ev = null; return loadAll().then(renderCow); }
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
    var side = function (s, ov, cl, fol) { return ov ? s + ov + (cl ? '(' + cl + ')' : '') + (fol ? '(' + fol + 'mm)' : '') : ''; };
    var ov = [side('L', r.ov_left, r.cl_left, r.fol_left), side('R', r.ov_right, r.cl_right, r.fol_right)].filter(Boolean).join(' ');
    if (ov) bits.push(ov);
    if (r.uterus && r.uterus !== '正常') bits.push(r.uterus);
    if (r.treatment && [].concat(r.treatment).length) bits.push([].concat(r.treatment).join('・'));
    if (r.plan) bits.push(r.plan + (r.plan_days ? '(' + r.plan_days + '日後)' : ''));
    return bits.join(' / ') || '入力あり';
  }
  function byTab(tab) { return S.list.filter(function (c) { return tab === '妊鑑' ? isPreg(c) : !isPreg(c); }); }

  function renderList() {
    if (F.tabOf() !== 'repro') return;
    var html = head('list');
    if (!S.list.length) {
      html += F.box('検診リスト', F.none('リストがまだ箱にありません。訪問の前に PC で「J_検診リストを作る」を押すと出ます。'));
    } else {
      var tabs = ['妊鑑', '検診'];
      html += '<div class="head"><div class="name"><b>検診リスト</b></div><div class="id">' + F.day(S.listDate) + ' に作ったリスト・' +
        S.list.length + ' 頭（入力の日 ' + F.day(workDate()) + '）</div></div>' +
        '<div class="seg">' + tabs.map(function (t) {
          var n = byTab(t).length, done = byTab(t).filter(function (c) { return inputsOf(c.cow_id).length; }).length;
          return '<button type="button" data-rtab="' + t + '"' + (S.tab === t ? ' class="on"' : '') + '>' +
            (t === '妊鑑' ? '妊娠鑑定' : '繁殖検診') + ' ' + done + '/' + n + '</button>';
        }).join('') + '</div>';
      html += '<ul class="hits">' + byTab(S.tab).map(function (c) {
        var got = inputsOf(c.cow_id);
        var facts = [c.parity != null ? c.parity + '産' : '', c.dim != null ? 'DIM ' + c.dim : '',
                     c.days_after_ai != null ? 'AI後' + c.days_after_ai + '日' : '', c.last_semen || '',
                     c.milk_kg != null ? F.n(c.milk_kg, 1) + 'kg' : ''].filter(Boolean).join('・');
        return '<li><a href="#/repro/cow/' + c.cow_id + '"' + (got.length ? ' class="done"' : '') + '>' +
          '<span class="no">' + F.esc(c.mgmt_no || '----') + '</span><span>' + F.esc(c.repro_status || c.reason || '') +
          '<br><span class="small muted">' + F.esc(facts) + '</span>' +
          (got.length ? '<br><span class="small ok">✓ ' + F.esc(got.map(function (r) { return summary(r.data); }).join('｜')) + '</span>' : '') +
          '</span></a></li>';
      }).join('') + '</ul>';
    }
    html += F.box('リストに無い牛', '<input id="rq" type="search" inputmode="numeric" pattern="[0-9]*" placeholder="4桁" autocomplete="off" aria-label="4桁">' +
      '<ul class="hits" id="rhits"></ul>');
    F.app.innerHTML = html;
    bar();
    F.app.oninput = null;
    F.app.onclick = function (e) {
      var b = e.target.closest('[data-rtab]');
      if (b) { S.tab = b.getAttribute('data-rtab'); renderList(); }
    };
    var q = document.getElementById('rq'), hits = document.getElementById('rhits');
    q.oninput = function () {
      hits.innerHTML = F.find(q.value).slice(0, 8).map(function (c) {
        return '<li><a href="#/repro/cow/' + c.cow_id + '"><span class="no">' + F.esc(c.mgmt_no || '----') + '</span><span>' +
          F.esc(c.name || '') + '<br><span class="small muted">' + F.day(c.birth_date) + '生</span></span></a></li>';
      }).join('');
    };
  }

  // ---------- 1頭の所見 ----------
  function cowRow() { return S.list.filter(function (c) { return c.cow_id === S.open; })[0] || null; }
  var current = null;                                   // いま開いている1件（控えの形）

  function renderCow() {
    if (F.tabOf() !== 'repro') return;
    var c = cowRow(), led = F.byId()[S.open] || {};
    if (!S.mode) S.mode = c && !isPreg(c) ? '検診' : (c ? '妊鑑' : '検診');
    var kind = MODES[S.mode][0];
    current = recFor(S.open, workDate(), kind);
    var facts = c ? [['産次', c.parity], ['DIM', c.dim], ['ロボ乳量', F.n(c.milk_kg, 1)], ['7日平均', F.n(c.milk_7d, 1)],
                     ['反芻分', F.n(c.rumination_min)]] : [];
    if (c && c.days_after_ai) facts.push(['AI-ET後', c.days_after_ai + '日']);
    if (c && c.ai_count) facts.push(['授精回数', c.ai_count]);
    var html = '<a class="back" href="#/repro">← リスト</a>' +
      '<div class="head"><div class="no">' + F.esc(led.mgmt_no || (c && c.mgmt_no) || '----') + '</div>' +
      '<div class="id">' + F.esc((c && (c.repro_status || c.reason)) || 'リストに無い牛') + '</div>' +
      (facts.length ? '<div class="facts">' + facts.map(function (f) {
        return '<div class="fact"><b>' + F.esc(f[1] == null ? '—' : f[1]) + '</b><span>' + f[0] + '</span></div>';
      }).join('') + '</div>' : '') +
      (c && (c.last_semen || c.last_ai_date) ? '<div class="small muted">最終授精 ' + F.day(c.last_ai_date) + (c.last_semen ? '　' + F.esc(c.last_semen) : '') + '</div>' : '') +
      (c && c.test_ym ? '<div class="small muted">乳検 ' + F.esc(c.test_ym) + '（' + F.esc(c.test_age_days) + '日前' + (c.test_flag ? '・' + F.esc(c.test_flag) : '') +
        '）乳脂 ' + F.n(c.fat_pct, 2) + '・蛋白 ' + F.n(c.protein_pct, 2) + '・P/F ' + F.n(c.pf_ratio, 2) + '・MUN ' + F.n(c.mun, 1) + '</div>' : '') +
      '</div>' + head('') +
      '<div class="seg">' + Object.keys(MODES).map(function (m) {
        return '<button type="button" data-mode="' + m + '"' + (S.mode === m ? ' class="on"' : '') + '>' + MODES[m][0] + '</button>';
      }).join('') + '</div>' +
      '<div class="pickers"><label class="small muted" for="rdate">入力の日</label><input id="rdate" type="date" value="' + workDate() + '"></div>' +
      othersHtml(S.open, workDate(), kind) +
      '<section class="box" id="rform">' + formHtml() + '</section>' +
      '<div class="seg"><button type="button" data-step="-1">‹ 前の牛</button><button type="button" data-step="1" class="primary">次の牛 ›</button></div>' +
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
      (S.ev ? '' : '<button type="button" class="more" data-more="1">' + (S.more ? '− ほかを閉じる' : '＋ ほかも入れる（BCS・ルーメン・跛行…）') + '</button>' +
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
    } else {
      h += '<div class="opts">' + optsHtml(f, v) + '</div>';
      if (f.free) {
        var inOpts = f.opts.indexOf(String(v)) >= 0;
        h += '<div class="inline"><input type="number" inputmode="numeric" placeholder="直接入れる" data-text="' + f.k + '" value="' +
          F.esc(v != null && !inOpts ? v : '') + '"></div>';
      }
    }
    return h + '</div>';
  }
  function optsHtml(f, v) {
    var chosen = f.multi ? [].concat(v || []) : [v == null ? null : String(v)];
    return f.opts.map(function (o) {
      return '<button type="button" data-set="' + f.k + '" data-val="' + F.esc(o) + '"' + (chosen.indexOf(o) >= 0 ? ' class="on"' : '') + '>' + F.esc(o) + '</button>';
    }).join('');
  }
  function paintField(key) {
    var box = document.querySelector('[data-field="' + key + '"] .opts');
    var f = fieldByKey(key);
    if (box && f) box.innerHTML = optsHtml(f, current.data[key]);
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
        cur = cur.filter(function (x) { return x !== 'なし'; });
        var i = cur.indexOf(val);
        if (i >= 0) cur.splice(i, 1); else cur.push(val);
      }
      r[key] = cur;
    } else {
      // 同じところをもう一度押したら取り消し（押し間違いをその場で直せるように）
      r[key] = String(r[key]) === val ? undefined : (f && f.num ? Number(val) : val);
    }
    // 卵巣で「なし・嚢腫・静止」なら、その側の大きさは意味を失うので消す（「卵巣なしなのに黄体 大」を作らない）
    if (key === 'ov_left' || key === 'ov_right') {
      var side = key === 'ov_left' ? 'left' : 'right';
      if (!hasCl(r[key])) r['cl_' + side] = undefined;
      if (!hasF(r[key])) r['fol_' + side] = undefined;
    }
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
    if (i < 0) rows = S.list, i = rows.map(function (c) { return c.cow_id; }).indexOf(S.open);
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
      F.box('牛', (led ? '<p><b class="big">' + F.esc(led.mgmt_no || '----') + '</b> <span class="small muted">' + F.esc(led.name || '') + '</span></p>' : '') +
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
        return '<li><a href="#" data-cow="' + c.cow_id + '"><span class="no">' + F.esc(c.mgmt_no || '----') + '</span><span>' +
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
      return '<li><span class="d">' + F.day(r.date) + '</span>　<b>' + F.esc(led.mgmt_no || '----') + '</b> ' + F.esc(r.kind) + '：' +
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
        F.box('移植の記録', '<ul class="list">' + rows.map(function (r) {
          return '<li><span class="d">' + F.day(r.date) + '</span>　<a href="#/cow/' + r.cow_id + '"><b>' + F.esc(r.mgmt_no || '----') + '</b></a> ' +
            F.esc(r.embryo || '') + (r.donor ? '<span class="small muted">（' + F.esc(r.donor) + '）</span>' : '') +
            (r.vet ? ' <span class="small muted">' + F.esc(r.vet) + '</span>' : '') +
            ' <span class="small ' + (cls[r.result] || '') + '">' + F.esc(r.result || '') + '</span></li>';
        }).join('') + '</ul>' +
          F.src('TAF の繁殖（ET）と、会社の ET移植アプリ（移植記録.xlsx）。受胎は分娩か在籍牛一覧の分娩予定日で確かめる。ET はこのページでは入れない（ET アプリで入れる）'));
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
