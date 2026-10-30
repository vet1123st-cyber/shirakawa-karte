// 牧場の歩み・対策と前後の変化・データの新しさ。
(function () {
  'use strict';
  var F, changes = [], feeds = [], months = [];
  var metrics = { robot_milk: 'ロボット日乳量', robot_rumination: '反芻時間', test_milk: '検定乳量', growth_ratio: '育成の推奨体重比', dry_fresh_milk:'乾乳期変更後のフレッシュ乳量（DIM0〜30）' };
  function array(x) { return Array.isArray(x) ? x : []; }
  function parse(x) { try { return JSON.parse(x || '{}'); } catch (e) { return {}; } }
  function show() {
    F = window.Farm;
    F.app.onclick = F.app.oninput = null;
    F.app.innerHTML = '<h2>牧場の歩み</h2><p>出来事と、対策の決定・実施・前後の変化をたどります。</p><p id="history-load">読み込んでいます…</p>';
    Promise.all(['farm_change?order=recorded_on.asc,start_date.asc,change_id.asc', 'data_feed_status?order=feed_id.asc',
      'farm_summary?section=eq.' + encodeURIComponent('牧場の歩み') + '&order=date.asc,key.asc'].map(function (p) {
      return F.all(p).catch(function (e) { return { _err: e.message }; });
    })).then(function (r) {
      if (F.tabOf() !== 'history') return;
      changes = array(r[0]); feeds = array(r[1]); months = array(r[2]);
      var errors = r.filter(function (x) { return x && x._err; });
      render(errors.length ? '一部を読み込めませんでした。保存記録が無いとは限りません。接続と更新状況を確認してください。' : '');
    });
  }
  function render(error) {
    var years = {};
    months.forEach(function (r) { if (r.date) years[r.date.slice(0, 4)] = true; });
    F.app.innerHTML = '<div id="rbar" class="rbar"></div>' + (error ? '<p class="msg err">' + F.esc(error) + '</p>' : '') +
      '<h2>牧場の歩み</h2><div class="box"><h3>月ごとの記録件数</h3><label>年<select id="history-year"><option value="">直近の記録</option>' +
      Object.keys(years).sort().reverse().map(function (y) { return '<option>' + F.esc(y) + '</option>'; }).join('') +
      '</select></label><div id="history-months"></div><p class="small muted">TAFや診療原票の収録記録数です。取得範囲と報告遅延の影響を受けます。</p></div>' +
      '<h2>対策と見直し</h2><p class="small muted">開始日・比較指標が確かめられた対策から、前後を比較します。記録日と実施開始日は別です。</p>' +
      (changes.map(changeCard).join('') || F.none('まだ対策記録がありません。')) + form() +
      '<h2>原票を調べる</h2><details class="box" id="source-lookup"><summary>日乳量・飼料分析・対応確認中の原票を検索する</summary><label>記録<select id="source-kind"><option value="daily_milk">日乳量</option><option value="feed_analysis">飼料分析</option><option value="unresolved">個体の対応を確認中の原票</option><option value="integration_issue">原票の相違・TAF旧番号の保留</option></select></label><label>年月・牛番号・飼料名・項目で絞り込み<input id="source-search" type="search"></label><button id="source-csv" type="button" class="ghost">表示対象をCSVで保存</button><div id="source-rows"></div></details>' +
      '<h2>データの新しさと接続</h2><div class="box">' + (feeds.map(function (r) {
        return '<div class="feed-status"><h3>' + F.esc(r.label) + '</h3><p>' + F.esc(r.state) + '</p><p class="small">最終記録：' + F.esc(r.record_date || '未確認') +
          '<br>取得：' + F.esc(r.fetched_at || '記録なし') + '<br>取込：' + F.esc(r.imported_at || '記録なし') +
          '<br>最終試行：' + F.esc(r.last_attempt || '記録なし') + '<br>処理結果：' + F.esc(r.last_result || '記録なし') +
          '<br>保存：' + F.n(r.rows) + (r.feed_id === 'plaud' ? '録音' : r.feed_id === 'feed' ? '項目' : '行') + (r.cows == null ? '' : '・' + F.n(r.cows) + '頭') + '</p><p class="small muted">' + F.esc(r.note) + '</p></div>';
      }).join('') || F.none('点検結果がまだありません。')) + '</div>';
    document.getElementById('history-year').onchange = monthTable;
    document.getElementById('change-form').onsubmit = save;
    document.getElementById('change-new').onclick = function () { var f = document.getElementById('change-form'); f.reset(); f.elements.change_id.value = ''; f.querySelector('[type="submit"]').disabled = false; document.getElementById('change-message').textContent = ''; };
    document.getElementById('source-lookup').ontoggle = function () { if (this.open) loadSource(); };
    document.getElementById('source-kind').onchange = loadSource;
    document.getElementById('source-search').oninput = sourceRows;
    document.getElementById('source-csv').onclick = exportSource;
    monthTable();
    changes.forEach(function (r) { var c = parse(r.comparison); var host = document.getElementById('plot-' + r.change_id); if (host) plot(host, c); });
    if (window.FarmQueue) window.FarmQueue.send();
  }
  var raw = [], rawKind = '', visible = [];
  function loadSource() {
    var kind = document.getElementById('source-kind').value;
    rawKind = kind; raw = []; document.getElementById('source-rows').textContent = '読み込んでいます…';
    F.all(kind + (kind === 'daily_milk' ? '?order=date.desc,metric.asc,source.asc' : kind === 'integration_issue' ? '?order=category.asc,issue_id.asc' : kind === 'unresolved' ? '?order=importer.asc,mgmt_no.asc,on_date.asc,id.asc' : '?order=taken_on.desc,sample_no.asc,item.asc,source.asc')).then(function (r) {
      if (F.tabOf() !== 'history' || rawKind !== kind) return;
      raw = array(r); sourceRows();
    }).catch(function () { var host = document.getElementById('source-rows'); if (host) host.textContent = '読み込めませんでした。記録が無いとは限りません。'; });
  }
  function sourceRows() {
    var query = document.getElementById('source-search').value.trim().toLowerCase();
    visible = raw.filter(function (r) { return JSON.stringify(r).toLowerCase().indexOf(query) >= 0; });
    var feed = rawKind === 'feed_analysis', pending = rawKind === 'unresolved', issue = rawKind === 'integration_issue';
    var cols = issue ? ['category','detail','source_ref','state'] : pending ? ['importer','mgmt_no','on_date','reason','raw'] : feed ? ['taken_on','sample_name','item','value','unit','source_ref'] : ['date','date_precision','metric','value','source_ref','year_basis'];
    var labels = issue ? ['確認の種類','内容','原文・根拠','状態'] : pending ? ['出どころ','原票の番号','記録日','確認事項','原文'] : feed ? ['採取日（原票）','サンプル','項目','値','単位','原票位置'] : ['日付・年','日付の精度','記録','値','原票位置','日付の根拠'];
    document.getElementById('source-rows').innerHTML = '<p class="small">' + visible.length + '行（画面は先頭200行、CSVは絞り込んだ全行）</p><div class="scroll"><table class="tbl"><thead><tr>' + labels.map(function (v) { return '<th>' + v + '</th>'; }).join('') + '</tr></thead><tbody>' + visible.slice(0,200).map(function (r) { return '<tr>' + cols.map(function (k) { var v = r[k]; if (k === 'taken_on' && v > window.FarmQueue.localDate()) v += '（未来日・要確認）'; if (issue && k === 'source_ref') return '<td><details><summary>原文を見る</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">' + F.esc(v || '') + '</pre></details></td>'; return '<td>' + F.esc(v == null ? (k === 'taken_on' ? '未記録' : '—') : v) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
  }
  function exportSource() {
    if (!visible.length) return;
    var cols = Object.keys(visible[0]).filter(function (k) { return k !== '_pk' && k !== 'farm_id'; });
    function cell(v) { var s = v == null ? '' : String(v); if (/^[=+@\-\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g,'""') + '"'; }
    var csv = '\ufeff' + [cols.map(cell).join(',')].concat(visible.map(function (r) { return cols.map(function (k) { return cell(r[k]); }).join(','); })).join('\r\n');
    var url = URL.createObjectURL(new Blob([csv], { type:'text/csv;charset=utf-8' }));
    var a = document.createElement('a'); a.href = url; a.download = (rawKind === 'integration_issue' ? '白川_原票の確認事項' : rawKind === 'unresolved' ? '白川_個体対応の確認待ち' : rawKind === 'daily_milk' ? '白川_日乳量' : '白川_飼料分析') + '.csv'; a.click(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function monthTable() {
    var y = document.getElementById('history-year').value;
    var records = months.filter(function (r) { return !y || (r.date || '').slice(0, 4) === y; });
    var by = {}; records.forEach(function (r) { var m = r.date.slice(0, 7); (by[m] || (by[m] = [])).push(r.key + ' ' + F.n(r.value) + '件'); });
    var keys = Object.keys(by).sort().reverse(); if (!y) keys = keys.slice(0, 12);
    document.getElementById('history-months').innerHTML = '<ul class="list">' + keys.map(function (k) {
      return '<li><b>' + F.esc(k) + '</b><br><span class="small">' + F.esc(by[k].join(' / ')) + '</span></li>';
    }).join('') + '</ul>';
  }
  function changeCard(r) {
    var c = parse(r.comparison), a = c.before, b = c.after, p = c.paired;
    return '<article class="box history-change"><h3>' + F.esc(r.title) + '</h3><p>' + F.esc(r.state) + ' / ' + F.esc(r.start_date || '開始日不明') +
      '</p>' + (r.recorded_on ? '<p class="small">記録日：' + F.esc(r.recorded_on) + '</p>' : '') + '<p>対象：' + F.esc(r.target || '未記録') + '</p>' + (r.problem ? '<p>問題：' + F.esc(r.problem) + '</p>' : '') +
      (r.action ? '<p>' + (r.state.indexOf('実施') === 0 ? '実施内容' : '内容・記録') + '：' + F.esc(r.action) + '</p>' : '') + '<p><b>' + F.esc(c.state || '比較未集計') + '</b></p>' +
      (a && b ? '<p class="small">' + (c.window_basis === '分娩日' ? '分娩日で区分：変更前 ' : '比較：実施前 ') + F.esc(c.from) + '～' + F.esc(previousDay(c.start)) + ' / 実施後 ' + F.esc(c.start) + '～' + F.esc(c.after_through || previousDay(c.to_exclusive)) + '（各' + c.window_days + '日枠）' + (c.as_of ? '<br>乳量の保存記録：' + F.esc(c.as_of) + 'まで' : '') + '</p>' : '') +
      (a && b ? '<dl class="kv"><dt>' + F.esc(c.label) + '</dt><dd>' + F.esc(c.unit) + '</dd><dt>実施前</dt><dd>' + F.n(a.mean, 1) + '・' + a.cows + '頭 / ' + a.days +
        '記録日・' + a.records + '測定' + (a.eligible_cows == null ? '' : '（対象' + a.eligible_cows + '頭）') + '</dd><dt>実施後</dt><dd>' + F.n(b.mean, 1) + '・' + b.cows + '頭 / ' + b.days + '記録日・' + b.records + '測定' + (b.eligible_cows == null ? '' : '（対象' + b.eligible_cows + '頭）') + '</dd><dt>' + F.esc(p && p.label || '同じ個体・区分の比較') + '</dt><dd>' +
        (p && p.cows ? F.n(p.difference, 1) + ' ' + F.esc(c.unit) + '・' + F.esc(p.description || p.cows + '頭') : '対応する記録が不足') + '</dd></dl>' : '') +
      '<div id="plot-' + F.esc(r.change_id) + '"></div>' + (a && b ? '<p class="small muted">' + F.esc(c.method) + '<br>' + F.esc((c.limitations || []).join('。')) + '</p>' : '') +
      (c.axis === 'dim' ? cohortTable(c) : '') +
      '<p class="small muted">出典：' + F.esc(r.source) + ' / ' + F.esc(r.source_ref || '') + '<br>' + F.esc(r.note || '') + '</p>' +
      '<button type="button" class="ghost history-edit" data-id="' + F.esc(r.change_id) + '">実施日・内容を追記</button></article>';
  }
  function previousDay(s) { return s ? new Date(Date.parse(s) - 86400000).toISOString().slice(0,10) : ''; }
  function cohortTable(c) {
    var all = array(c.before && c.before.cohort).map(function (r) { return Object.assign({period:'前'},r); }).concat(array(c.after && c.after.cohort).map(function (r) { return Object.assign({period:'後'},r); }));
    return '<details><summary>比較対象の牛と追跡状況</summary><div class="scroll"><table class="tbl"><thead><tr><th>群</th><th>牛</th><th>産次</th><th>乾乳日</th><th>分娩日</th><th>変更後の給与日数</th><th>観測</th><th>追跡</th></tr></thead><tbody>' + all.map(function (r) {
      return '<tr><td>' + r.period + '</td><td><a href="#/cow/' + F.esc(r.cow_id) + '">' + F.no(F.byId()[r.cow_id] || r.cow_id) + '</a></td><td>' + F.esc(r.parity) + '</td><td>' + F.esc(r.dry_date) + '</td><td>' + F.esc(r.calving_date) + '</td><td>' + F.esc(r.exposure_days) + '</td><td>' + F.esc(r.measurements) + '</td><td>' + (r.followup_complete ? 'DIM30経過' : '途中') + '</td></tr>';
    }).join('') + '</tbody></table></div><p class="small">分娩の記録を待つ乾乳牛 ' + array(c.waiting).length + '頭。日付・産次を確認中の記録 ' + array(c.held).length + '件。</p></details>';
  }
  function form() {
    return '<details class="box"><summary>出来事・対策を記録する</summary><form id="change-form" class="history-form">' +
      '<input type="hidden" name="change_id"><label>対策名・出来事<input name="title" type="text" required maxlength="200"></label>' +
      '<label>対象の牛・群・担当<input name="target" type="text" required></label><label>問題・狙い<textarea name="problem"></textarea></label>' +
      '<label>内容・実施内容<textarea name="action"></textarea></label><label>状態<select name="state"><option>提案</option><option>決定</option><option>観察・記録</option><option>実施</option><option>実施（開始日不明）</option></select></label>' +
      '<label>実施開始日（不明なら空欄）<input name="start_date" type="date"></label><label>比較する指標<select name="metric"><option value="">未設定</option>' +
      Object.keys(metrics).map(function (k) { return '<option value="' + k + '">' + metrics[k] + '</option>'; }).join('') + '</select></label>' +
      '<label>前後それぞれの日数<input name="window_days" type="number" min="7" max="730" value="30" required></label>' +
      '<label>比較するロボット群番号（全対象なら空欄）<input name="cohort_group" type="text"></label>' +
      '<label>根拠・同時に変えたこと・見直しメモ<textarea name="note"></textarea></label><button type="submit">記録を残す</button><button type="button" class="ghost" id="change-new">新しい記録を入力</button>' +
      '<p id="change-message" aria-live="polite"></p><p class="small muted">保存した内容は次回のPC取込後に年表と比較へ反映されます。</p></form></details>';
  }
  function save(e) {
    e.preventDefault(); var form = e.currentTarget, Q = window.FarmQueue, data = {};
    ['change_id', 'title', 'target', 'problem', 'action', 'state', 'start_date', 'metric', 'window_days', 'cohort_group', 'note'].forEach(function (k) { data[k] = form.elements[k].value.trim(); });
    if (data.state === '実施' && !data.start_date) { document.getElementById('change-message').textContent = '開始日を入れるか「実施（開始日不明）」を選んでください。'; return; }
    if (data.state.indexOf('実施') === 0 && data.start_date > Q.localDate()) { document.getElementById('change-message').textContent = '実施日は今日以前を選んでください。予定の場合は状態を「決定」にしてください。'; return; }
    var target = data.target; delete data.target; data.window_days = +data.window_days;
    if (!data.change_id) data.change_id = Q.uuid();
    var record = { table: 'input_record', id: Q.uuid(), date: Q.localDate(), kind: '牧場の出来事', target: target, data: data };
    try {
      Q.keep(record);
      if (!Q.store()[record.id]) throw new Error('端末の保存を確認できません');
    } catch (error) { document.getElementById('change-message').textContent = 'この端末に保存できませんでした。入力欄を残しています。画面を閉じず、端末の保存領域を確認してください。'; return; }
    form.elements.change_id.value = data.change_id;
    form.querySelector('[type="submit"]').disabled = true;
    Q.send(); document.getElementById('change-message').textContent = 'この端末に控えました。未送信の状態は画面上部で確認できます。';
  }
  function plot(host, c) {
    if (c.axis === 'dim') return dimPlot(host,c);
    var values = c.series || []; if (!values.length) return;
    var W = Math.max(250, host.clientWidth), H = 190, left = 54, right = 8, top = 14, bottom = 30;
    var xs = values.map(function (r) { return Date.parse(r.date); }), ys = values.map(function (r) { return r.value; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs); if (x1 === x0) x1 += 86400000;
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys), pad = Math.max((y1 - y0) * .15, .5); y0 -= pad; y1 += pad;
    function X(x) { return left + (x - x0) / (x1 - x0) * (W - left - right); }
    function Y(y) { return top + (y1 - y) / (y1 - y0) * (H - top - bottom); }
    var paths = [], path = ''; var gap = c.metric && c.metric.indexOf('robot_') === 0 ? 3 : c.metric === 'test_milk' ? 45 : 120;
    values.forEach(function (r, i) { var jump = i && xs[i] - xs[i - 1] > gap * 86400000; if (jump) { paths.push(path); path = ''; } path += (path ? 'L' : 'M') + X(xs[i]).toFixed(1) + ',' + Y(r.value).toFixed(1); }); paths.push(path);
    var s = '<svg style="display:block;width:100%;height:auto" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + F.esc(c.label + 'の観察値。欠けた長い期間は線をつなぎません') + '">';
    [0, .5, 1].forEach(function (v) { var y = y0 + (y1 - y0) * v; s += '<line x1="' + left + '" x2="' + (W - right) + '" y1="' + Y(y) + '" y2="' + Y(y) + '" stroke="var(--line)"/><text x="' + (left - 6) + '" y="' + (Y(y) + 4) + '" text-anchor="end" fill="var(--ink)" font-size="12">' + y.toFixed(1) + '</text>'; });
    paths.forEach(function (p) { s += '<path d="' + p + '" fill="none" stroke="var(--accent)" stroke-width="2"/>'; });
    values.forEach(function (r, i) { s += '<circle cx="' + X(xs[i]) + '" cy="' + Y(r.value) + '" r="3" fill="var(--accent)"><title>' + F.esc(r.date + ' ' + r.value.toFixed(1) + c.unit + ' / ' + r.n + '記録') + '</title></circle>'; });
    (values.length === 1 ? [0] : [0, values.length - 1]).forEach(function (i) { s += '<text x="' + X(xs[i]) + '" y="' + (H - 7) + '" text-anchor="' + (i ? 'end' : 'start') + '" fill="var(--ink)" font-size="12">' + F.esc(values[i].date) + '</text>'; });
    var start = Date.parse(c.start); if (start >= x0 && start <= x1) s += '<line x1="' + X(start) + '" x2="' + X(start) + '" y1="' + top + '" y2="' + (H - bottom) + '" stroke="var(--warn)" stroke-dasharray="4 3"><title>実施開始</title></line>';
    host.innerHTML = s + '</svg>';
  }
  function dimPlot(host,c) {
    var points=c.series || [], values=[];
    points.forEach(function(r){['before','after'].forEach(function(k){if(r[k]!=null)values.push(r[k]);});});
    if(!values.length){host.textContent='有効な乳量記録がまだありません。';return;}
    var W=Math.max(250,host.clientWidth),H=210,L=46,R=10,T=16,B=35;
    var lo=Math.min.apply(null,values),hi=Math.max.apply(null,values),pad=Math.max(.5,(hi-lo)*.15);lo=Math.max(0,lo-pad);hi+=pad;
    function X(v){return L+v/30*(W-L-R);}function Y(v){return T+(hi-v)/(hi-lo)*(H-T-B);}
    var svg='<svg style="display:block;width:100%;height:auto" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="分娩後の日数ごとの乳量。変更前と変更後の分娩群の観察値">';
    [0,.5,1].forEach(function(f){var y=lo+(hi-lo)*f;svg+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+Y(y)+'" y2="'+Y(y)+'" stroke="var(--line)"/><text x="'+(L-5)+'" y="'+(Y(y)+4)+'" text-anchor="end" fill="var(--ink)" font-size="12">'+y.toFixed(1)+'</text>';});
    [{key:'before',name:'変更前の分娩群',color:'var(--spark)'},{key:'after',name:'変更後の分娩群',color:'var(--spark2)'}].forEach(function(s){
      var path='';points.forEach(function(r){if(r[s.key]==null){if(path)svg+='<path d="'+path+'" fill="none" stroke="'+s.color+'" stroke-width="2"/>';path='';return;}path+=(path?'L':'M')+X(r.dim).toFixed(1)+','+Y(r[s.key]).toFixed(1);});
      if(path)svg+='<path d="'+path+'" fill="none" stroke="'+s.color+'" stroke-width="2"/>';
      points.forEach(function(r){if(r[s.key]!=null)svg+='<circle cx="'+X(r.dim)+'" cy="'+Y(r[s.key])+'" r="3" fill="'+s.color+'"><title>'+F.esc(s.name+' DIM'+r.dim+' '+r[s.key].toFixed(1)+'kg / '+r['n_'+s.key]+'頭')+'</title></circle>';});
    });
    [0,10,20,30].forEach(function(d){svg+='<text x="'+X(d)+'" y="'+(H-12)+'" fill="var(--ink)" font-size="12" text-anchor="'+(d===0?'start':d===30?'end':'middle')+'">DIM '+d+'</text>';});
    host.innerHTML='<p class="small"><span style="color:var(--spark)">●変更前の分娩群</span>　<span style="color:var(--spark2)">●変更後の分娩群</span></p>'+svg+'</svg><p class="small muted">図は各DIMの観察平均。産次をそろえた補助比較は上の数値です。欠測は線をつなぎません。</p>';
  }
  document.addEventListener('click', function (e) {
    var button = e.target.closest('.history-edit'); if (!button) return;
    var r = changes.filter(function (x) { return x.change_id === button.dataset.id; })[0]; if (!r) return;
    var form = document.getElementById('change-form'); form.closest('details').open = true;
    form.querySelector('[type="submit"]').disabled = false;
    ['change_id', 'title', 'target', 'problem', 'action', 'start_date', 'metric', 'window_days', 'cohort_group', 'note'].forEach(function (k) { form.elements[k].value = r[k] || ''; });
    form.elements.state.value = ['提案','決定','観察・記録','実施','実施（開始日不明）'].indexOf(r.state)>=0 ? r.state : r.state.indexOf('実施')===0 ? (r.start_date ? '実施' : '実施（開始日不明）') : '観察・記録'; form.scrollIntoView({ block: 'start' });
  });
  window.HistoryPage = { show: show };
})();
