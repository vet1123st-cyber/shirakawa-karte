// 一生の年表。文字列はすべて既存Farm.escを通し、出典の違う記録を勝手に同一視しない。
(function () {
  'use strict';
  function rows(x) { return Array.isArray(x) ? x : []; }
  function card(c, d) {
    var F = window.Farm, issues = rows(d.issues);
    var info = issues.length ? '<div class="msg err">確認事項 ' + issues.length + '件<ul>' + issues.map(function (r) {
      return '<li>' + F.esc(r.category) + '：' + F.esc(r.detail) + '</li>';
    }).join('') + '</ul></div>' : '';
    return '<section class="box life" id="life" data-cow="' + F.esc(c.cow_id) + '"><h3>一生の年表</h3>' + info +
      '<p class="small muted">日付と分野を横断してたどれます。同じ出来事の別原票も残すため、件数は保存記録の数です。</p>' +
      '<div id="life-controls"></div><div id="life-charts"></div><p id="life-count" class="small" aria-live="polite"></p><div id="life-list"></div><button id="life-more" type="button" hidden>続きを表示</button></section>';
  }
  function bind(c, d) {
    var F = window.Farm, root = document.getElementById('life');
    if (!root || root.dataset.cow !== c.cow_id) return;
    function show(data) {
      if (!document.contains(root)) return;
      var list = rows(data), categories = {}, years = {}, limit = 30;
      list.forEach(function (r) { categories[r.category] = true; if (r.event_date) years[r.event_date.slice(0, 4)] = true; });
      var controls = root.querySelector('#life-controls');
      controls.innerHTML = '<label>分野<select id="life-category"><option value="">すべて</option>' + Object.keys(categories).sort().map(function (x) {
        return '<option value="' + F.esc(x) + '">' + F.esc(x) + '</option>';
      }).join('') + '</select></label><label>年<select id="life-year"><option value="">すべて</option>' + Object.keys(years).sort().map(function (x) {
        return '<option>' + F.esc(x) + '</option>';
      }).join('') + '<option value="unknown">日付不明</option></select></label><label>記録内を検索<input id="life-query" type="search" placeholder="病名・精液・記録内容など"></label><button type="button" class="ghost" id="life-csv">絞り込んだ全記録をCSVで保存</button>';
      function render() {
        var category = root.querySelector('#life-category').value, year = root.querySelector('#life-year').value;
        var query = root.querySelector('#life-query').value.trim().toLowerCase();
        var filtered = list.filter(function (r) {
          return (!category || r.category === category) && (!year || (year === 'unknown' ? !r.event_date : (r.event_date || '').slice(0, 4) === year)) &&
            (!query || (r.title + ' ' + r.detail + ' ' + r.source).toLowerCase().indexOf(query) >= 0);
        }).sort(function (a, b) { return (a.event_date || '9999').localeCompare(b.event_date || '9999') || a.event_key.localeCompare(b.event_key); });
        root.querySelector('#life-count').textContent = filtered.length + '記録 / 保存済み ' + list.length + '記録';
        root.querySelector('#life-charts').innerHTML = category === '発育' ? growthCharts(c, d) : '';
        root.querySelector('#life-csv').onclick = function () {
          var cols = ['cow_id','event_date','date_precision','category','title','detail','source','source_ref'];
          function cell(v) { var s = v == null ? '' : String(v); if (/^[=+@\-\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g,'""') + '"'; }
          var csv = '\ufeff' + [cols.join(',')].concat(filtered.map(function (r) { return cols.map(function (k) { return cell(r[k]); }).join(','); })).join('\r\n');
          var url = URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8'})), a = document.createElement('a');
          a.href = url; a.download = '白川_生涯カルテ_' + c.cow_id + '.csv'; a.click(); setTimeout(function () { URL.revokeObjectURL(url); },1000);
        };
        root.querySelector('#life-list').innerHTML = filtered.slice(0, limit).map(function (r) {
          var when = r.event_date || '日付不明';
          if (r.date_precision === '取込回') when += ' 保存回';
          return '<details class="life-event"><summary><span class="life-date">' + F.esc(when) + '</span><span>' + F.esc(r.title) + '</span>' +
            '<span class="small muted">' + F.esc(r.source) + '</span></summary><p>' + F.esc(r.detail || '値の記載はありません') + '</p>' +
            '<p class="small muted">出典：' + F.esc(r.source_ref) + '</p></details>';
        }).join('') || '<p class="muted">この条件に合う保存記録はありません。</p>';
        var more = root.querySelector('#life-more'); more.hidden = filtered.length <= limit;
        more.onclick = function () { limit += 50; render(); };
      }
      controls.onchange = controls.oninput = function () { limit = 30; render(); };
      render();
    }
    if (Array.isArray(d.life)) { show(d.life); return; }
    root.querySelector('#life-count').textContent = '年表を読み込んでいます…';
    // 古いRPCでも、年表の表があれば読み取る。1000行を超えても切らない。
    var out = [];
    function page(offset) {
      return F.get('cow_life?cow_id=eq.' + encodeURIComponent(c.cow_id) + '&order=event_date.asc,event_key.asc&limit=1000&offset=' + offset)
        .then(function (data) { out = out.concat(data); return data.length === 1000 ? page(offset + 1000) : out; });
    }
    page(0).then(show).catch(function () {
      if (document.contains(root)) root.querySelector('#life-count').textContent = '年表を読み込めませんでした。保存記録が無いとは限りません。接続と更新状況を確認してください。';
    });
  }
  // 発育のグラフ（2026-11-09 本人「発育を選ぶと体重の推移と推奨値との差が折れ線で」「ロボットで測った体重も、DIMごとの推移」）。
  // 体重は実測（哺乳アプリ）か胸囲からの推定（体高BW）。推奨値は体高BW.xlsx の日増体の表（その日齢の推奨）。点を押すと値
  function growthCharts(c, d) {
    var F = window.Farm, FT = window.FarmTrend, NL = String.fromCharCode(10);
    var birth = c.birth_date ? Date.parse(c.birth_date) : null;
    var mon = function (date) { return birth ? Math.round((Date.parse(date) - birth) / 86400000 / 30.44 * 10) / 10 : null; };
    var w = rows(d.weight).filter(function (r) { return r.date; }).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var html = '';
    if (!birth) html += '<p class="small muted">生年月日が分からないので、月齢のグラフは出せません。</p>';
    else if (w.length) {
      var bw = [], tg = [], df = [];
      w.forEach(function (r) {
        var kg = r.weight_actual != null ? +r.weight_actual : (r.weight_est != null ? +r.weight_est : null), m = mon(r.date);
        if (kg == null) return;
        var t = r.target_weight != null ? +r.target_weight : null, how = r.weight_actual != null ? '実測' : '胸囲から推定';
        var tip = r.date + '（' + F.n(m, 1) + 'か月）' + NL + '体重 ' + F.n(kg, 0) + ' kg（' + how + '・' + (r.source || '') + '）' +
          (t != null ? NL + '推奨 ' + F.n(t, 0) + ' kg・差 ' + (kg - t >= 0 ? '+' : '') + F.n(kg - t, 0) + ' kg（' + F.n(kg / t * 100, 0) + '%）' : '');
        bw.push({ x: m, y: kg, tip: tip });
        if (t != null) { tg.push({ x: m, y: t, tip: r.date + '（' + F.n(m, 1) + 'か月）' + NL + '推奨 ' + F.n(t, 0) + ' kg' }); df.push({ x: m, y: Math.round((kg - t) * 10) / 10, tip: tip }); }
      });
      html += '<h4 class="gh">体重と推奨値（月齢）</h4>' + FT.xy([{ name: '体重', color: 'var(--spark)', pts: bw }, { name: '推奨', color: 'var(--spark2)', pts: tg, dash: true }],
        { xlab: '月齢（か月）', unit: 'kg', label: '体重と推奨値' });
      if (df.length) html += '<h4 class="gh">推奨との差（kg・＋は推奨より重い）</h4>' + FT.xy([{ name: '推奨との差', color: 'var(--spark)', pts: df }],
        { xlab: '月齢（か月）', unit: 'kg', zero: true, label: '推奨との差' });
      else html += '<p class="small muted">推奨値のある記録（体高BW）がありません。</p>';
    } else html += '<p class="small muted">体測の記録はありません。</p>';
    var rb = rows(d.robot).filter(function (r) { return r.weight_kg != null && r.dim != null; });
    if (rb.length) {
      var colors = ['var(--spark)', 'var(--spark2)', '#7f9a4e', '#5f7c88', '#b04a6a', '#6a5fb0'], by = {};
      rb.forEach(function (r) { (by[r.parity] = by[r.parity] || []).push(r); });
      var ser = Object.keys(by).sort(function (a, b) { return a - b; }).map(function (p, i) {
        return { name: p + '産', color: colors[i % colors.length], pts: by[p].map(function (r) {
          return { x: +r.dim, y: +r.weight_kg, tip: r.date + NL + p + '産・分娩後 ' + r.dim + '日（DIM）' + NL + 'ロボット体重 ' + F.n(r.weight_kg, 0) + ' kg' };
        }) };
      });
      html += '<h4 class="gh">ロボット体重（分娩後の日数 DIM）</h4>' + FT.xy(ser, { xlab: '分娩後の日数（DIM）', unit: 'kg', label: 'ロボット体重' }) +
        '<p class="small muted">レリーのロボットが搾乳のたびに量った体重（1日1点）。' + rb.length + '日分・' + F.day(rb[0].date) + '〜' + F.day(rb[rb.length - 1].date) + '。</p>';
    }
    return html ? '<div class="growth">' + html + F.src('体高BW（7.白川体高BW.xlsx）・哺乳アプリ・レリー（ロボット）。点を押すと値が出ます') + '</div>' : '';
  }
  window.Lifetime = { card: card, bind: bind };
})();
