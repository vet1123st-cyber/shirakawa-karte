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
  var SUBS = [['body', '体測', '#/record'], ['bcs', 'BCS・RFS', '#/record/bcs'],
              ['feces', '糞洗い', '#/record/feces'], ['psps', 'PSPS', '#/record/psps']];
  var KIND = { body: '体測', bcs: 'BCS・RFS', feces: '糞洗い', psps: 'PSPS' };
  var SAMPLES = ['TMR（搾乳）', 'TMR（乾乳・育成）', '残飼', '草・サイレージ'];
  var S = { sub: 'body', cow: null, data: {}, sample: SAMPLES[0] };

  function bw(chest) { return Math.round((0.0234 * chest * chest - 2.281 * chest + 75.618) * 10) / 10; }
  function today() { return Q.localDate(); }
  function subOf(hash) { var m = hash.match(/^#\/record\/(\w+)/); return m && KIND[m[1]] ? m[1] : 'body'; }

  function show(hash) {
    F = window.Farm;
    Q = window.FarmQueue;
    var sub = subOf(hash);
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
    history();
  }

  // ---------- 牛ごと（体測・BCS／RFS） ----------
  function cowForm() {
    var led = S.cow ? (F.byId()[S.cow] || {}) : null;
    var d = S.data, html = '';
    html += F.box('牛', led
      ? '<p><b class="big">' + F.no(led) + '</b> <span class="small muted">' + F.esc(led.name || '') + '・' +
        ageText(led.birth_date) + '</span> <button type="button" class="link" data-clear="1">別の牛</button></p><div id="cprev"></div>'
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
      '<button type="button" class="wide" data-save="1">残す（次の牛へ）</button>';
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
    return '<div class="field" data-field="' + k + '"><label>' + F.esc(label) + '</label><input type="number" inputmode="decimal" step="0.1" data-text="' + k +
      '" value="' + F.esc(v == null ? '' : v) + '"></div>';
  }
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
      body: S.cow ? 'v_weight?select=date,chest_cm,weight_est,ratio,source&cow_id=eq.' + S.cow + '&order=date.desc&limit=6' : null,
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
    return '<ul class="list">' + rows.map(function (r) {
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

  window.RecordPage = {
    show: show,
    sent: function () { var el = document.getElementById('rmine'); if (el && F && F.tabOf() === 'record') el.innerHTML = mine(); }
  };
})();
