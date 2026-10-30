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
      '<div id="life-controls"></div><p id="life-count" class="small" aria-live="polite"></p><div id="life-list"></div><button id="life-more" type="button" hidden>続きを表示</button></section>';
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
  window.Lifetime = { card: card, bind: bind };
})();
