// 白川Farm「記録」— 体測（胸囲）・BCS／RFS・糞洗い・PSPS。
//
// 2026-10-26 本人と決めたこと: はかる牛のリストは作らず、4桁で自由に入れる／糞洗い・PSPS は % を打つ／
// PSPS の試料は TMR（搾乳）・TMR（乾乳・育成）・残飼・草／サイレージ単体（ほかの名前も打てる）。
// 送り方は繁殖と同じ（repro.js の FarmQueue）。押したらスマホに控え、電波があれば箱の input_record へ。
// 1回はかるごとに別の記録（「残す」を押したときに控えに入れる）。直せるのは自分が入れたものだけ・消さずに取り消す。
// PC が毎朝 import_box.py で farm.db に入れる（体測 → weight、BCS・RFS → cow_score、糞洗い → feces、PSPS → psps）。
// 推定体重は体高BW.xlsx と同じ式（import_box.bw_from_chest と同じ。片方だけ直さない）。

(function () {
  'use strict';

  var F = null, Q = null;
  var TABLE = 'input_record';
  // 糞洗い・PSPS は 2026-11-08 から「餌」（feed.js）へ移した。昔の #/record/feces・psps は餌へ回す
  var SUBS = [['body', '体測', '#/record'], ['growth', '体測分析', '#/record/growth'], ['bcs', 'BCS・RFS', '#/record/bcs'],
              ['feces', '糞洗い →餌', '#/feed/feces'], ['psps', 'PSPS →餌', '#/feed/psps']];
  var KIND = { body: '体測', bcs: 'BCS・RFS', feces: '糞洗い', psps: 'PSPS' };
  var SAMPLES = ['TMR（搾乳）', 'TMR（乾乳・育成）', '残飼', '草・サイレージ'];
  var S = { sub: 'body', cow: null, data: {}, sample: SAMPLES[0] };

  function bw(chest) { return Math.round((0.0234 * chest * chest - 2.281 * chest + 75.618) * 10) / 10; }
  function today() { return Q.localDate(); }
  function subOf(hash) { var m = hash.match(/^#\/record\/(\w+)/); return m && (KIND[m[1]] || m[1] === 'growth') ? m[1] : 'body'; }

  function show(hash) {
    F = window.Farm;
    Q = window.FarmQueue;
    var sub = subOf(hash);
    if (sub === 'feces' || sub === 'psps') { location.replace('#/feed/' + sub); return; }
    if (sub !== S.sub) { S.sub = sub; S.cow = null; S.data = {}; }
    render();
    Q.send();
  }

  function head() {
    return '<div class="seg">' + SUBS.map(function (s) {
      return '<a class="segbtn' + (s[0] === S.sub ? ' on' : '') + '" href="' + s[2] + '">' + s[1] + '</a>';
    }).join('') + '</div><div id="rbar" class="rbar"></div>';
  }

  function render() {
    if (F.tabOf() !== 'record') return;
    var html = head();
    if (S.sub === 'growth') {
      F.app.innerHTML = html + '<div id="gan"><p class="muted pad">体測の記録を読んでいます…</p></div>';
      Q.bar();
      F.app.onclick = onGrowthClick;
      F.app.oninput = null;
      return growth();
    }
    if (S.sub === 'body' || S.sub === 'bcs') html += cowForm();
    else html += groupForm();
    html += '<div id="rmine">' + mine() + '</div><div id="rhist"></div>';
    F.app.innerHTML = html;
    Q.bar();
    F.app.onclick = onClick;
    F.app.oninput = onInput;
    var q = document.getElementById('cq');
    if (q) {
      q.oninput = function () {
        document.getElementById('chits').innerHTML = F.find(q.value).slice(0, 8).map(function (c) {
          return '<li><a href="#" data-cow="' + c.cow_id + '"><span class="no">' + F.no(c) + '</span><span>' +
            F.esc(c.name || '') + '<br><span class="small muted">' + F.day(c.birth_date) + '生</span></span></a></li>';
        }).join('');
      };
      if (!S.cow) q.focus();
    }
    // 2026-11-15 本人「4桁で牛を選んだら、カーソルが体測の欄に入っていて、すぐ入力できるように」。
    // タップの処理の中で focus するので、iPhone でもキーボードがそのまま出る
    if (S.cow && S.sub === 'body') {
      var ch = F.app.querySelector('[data-text="chest_cm"]');
      if (ch) { ch.focus(); ch.select && ch.select(); }
    }
    history();
  }

  // ---------- 牛ごと（体測・BCS／RFS） ----------
  function cowForm() {
    var led = S.cow ? (F.byId()[S.cow] || {}) : null;
    var d = S.data, html = '';
    html += F.box('牛', led
      ? '<p><b class="big">' + F.no(led) + '</b> <span class="small muted">' + F.esc(led.name || '') + '・' +
        ageText(led.birth_date) + '</span> <button type="button" class="link" data-clear="1">別の牛</button></p>'
      : '<input id="cq" type="search" inputmode="numeric" pattern="[0-9]*" placeholder="4桁" autocomplete="off" aria-label="4桁"><ul class="hits" id="chits"></ul>');
    if (!led) return html;
    if (S.sub === 'body') {
      html += F.box('体測', field('chest_cm', '胸囲（cm）', d.chest_cm) + field('height_cm', '体高（cm・はかったときだけ）', d.height_cm) +
        '<p class="small muted" id="bwnow">' + bwText(d.chest_cm) + '</p>' + textField('note', 'メモ', d.note));
    } else {
      html += F.box('BCS・RFS', opts('bcs', 'BCS', ['2.50', '2.75', '3.00', '3.25', '3.50', '3.75', '4.00', '4.25'], d.bcs) +
        opts('rumen_fill', 'ルーメンフィルスコア（RFS）', ['1', '2', '3', '4', '5'], d.rumen_fill) + textField('note', 'メモ', d.note));
    }
    html += '<div class="pickers"><label class="small muted" for="rdate">はかった日</label><input id="rdate" type="date" value="' + (d.date || today()) + '"></div>' +
      '<button type="button" class="wide" data-save="1">残す（次の牛へ）</button>' +
      // これまでは入力の下に（牛を選んだらすぐ欄に打てるように。2026-11-15）
      F.box('この牛のこれまで', '<div id="cprev"><p class="small muted">読んでいます…</p></div>');
    return html;
  }
  function ageText(b) {
    var dd = F.days(b);
    return dd == null ? '生年月日なし' : dd + '日齢（' + (dd / 30.4375).toFixed(1) + 'か月）';
  }
  function bwText(chest) {
    var c = parseFloat(chest);
    return c > 50 && c < 260 ? '推定体重 <b>' + bw(c) + ' kg</b>（体高BW.xlsx と同じ式。推奨体重と充足率は PC が出す）' : '胸囲を入れると推定体重が出ます';
  }

  // ---------- 群（糞洗い・PSPS） ----------
  function groupForm() {
    var d = S.data, html = '';
    if (S.sub === 'feces') {
      html += F.box('糞洗い', textField('target', '採取した牛（例: 4頭初産DIM50-90・1773 1739）', d.target) +
        pct(['upper', '上段'], ['middle', '中段'], ['lower', '下段']) +
        opts('foam', '泡', ['−', '＋', '＋＋', '＋＋＋'], d.foam) + textField('corn', 'コーン・繊維の残り', d.corn) + textField('note', 'メモ（ムチンなど）', d.note));
    } else {
      html += F.box('PSPS', '<div class="field big"><label>試料</label><div class="opts">' + SAMPLES.map(function (s) {
        return '<button type="button" data-sample="' + F.esc(s) + '"' + (S.sample === s ? ' class="on"' : '') + '>' + F.esc(s) + '</button>';
      }).join('') + '</div></div>' + textField('detail', '試料の名前を足す（例: グラス 12mm・0.6kg クレイン）', d.detail) +
        pct(['upper', '上段（19mm〜）'], ['middle', '中段（8〜19mm）'], ['lower', '下段（1.18〜8mm）'], ['pan', '受け皿（〜1.18mm）']) +
        textField('note', 'メモ', d.note));
    }
    html += '<div class="pickers"><label class="small muted" for="rdate">はかった日</label><input id="rdate" type="date" value="' + (d.date || today()) + '"></div>' +
      '<button type="button" class="wide" data-save="1">残す</button>';
    return html;
  }
  function pct() {
    var items = [].slice.call(arguments);
    return items.map(function (it) { return field(it[0], it[1] + '（%）', S.data[it[0]]); }).join('') +
      '<p class="small muted" id="psum">' + sumText(items.map(function (it) { return it[0]; })) + '</p>';
  }
  function sumText(keys) {
    var v = keys.map(function (k) { return parseFloat(S.data[k]); });
    if (v.some(isNaN)) return '合計 —';
    var s = v.reduce(function (a, b) { return a + b; }, 0);
    return Math.abs(s - 100) <= 5 ? '合計 ' + s.toFixed(1) + ' %' : '<span class="warn">合計 ' + s.toFixed(1) + ' %（100 から離れています。打ち間違いがないか見てください）</span>';
  }

  // ---------- 欄 ----------
  function field(k, label, v) {
    var hint = k === 'chest_cm' ? ' enterkeyhint="next"' : (k === 'height_cm' ? ' enterkeyhint="done"' : '');
    return '<div class="field" data-field="' + k + '"><label>' + F.esc(label) + '</label><input type="number" inputmode="decimal" step="0.1" data-text="' + k +
      '"' + hint + ' value="' + F.esc(v == null ? '' : v) + '"></div>';
  }
  // 胸囲で「次へ」→ 体高、体高で「完了」→ 残す（次の牛の4桁へ）
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !F || F.tabOf() !== 'record' || S.sub !== 'body') return;
    var k = e.target.getAttribute && e.target.getAttribute('data-text');
    if (k === 'chest_cm') { e.preventDefault(); var h = F.app.querySelector('[data-text="height_cm"]'); if (h) h.focus(); }
    else if (k === 'height_cm') { e.preventDefault(); save(); }
  });
  function textField(k, label, v) {
    return '<div class="field" data-field="' + k + '"><label>' + F.esc(label) + '</label><input type="text" data-text="' + k + '" value="' + F.esc(v || '') + '"></div>';
  }
  function opts(k, label, list, v) {
    return '<div class="field big" data-field="' + k + '"><label>' + F.esc(label) + '</label><div class="opts">' + list.map(function (o) {
      return '<button type="button" data-set="' + k + '" data-val="' + F.esc(o) + '"' + (String(v) === o || (v != null && Number(v) === Number(o)) ? ' class="on"' : '') + '>' + F.esc(o) + '</button>';
    }).join('') + '</div></div>';
  }

  function onInput(e) {
    var k = e.target.getAttribute && e.target.getAttribute('data-text');
    if (!k) return;
    S.data[k] = e.target.value === '' ? undefined : e.target.value;
    if (k === 'chest_cm') document.getElementById('bwnow').innerHTML = bwText(S.data.chest_cm);
    var ps = document.getElementById('psum');
    if (ps) ps.innerHTML = sumText(S.sub === 'feces' ? ['upper', 'middle', 'lower'] : ['upper', 'middle', 'lower', 'pan']);
  }

  function onClick(e) {
    var c = e.target.closest('[data-cow]');
    if (c) { e.preventDefault(); S.cow = c.getAttribute('data-cow'); S.data = {}; render(); return; }
    var t = e.target.closest('button');
    if (!t) return;
    if (t.hasAttribute('data-clear')) { S.cow = null; S.data = {}; return render(); }
    if (t.hasAttribute('data-sample')) {
      S.sample = t.getAttribute('data-sample');
      [].forEach.call(document.querySelectorAll('[data-sample]'), function (b) { b.className = b === t ? 'on' : ''; });
      return;
    }
    if (t.hasAttribute('data-set')) {
      var k = t.getAttribute('data-set'), v = t.getAttribute('data-val');
      S.data[k] = String(S.data[k]) === v ? undefined : v;          // もう一度押したら取り消し
      [].forEach.call(document.querySelectorAll('[data-set="' + k + '"]'), function (b) {
        b.className = String(S.data[k]) === b.getAttribute('data-val') ? 'on' : '';
      });
      return;
    }
    if (t.hasAttribute('data-save')) return save();
    if (t.hasAttribute('data-undo-id')) {
      var s = Q.store(), r = s[t.getAttribute('data-undo-id')];
      if (r && confirm('この記録を取り消しますか？（箱には「取り消し」として残ります）')) { r.deleted = true; Q.keep(r); render(); }
    }
  }

  function num(v) { var x = parseFloat(v); return isNaN(x) ? undefined : x; }

  function save() {
    var d = S.data, date = (document.getElementById('rdate') || {}).value || today();
    var rec = { table: TABLE, id: Q.uuid(), date: date, kind: KIND[S.sub], data: {} };
    if (S.sub === 'body') {
      var chest = num(d.chest_cm);
      if (!chest || chest < 50 || chest > 260) { alert('胸囲（cm）を入れてください（50〜260）'); return; }
      rec.cow_id = S.cow;
      rec.data = { chest_cm: chest, height_cm: num(d.height_cm), note: d.note || undefined };
    } else if (S.sub === 'bcs') {
      if (d.bcs == null && d.rumen_fill == null) { alert('BCS か RFS を選んでください'); return; }
      rec.cow_id = S.cow;
      rec.data = { bcs: num(d.bcs), rumen_fill: num(d.rumen_fill), note: d.note || undefined };
    } else {
      var keys = S.sub === 'feces' ? ['upper', 'middle', 'lower'] : ['upper', 'middle', 'lower', 'pan'];
      if (keys.every(function (k) { return num(d[k]) === undefined; }) && !d.note && !d.corn) { alert('数字かメモを入れてください'); return; }
      rec.target = S.sub === 'feces' ? (d.target || '').trim() : S.sample + (d.detail ? '・' + d.detail.trim() : '');
      if (!rec.target) { alert('採取した牛を入れてください'); return; }
      keys.forEach(function (k) { rec.data[k] = num(d[k]); });
      if (S.sub === 'feces') { rec.data.foam = d.foam; rec.data.corn = d.corn || undefined; }
      rec.data.note = d.note || undefined;
    }
    Object.keys(rec.data).forEach(function (k) { if (rec.data[k] === undefined) delete rec.data[k]; });
    Q.keep(rec);
    // 牛ごとの記録は、続けて次の牛を入れられるように牛を外す。群の記録は欄を空にする
    S.cow = null;
    S.data = {};
    render();
  }

  // ---------- 入れたもの（このスマホ）と、これまで（PC が取り込んだ分） ----------
  function mine() {
    var s = Q.store(), kind = KIND[S.sub];
    var rows = Object.keys(s).map(function (k) { return s[k]; })
      .filter(function (r) { return r.table === TABLE && r.kind === kind && !r.deleted; })
      .sort(function (a, b) { return b.at - a.at; }).slice(0, 30);
    if (!rows.length) return '';
    return F.box('このスマホで入れたもの', '<ul class="list">' + rows.map(function (r) {
      var led = r.cow_id ? (F.byId()[r.cow_id] || {}) : null, d = r.data || {};
      var what = S.sub === 'body' ? '胸囲 ' + d.chest_cm + 'cm（推定 ' + bw(d.chest_cm) + 'kg）' + (d.height_cm ? '・体高 ' + d.height_cm : '')
        : S.sub === 'bcs' ? [d.bcs != null ? 'BCS ' + Number(d.bcs).toFixed(2) : '', d.rumen_fill != null ? 'RFS ' + d.rumen_fill : ''].filter(Boolean).join('・')
        : ['upper', 'middle', 'lower', 'pan'].filter(function (k) { return d[k] != null; }).map(function (k) { return d[k]; }).join(' / ') + ' %' + (d.foam ? '・泡' + d.foam : '');
      return '<li><span class="d">' + F.day(r.date) + '</span>　<b>' + (led ? F.no(led) : F.esc(r.target)) + '</b> ' + F.esc(what) +
        (r.sent === false ? ' <span class="small warn">送信待ち</span>' : '') +
        ' <button type="button" class="link danger" data-undo-id="' + r.id + '">取り消す</button></li>';
    }).join('') + '</ul>');
  }

  function history() {
    var el = document.getElementById('rhist');
    if (!el) return;
    var q = {
      body: S.cow ? 'v_weight?select=date,age_days,chest_cm,weight_est,weight_actual,target_weight,ratio,source&cow_id=eq.' + S.cow + '&order=date.desc&limit=40' : null,
      bcs: S.cow ? 'cow_score?select=date,bcs,rumen_fill,source&cow_id=eq.' + S.cow + '&order=date.desc&limit=6' : null,
      feces: 'feces?select=date,target,item,value,note,source&order=date.asc',
      psps: 'psps?select=date,sample,item,value,note,source&order=date.asc'
    }[S.sub];
    if (!q) return;
    F.get(q).then(function (rows) {
      if (F.tabOf() !== 'record' || !document.getElementById('rhist')) return;
      var html = S.sub === 'body' || S.sub === 'bcs' ? cowHistory(rows) : groupHistory(rows);
      if (S.sub === 'body' || S.sub === 'bcs') { var p = document.getElementById('cprev'); if (p) p.innerHTML = html; }
      else el.innerHTML = html;
    }).catch(function () { /* これまでが読めなくても入力はできる */ });
  }

  function cowHistory(rows) {
    if (!rows.length) return '<p class="small muted">これまでの記録はありません。</p>';
    var mini = '';
    if (S.sub === 'body') {
      var pts = rows.filter(function (r) { return r.ratio != null && r.age_days != null; }).map(function (r) {
        return { x: Math.round(r.age_days / 30.44 * 10) / 10, y: +r.ratio, tip: r.date + '・' + F.n(r.age_days / 30.44, 1) + 'か月' + NL + '充足率 ' + F.n(r.ratio) + '%・体重 ' + F.n(wOf(r), 0) + 'kg' };
      });
      if (pts.length > 1) mini = '<h4 class="gh">この牛の充足率（%・月齢）</h4>' + window.FarmTrend.xy([{ name: '充足率', color: 'var(--spark)', pts: pts }], { xlab: '月齢（か月）', unit: '%', label: '充足率' });
    }
    return mini + '<ul class="list">' + rows.slice(0, 6).map(function (r) {
      return '<li><span class="d">' + F.day(r.date) + '</span>　' + (S.sub === 'body'
        ? '胸囲 ' + F.n(r.chest_cm) + 'cm・推定 ' + F.n(r.weight_est, 1) + 'kg' + (r.ratio != null ? '・充足率 ' + F.n(r.ratio) + '%' : '')
        : (r.bcs != null ? 'BCS ' + F.n(r.bcs, 2) : '') + (r.rumen_fill != null ? '・RFS ' + r.rumen_fill : '')) + '</li>';
    }).join('') + '</ul>' + F.src(S.sub === 'body' ? '体高BW.xlsx と白川Farm（PC が毎朝取り込んだもの）' : '白川Farm（PC が毎朝取り込んだもの）');
  }

  function groupHistory(rows) {
    if (!rows.length) return F.box('これまで', F.none('まだ記録がありません。'));
    var key = S.sub === 'feces' ? 'target' : 'sample';
    var by = {}, order = [];
    rows.forEach(function (r) {
      var k = r.date + '|' + r[key];
      if (!by[k]) { by[k] = { date: r.date, who: r[key], v: {}, note: [] }; order.push(k); }
      if (r.value != null) by[k].v[r.item] = +r.value;
      else if (r.note) by[k].note.push((r.item === '泡' ? '泡' : '') + r.note);
    });
    var items = S.sub === 'feces' ? ['上段', '中段', '下段'] : ['上段', '中段', '下段', '受け皿'];
    var pts = items.map(function (it, i) {
      return { name: it, color: ['var(--spark2)', 'var(--spark)', 'var(--warn)', 'var(--muted)'][i],
               pts: order.filter(function (k) { return by[k].v[it] != null; }).map(function (k) { return { d: by[k].date, v: by[k].v[it] }; }) };
    });
    var chart = F.trend(pts, '%', function (d) { return d.slice(2, 4) + '/' + (+d.slice(5, 7)); });
    var t = '<div class="scroll"><table class="tbl"><thead><tr><th>日</th>' + items.map(function (i) { return '<th>' + i.slice(0, 2) + '</th>'; }).join('') +
      '<th>' + (S.sub === 'feces' ? '採取した牛・メモ' : '試料・メモ') + '</th></tr></thead><tbody>' +
      order.slice().reverse().map(function (k) {
        var x = by[k];
        return '<tr><td>' + F.day(x.date) + '</td>' + items.map(function (i) { return '<td>' + (x.v[i] != null ? F.n(x.v[i], 1) : '—') + '</td>'; }).join('') +
          '<td class="l small">' + F.esc(x.who) + (x.note.length ? '<br><span class="muted">' + F.esc(x.note.join(' / ')) + '</span>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    return F.box('これまで（%）', chart + t + F.src('糞洗い.xlsx のこれまでの分と、白川Farm で入れた分（PC が毎朝取り込んだもの）'));
  }

  // ---------- 体測の分析（2026-11-15 本人「過去の充足率の推移、測定日ごとの体重の推移などの分析、その日の分析も」） ----------
  // 1回の測定＝同じ日にはかった牛（体高BW では2か月ごとに40〜50頭）。体重は実測があれば実測、無ければ胸囲からの推定。
  // 充足率・推奨体重は PC が体高BW.xlsx の日増体の表から出したもの（哺乳アプリの実測には無い）。
  // 日増体＝同じ牛の前回の測定からの体重の増え÷日数（間が14日未満は使わない）。推奨の日増体＝推奨体重の増え÷日数
  var NL = String.fromCharCode(10);
  var G = { rows: null, day: null, quick: [] };
  function wOf(r) { return r.weight_actual != null ? +r.weight_actual : (r.weight_est != null ? +r.weight_est : null); }
  function moOf(days) { return days == null ? null : Math.round(days / 30.44 * 10) / 10; }
  function mdShort(d) { return (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)); }

  function growth() {
    var load = G.rows ? Promise.resolve(G.rows)
      : F.all('v_weight?select=cow_id,date,age_days,chest_cm,height_cm,weight_est,weight_actual,target_weight,ratio,source&order=date.asc');
    // まだ PC に取り込まれていない、スマホで入れた体測（速報。推奨・充足率は取り込み後）
    var quick = F.get('input_record?select=id,cow_id,date,data,deleted,entered_name&kind=eq.' + encodeURIComponent('体測') + '&deleted=eq.false&order=date.desc&limit=300')
      .catch(function () { return []; });
    Promise.all([load, quick]).then(function (r) {
      G.rows = r[0];
      var have = {};
      G.rows.forEach(function (x) { have[x.cow_id + '|' + x.date] = 1; });
      var s = Q.store(), local = Object.keys(s).map(function (k) { return s[k]; })
        .filter(function (x) { return x.table === TABLE && x.kind === '体測' && !x.deleted; });
      var ids = local.map(function (x) { return x.id; });
      G.quick = local.concat((r[1] || []).filter(function (x) { return ids.indexOf(x.id) < 0; }))
        .filter(function (x) { return x.cow_id && x.data && x.data.chest_cm && !have[x.cow_id + '|' + x.date]; });
      drawGrowth();
    }).catch(function (err) {
      var el = document.getElementById('gan');
      if (el) el.innerHTML = '<p class="msg err">体測の記録を読めませんでした（' + F.esc(err.message) + '）。</p>';
    });
  }

  // 牛ごとに並べて、前回からの日増体を付ける
  function withGain(rows) {
    var by = {};
    rows.forEach(function (r) { (by[r.cow_id] = by[r.cow_id] || []).push(r); });
    Object.keys(by).forEach(function (id) {
      var a = by[id].sort(function (p, q) { return p.date < q.date ? -1 : 1; }), prev = null;
      a.forEach(function (r) {
        r._w = wOf(r);
        r._dg = r._dgT = r._prev = null;
        if (prev && r._w != null && prev._w != null) {
          var dd = (Date.parse(r.date) - Date.parse(prev.date)) / 86400000;
          if (dd >= 14) {
            r._dg = (r._w - prev._w) / dd;
            r._prev = prev;
            if (r.target_weight != null && prev.target_weight != null) r._dgT = (r.target_weight - prev.target_weight) / dd;
          }
        }
        if (r._w != null) prev = r;
      });
    });
    return rows;
  }

  function median(a) { if (!a.length) return null; var b = a.slice().sort(function (p, q) { return p - q; }), m = (b.length - 1) / 2; return (b[Math.floor(m)] + b[Math.ceil(m)]) / 2; }

  function drawGrowth() {
    var el = document.getElementById('gan');
    if (!el || F.tabOf() !== 'record' || S.sub !== 'growth') return;
    var FT = window.FarmTrend, rows = withGain(G.rows.filter(function (r) { return wOf(r) != null; }));
    var byDate = {}, dates = [];
    rows.forEach(function (r) { if (!byDate[r.date]) { byDate[r.date] = []; dates.push(r.date); } byDate[r.date].push(r); });
    dates.sort();
    // 測定の日＝充足率のある日（体高BW・白川Farm）。哺乳アプリだけの日は 推移には入れない
    var sess = dates.filter(function (d) { return byDate[d].some(function (r) { return r.ratio != null; }); });
    var qd = {};
    G.quick.forEach(function (x) { qd[x.date] = (qd[x.date] || 0) + 1; });
    var pick = Object.keys(qd).concat(sess).sort().reverse();
    pick = pick.filter(function (d, i) { return pick.indexOf(d) === i; });
    if (!G.day || pick.indexOf(G.day) < 0) G.day = pick[0] || null;
    var html = '';

    // 1. 測定日ごとの充足率（箱ひげ）
    var last = sess.slice(-10);           // 10回（体高BW は2か月ごと＝およそ1年半）。横に送らず1枚に収まる数
    var tipOf = function (r) { var c = F.byId()[r.cow_id] || {}; return F.no(c).replace(/<[^>]*>/g, '') + '・' + F.n(moOf(r.age_days), 1) + 'か月・' + F.n(r._w, 0) + 'kg'; };
    html += F.box('測定日ごとの充足率（%）', last.length ? '<div class="scroll">' + FT.box(last.map(function (d) {
      var v = byDate[d].filter(function (r) { return r.ratio != null; }).map(function (r) { return { v: +r.ratio, tip: tipOf(r) }; });
      return { label: d.slice(2, 4) + '/' + (+d.slice(5, 7)), note: F.day(d), sets: [{ name: '充足率', color: 'var(--spark)', stat: FT.boxStat(v) }] };
    }), { unit: '%', ref: { v: 100, label: '充足率 100%（推奨体重どおり）' }, label: '測定日ごとの充足率' }) + '</div>' +
      '<p class="small muted">箱は真ん中の半分、太い線は中央値、点は飛び離れた牛（押すと牛）。横線は 100%。直近 ' + last.length + ' 回。</p>'
      : F.none('充足率のある記録がまだありません。'));

    // 2. 測定日ごとの日増体（前回の測定からの体重の増え）
    var dgDates = last.filter(function (d) { return byDate[d].some(function (r) { return r._dg != null; }); });
    if (dgDates.length) {
      var med = [];
      html += F.box('測定日ごとの日増体（kg/日・前回の測定から）', '<div class="scroll">' + FT.box(dgDates.map(function (d) {
        var a = byDate[d].filter(function (r) { return r._dg != null; });
        var t = median(a.filter(function (r) { return r._dgT != null; }).map(function (r) { return r._dgT; }));
        med.push(t);
        return { label: d.slice(2, 4) + '/' + (+d.slice(5, 7)), note: F.day(d) + (t != null ? '・推奨の中央値 ' + F.n(t, 2) : ''),
                 sets: [{ name: '日増体', color: 'var(--spark2)', stat: FT.boxStat(a.map(function (r) { return { v: Math.round(r._dg * 100) / 100, tip: tipOf(r) + '・前回 ' + F.day(r._prev.date) }; })) }] };
      }), { unit: 'kg/日', label: '測定日ごとの日増体' }) + '</div>' +
        '<p class="small muted">同じ牛の前回の測定との差÷日数（間が14日未満は使わない）。箱を押すと推奨の日増体（中央値）も出ます。</p>');
    }

    // 3. 測定日ごとの表
    html += F.box('測定日ごとのまとめ', '<div class="scroll"><table class="tbl"><thead><tr><th>測定日</th><th>頭数</th><th>月齢</th><th>体重 中央</th><th>充足率 中央</th><th>90%未満</th><th>日増体 中央</th><th>推奨</th></tr></thead><tbody>' +
      sess.slice().reverse().map(function (d) {
        var a = byDate[d], rt = a.filter(function (r) { return r.ratio != null; }).map(function (r) { return +r.ratio; });
        var g = a.filter(function (r) { return r._dg != null; }), ages = a.map(function (r) { return moOf(r.age_days); }).filter(function (x) { return x != null; });
        var low = rt.filter(function (v) { return v < 90; }).length, mr = median(rt);
        return '<tr data-gday="' + d + '"' + (d === G.day ? ' class="on"' : '') + '><td><a href="#" data-gday="' + d + '">' + F.day(d) + '</a></td><td>' + a.length + '</td><td>' +
          (ages.length ? F.n(Math.min.apply(null, ages), 0) + '〜' + F.n(Math.max.apply(null, ages), 0) : '—') + '</td><td>' + F.n(median(a.map(function (r) { return r._w; })), 0) + '</td>' +
          '<td' + (mr != null && mr < 95 ? ' class="hi"' : '') + '>' + F.n(mr, 1) + '</td><td' + (low ? ' class="hi"' : '') + '>' + low + '</td>' +
          '<td>' + (g.length ? F.n(median(g.map(function (r) { return r._dg; })), 2) : '—') + '</td>' +
          '<td>' + (g.length ? F.n(median(g.filter(function (r) { return r._dgT != null; }).map(function (r) { return r._dgT; })), 2) : '—') + '</td></tr>';
      }).join('') + '</tbody></table></div><p class="small muted">月齢は その日にはかった牛の幅。日付を押すと、その日の分析に切り替わります。</p>');

    // 4. その日の分析
    if (G.day) html += dayHtml(G.day, byDate[G.day] || []);
    html += F.src('体高BW（7.白川体高BW.xlsx・〜2026/10/10）と白川Farm の体測（PC が取り込んだもの）。推奨体重・充足率は体高BW.xlsx の日増体の表で PC が出す。哺乳アプリの実測は充足率が無いので推移には入れない');
    el.innerHTML = html;
    // 箱ひげは横に長いので、新しい日（右の端）から見せる
    [].forEach.call(el.querySelectorAll('.scroll'), function (sc) { if (sc.querySelector('.boxplot')) sc.scrollLeft = sc.scrollWidth; });
  }

  function dayHtml(d, list) {
    var FT = window.FarmTrend, q = G.quick.filter(function (x) { return x.date === d; });
    var opts = Object.keys(G.rows.reduce(function (o, r) { if (r.ratio != null) o[r.date] = 1; return o; }, {}))
      .concat(G.quick.map(function (x) { return x.date; })).sort().reverse();
    opts = opts.filter(function (x, i) { return opts.indexOf(x) === i; });
    var sel = '<div class="pickers"><label class="small muted" for="gday">測定日</label><select id="gday">' + opts.map(function (x) {
      return '<option value="' + x + '"' + (x === d ? ' selected' : '') + '>' + F.day(x) + '</option>';
    }).join('') + '</select></div>';
    var rt = list.filter(function (r) { return r.ratio != null; }).map(function (r) { return +r.ratio; });
    var g = list.filter(function (r) { return r._dg != null; });
    var stat = '<div class="stats">' +
      '<div class="stat"><div class="label">はかった牛</div><div class="val">' + (list.length + q.length) + '</div><div class="sub">頭' + (q.length ? '（うち速報 ' + q.length + '）' : '') + '</div></div>' +
      '<div class="stat"><div class="label">充足率 中央値</div><div class="val">' + (rt.length ? F.n(median(rt), 1) : '—') + '</div><div class="sub">%（' + rt.length + '頭）</div></div>' +
      '<div class="stat"><div class="label">90%未満</div><div class="val">' + rt.filter(function (v) { return v < 90; }).length + '</div><div class="sub">頭</div></div>' +
      '<div class="stat"><div class="label">日増体 中央値</div><div class="val">' + (g.length ? F.n(median(g.map(function (r) { return r._dg; })), 2) : '—') + '</div><div class="sub">kg/日（' + g.length + '頭）</div></div></div>';
    // 日齢と体重（その日）。推奨体重も並べる
    var pw = [], pt = [];
    list.forEach(function (r) {
      var m = moOf(r.age_days); if (m == null) return;
      var tip = tipOf2(r);
      pw.push({ x: m, y: r._w, tip: tip });
      if (r.target_weight != null) pt.push({ x: m, y: +r.target_weight, tip: tip });
    });
    q.forEach(function (x) {
      var c = F.byId()[x.cow_id] || {}, dd = c.birth_date ? (Date.parse(x.date) - Date.parse(c.birth_date)) / 86400000 : null;
      if (dd == null) return;
      pw.push({ x: moOf(dd), y: bw(+x.data.chest_cm), tip: F.no(c).replace(/<[^>]*>/g, '') + NL + '速報 胸囲 ' + x.data.chest_cm + 'cm・推定 ' + bw(+x.data.chest_cm) + 'kg' });
    });
    var chart = pw.length ? FT.xy([{ name: '体重', color: 'var(--spark)', pts: pw, line: false }, { name: '推奨体重', color: 'var(--spark2)', pts: pt, dash: true }],
      { xlab: '月齢（か月）', unit: 'kg', label: 'その日の体重と推奨' }) : '';
    // 牛ごとの表（充足率の低い順）
    var rowsH = list.slice().sort(function (a, b) { return (a.ratio == null ? 999 : a.ratio) - (b.ratio == null ? 999 : b.ratio); }).map(function (r) {
      var c = F.byId()[r.cow_id] || {}, pr = r._prev;
      return '<tr><td><a href="#/cow/' + r.cow_id + '">' + F.no(r.cow_id, c.mgmt_no) + '</a></td><td>' + F.n(moOf(r.age_days), 1) + '</td><td>' + F.n(r.chest_cm) + '</td>' +
        '<td>' + F.n(r._w, 0) + '</td><td>' + F.n(r.target_weight, 0) + '</td><td' + (r.ratio != null && r.ratio < 90 ? ' class="hi"' : '') + '>' + F.n(r.ratio, 1) + '</td>' +
        '<td>' + (pr && pr.ratio != null && r.ratio != null ? (r.ratio - pr.ratio >= 0 ? '+' : '') + F.n(r.ratio - pr.ratio, 1) : '—') + '</td>' +
        '<td' + (r._dg != null && r._dgT != null && r._dg < r._dgT * 0.9 ? ' class="hi"' : '') + '>' + (r._dg != null ? F.n(r._dg, 2) : '—') + '</td>' +
        '<td>' + (r._dgT != null ? F.n(r._dgT, 2) : '—') + '</td></tr>';
    }).join('') + q.map(function (x) {
      var c = F.byId()[x.cow_id] || {};
      return '<tr><td>' + F.no(x.cow_id, c.mgmt_no) + ' <span class="badge quick">速報</span></td><td>' + F.n(moOf(F.days(c.birth_date, x.date)), 1) + '</td><td>' + F.n(x.data.chest_cm) + '</td>' +
        '<td>' + F.n(bw(+x.data.chest_cm), 0) + '</td><td colspan="5" class="l small muted">推奨・充足率は PC の取り込み後</td></tr>';
    }).join('');
    return F.box('その日の分析（' + F.day(d) + '）', sel + stat + chart +
      '<div class="scroll"><table class="tbl"><thead><tr><th>牛</th><th>月齢</th><th>胸囲</th><th>体重</th><th>推奨</th><th>充足率</th><th>前回比</th><th>日増体</th><th>推奨</th></tr></thead><tbody>' +
      rowsH + '</tbody></table></div>' +
      '<p class="small muted">充足率の低い順。赤は 充足率 90% 未満、日増体が推奨の 9 割未満。前回比は前回の測定からの充足率の変化（ポイント）。体重は kg、日増体は kg/日。</p>');
  }
  function tipOf2(r) {
    var c = F.byId()[r.cow_id] || {};
    return F.no(c).replace(/<[^>]*>/g, '') + '・' + F.n(moOf(r.age_days), 1) + 'か月' + NL + '体重 ' + F.n(r._w, 0) + 'kg' +
      (r.target_weight != null ? '・推奨 ' + F.n(r.target_weight, 0) + 'kg' : '') + (r.ratio != null ? NL + '充足率 ' + F.n(r.ratio, 1) + '%' : '') +
      (r._dg != null ? NL + '日増体 ' + F.n(r._dg, 2) + 'kg/日（前回 ' + F.day(r._prev.date) + '）' : '');
  }
  function onGrowthClick(e) {
    var a = e.target.closest('[data-gday]');
    if (a) { e.preventDefault(); G.day = a.getAttribute('data-gday'); drawGrowth(); var b = document.getElementById('gday'); if (b) b.scrollIntoView({ block: 'start' }); }
  }
  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'gday') { G.day = e.target.value; drawGrowth(); }
  });

  window.RecordPage = {
    show: show,
    sent: function () { var el = document.getElementById('rmine'); if (el && F && F.tabOf() === 'record') el.innerHTML = mine(); }
  };
})();
