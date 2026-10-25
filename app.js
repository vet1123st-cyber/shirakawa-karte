// 個体カルテ — 4桁を打つと、その牛の「いま」と「これまで」が1枚で出る。
//
// データはクラウドの箱（Supabase）から読むだけ。箱は PC の farm.db の写しで、毎朝 PC が送っている。
// 読めるのは、箱の「牧場の人」（farm_member）に入っている人だけ（箱の側の鍵＝RLS で守っている）。
//
// 外から何も読み込まない（ライブラリ無し）。Supabase とは fetch で直接話す:
//   ログイン      POST /auth/v1/token?grant_type=password
//   続けて使う    POST /auth/v1/token?grant_type=refresh_token（1時間で切れる通行証を取り直す）
//   表を読む      GET  /rest/v1/<表>?cow_id=eq.…   （通行証を Authorization に付ける）
//   招待・パスワード忘れのメールのリンク → このページに #access_token=…&type=invite|recovery で戻ってくる
//
// 画面に出す数字は、必ず「どこから来たか」を下に小さく書く（設計書v1「数字の出どころが分かること」）。

(function () {
  'use strict';

  var CFG = window.KARTE || {};
  var KEY = 'karte.session.v1';
  var app = document.getElementById('app');
  var who = document.getElementById('who');
  var cows = null;            // 台帳（ログイン後に1回だけ全頭読む。528頭で約40KB）
  var byId = {};

  // ------------------------------------------------------------ 箱と話す
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* 控えが無くても使える */ } }
  function forget() { try { localStorage.removeItem(KEY); } catch (e) { /* 同上 */ } }

  function keep(body) {
    var s = {
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      expires_at: body.expires_at || (Math.floor(Date.now() / 1000) + (body.expires_in || 3600)),
      email: (body.user && body.user.email) || (load() || {}).email || ''
    };
    save(s);
    return s;
  }

  function call(method, path, body, token) {
    var h = { apikey: CFG.key, 'Content-Type': 'application/json' };
    if (token) h.Authorization = 'Bearer ' + token;
    return fetch(CFG.url + path, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) {
        return r.text().then(function (t) {
          var j = null;
          try { j = t ? JSON.parse(t) : null; } catch (e) { j = { message: t }; }
          if (!r.ok) {
            var m = (j && (j.error_description || j.msg || j.message || j.error)) || ('HTTP ' + r.status);
            var err = new Error(m);
            err.status = r.status;
            throw err;
          }
          return j;
        });
      });
  }

  function signIn(email, password) {
    return call('POST', '/auth/v1/token?grant_type=password', { email: email, password: password }).then(keep);
  }

  // 通行証は1時間で切れる。切れる1分前か、切れていたら取り直す
  function session() {
    var s = load();
    if (!s) return Promise.resolve(null);
    if (s.expires_at - 60 > Date.now() / 1000) return Promise.resolve(s);
    return call('POST', '/auth/v1/token?grant_type=refresh_token', { refresh_token: s.refresh_token })
      .then(keep)
      .catch(function () { forget(); return null; });
  }

  function get(path) {
    return session().then(function (s) {
      if (!s) throw Object.assign(new Error('ログインが切れました'), { status: 401 });
      return call('GET', '/rest/v1/' + path, null, s.access_token);
    });
  }

  // ------------------------------------------------------------ 小さな道具
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function n(v, d) {
    if (v == null || v === '' || isNaN(+v)) return '—';
    return (+v).toFixed(d == null ? 0 : d);
  }
  function day(s) { return s ? String(s).slice(0, 10).replace(/-/g, '/') : '—'; }
  function md(s) { if (!s) return '—'; var p = String(s).slice(0, 10).split('-'); return (+p[1]) + '/' + (+p[2]); }
  function days(a, b) {   // a から b まで何日（b を省くと今日）
    if (!a) return null;
    var t0 = Date.parse(String(a).slice(0, 10));
    var t1 = b ? Date.parse(String(b).slice(0, 10)) : Date.now();
    return Math.floor((t1 - t0) / 86400000);
  }
  function months(birth, on) { var d = days(birth, on); return d == null ? null : d / 30.4375; }
  function id10(c) { return c ? c.slice(0, 5) + '-' + c.slice(5, 9) + '-' + c.slice(9) : ''; }
  function avg(a) { var x = a.filter(function (v) { return v != null && v !== ''; }).map(Number); return x.length ? x.reduce(function (s, v) { return s + v; }, 0) / x.length : null; }
  function src(text) { return '<div class="src">出どころ: ' + esc(text) + '</div>'; }
  function box(title, inner) { return '<section class="box"><h3>' + esc(title) + '</h3>' + inner + '</section>'; }
  function none(text) { return '<p class="none">' + esc(text) + '</p>'; }

  function spark(values, color) {
    var pts = values.map(function (v, i) { return [i, v]; }).filter(function (p) { return p[1] != null && p[1] !== ''; });
    if (pts.length < 2) return '';
    var ys = pts.map(function (p) { return +p[1]; });
    var lo = Math.min.apply(null, ys), hi = Math.max.apply(null, ys);
    if (hi === lo) { hi += 1; lo -= 1; }
    var W = 300, H = 60, last = values.length - 1 || 1;
    var d = pts.map(function (p, i) {
      return (i ? 'L' : 'M') + (p[0] / last * W).toFixed(1) + ' ' + (H - 4 - (p[1] - lo) / (hi - lo) * (H - 8)).toFixed(1);
    }).join(' ');
    return '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>';
  }

  // ------------------------------------------------------------ 画面: ログイン
  function showLogin(msg, isErr) {
    who.innerHTML = '';
    app.innerHTML =
      '<form class="form" id="f">' +
      '<p>白川牧場の個体カルテです。招待されたメールアドレスとパスワードで入ってください。</p>' +
      '<label for="em">メールアドレス</label><input id="em" type="email" autocomplete="username" required>' +
      '<label for="pw">パスワード</label><input id="pw" type="password" autocomplete="current-password" required>' +
      '<button type="submit">ログイン</button>' +
      (msg ? '<div class="msg ' + (isErr ? 'err' : 'ok') + '">' + esc(msg) + '</div>' : '') +
      '<button type="button" class="link" id="forgot">パスワードを忘れた</button>' +
      '</form>';
    var em = document.getElementById('em');
    em.value = (load() || {}).email || '';
    document.getElementById('f').onsubmit = function (e) {
      e.preventDefault();
      var b = e.target.querySelector('button[type=submit]');
      b.disabled = true;
      signIn(em.value.trim(), document.getElementById('pw').value)
        .then(function () { cows = null; route(); })
        .catch(function (err) {
          showLogin(/invalid/i.test(err.message) ? 'メールアドレスかパスワードが違います。' : 'ログインできませんでした（' + err.message + '）', true);
        });
    };
    document.getElementById('forgot').onclick = function () {
      var e = em.value.trim();
      if (!e) { showLogin('上にメールアドレスを入れてから押してください。', true); return; }
      var back = location.origin + location.pathname;
      call('POST', '/auth/v1/recover?redirect_to=' + encodeURIComponent(back), { email: e })
        .then(function () { showLogin('パスワードを決め直すメールを送りました。メールのリンクから開いてください。'); })
        .catch(function (err) { showLogin('送れませんでした（' + err.message + '）', true); });
    };
  }

  // 招待・パスワード忘れのメールから来たとき
  function showSetPassword(kind) {
    app.innerHTML =
      '<form class="form" id="f">' +
      '<p>' + (kind === 'invite' ? 'ようこそ。はじめに、この画面で使うパスワードを決めてください。' : '新しいパスワードを決めてください。') + '</p>' +
      '<label for="pw">パスワード（8文字以上）</label><input id="pw" type="password" autocomplete="new-password" minlength="8" required>' +
      '<label for="pw2">もう一度</label><input id="pw2" type="password" autocomplete="new-password" minlength="8" required>' +
      '<button type="submit">決める</button><div id="m"></div></form>';
    document.getElementById('f').onsubmit = function (e) {
      e.preventDefault();
      var a = document.getElementById('pw').value, b = document.getElementById('pw2').value;
      var m = document.getElementById('m');
      if (a !== b) { m.innerHTML = '<div class="msg err">2つのパスワードが違います。</div>'; return; }
      session().then(function (s) {
        return call('PUT', '/auth/v1/user', { password: a }, s && s.access_token);
      }).then(function () { location.hash = '#/'; route(); })
        .catch(function (err) { m.innerHTML = '<div class="msg err">決められませんでした（' + esc(err.message) + '）</div>'; });
    };
  }

  function showWho(s) {
    who.innerHTML = esc(s.email || '') + '<button class="ghost" id="out">ログアウト</button>';
    document.getElementById('out').onclick = function () {
      var t = s.access_token;
      forget();
      cows = null;
      call('POST', '/auth/v1/logout', {}, t).catch(function () { /* 消えていてもよい */ });
      showLogin('ログアウトしました。');
    };
  }

  // ------------------------------------------------------------ 画面: さがす
  function loadCows() {
    if (cows) return Promise.resolve(cows);
    return get('cow?select=cow_id,mgmt_no,name,birth_date,status,status_date,sex,breed,dam_cow_id,dam_mgmt_no,sire_name_raw&order=mgmt_no.asc')
      .then(function (rows) {
        cows = rows || [];
        byId = {};
        cows.forEach(function (c) { byId[c.cow_id] = c; });
        return cows;
      });
  }

  function find(q) {
    q = (q || '').replace(/\D/g, '');
    if (!q) return [];
    var hit = cows.filter(function (c) {
      return (c.mgmt_no || '').indexOf(q) === 0 || (q.length >= 5 && c.cow_id.indexOf(q) >= 0);
    });
    // 4桁が同じ牛（使い回し）が並ぶときは、いま居る牛を先頭に。居ない牛は新しい順
    hit.sort(function (a, b) {
      var ea = a.mgmt_no === q ? 0 : 1, eb = b.mgmt_no === q ? 0 : 1;
      if (ea !== eb) return ea - eb;
      var sa = a.status === '在籍' ? 0 : 1, sb = b.status === '在籍' ? 0 : 1;
      if (sa !== sb) return sa - sb;
      if (sa === 0) return (a.mgmt_no || '').localeCompare(b.mgmt_no || '');
      return (b.birth_date || '').localeCompare(a.birth_date || '');
    });
    return hit.slice(0, 30);
  }

  function hitRow(c) {
    var here = c.status === '在籍';
    return '<li><a href="#/cow/' + c.cow_id + '"' + (here ? '' : ' class="gone"') + '>' +
      '<span class="no">' + esc(c.mgmt_no || '----') + '</span><span>' +
      (here ? '' : '<span class="small">' + esc(id10(c.cow_id)) + (c.name ? '・' : '') + '</span>') +
      esc(c.name || '') + '<br><span class="small muted">' + day(c.birth_date) + '生・' +
      (here ? '在籍' : '居ない（' + (c.status_date ? day(c.status_date) + 'ごろまで' : '時期不明') + '）') +
      '</span></span></a></li>';
  }

  function showSearch() {
    app.innerHTML =
      '<div class="search"><input id="q" type="search" inputmode="numeric" pattern="[0-9]*" ' +
      'placeholder="4桁" autocomplete="off" aria-label="牛の4桁の番号"></div><ul class="hits" id="hits"></ul>' +
      '<p class="small muted" id="cnt"></p>';
    var q = document.getElementById('q');
    var hits = document.getElementById('hits');
    var here = cows.filter(function (c) { return c.status === '在籍'; }).length;
    document.getElementById('cnt').textContent = '台帳 ' + cows.length + ' 頭（在籍 ' + here + ' 頭）。4桁の一部でも出ます。';
    // 候補の欄だけを差し替える。画面ぜんぶを描き直すと入力欄が外れて続けて打てない
    q.oninput = function () { hits.innerHTML = find(q.value).map(hitRow).join(''); };
    q.onkeydown = function (e) {
      if (e.key === 'Enter') {
        var h = find(q.value);
        if (h.length) location.hash = '#/cow/' + h[0].cow_id;
      }
    };
    q.value = sessionStorage.getItem('karte.q') || '';
    q.addEventListener('input', function () { try { sessionStorage.setItem('karte.q', q.value); } catch (e) { /* なくてもよい */ } });
    q.oninput();
    q.focus();
  }

  // ------------------------------------------------------------ 画面: 1頭のカルテ
  function showCow(id) {
    var c = byId[id];
    if (!c) { app.innerHTML = '<a class="back" href="#/">← さがす</a>' + none('この牛は台帳にありません。'); return; }
    app.innerHTML = '<a class="back" href="#/">← さがす</a><p class="muted">' + esc(c.mgmt_no) + ' を読んでいます…</p>';
    var q = 'cow_id=eq.' + encodeURIComponent(id);
    var want = {
      roster: 'roster?' + q + '&order=snap_date.desc',
      robot: 'robot_milking?' + q + '&select=date,milk_kg,rumination_min,milkings_recent,weight_kg,group_no,dim,parity,pregnant_days,robot&order=date.asc',
      milk: 'v_milk_test?' + q + '&order=ym.desc&limit=12',
      lact: 'v_lactation?' + q + '&order=parity.asc',
      calv: 'calving?' + q + '&order=date.asc',
      repro: 'v_repro?' + q + '&order=date.desc',
      health: 'v_health?' + q + '&order=date.desc',
      birth: 'v_birth?' + q,
      births: 'birth?' + q + '&select=birth_weight,source',
      colos: 'colostrum?' + q + '&order=date.asc',
      feed: 'milk_feed?' + q + '&select=date,volume_l&order=date.asc',
      weight: 'v_weight?' + q + '&order=date.asc',
      genome: 'v_genome?' + q,
      ginfo: 'v_genome_info?' + q,
      sale: 'sale?' + q + '&order=date.asc'
    };
    var names = Object.keys(want);
    Promise.all(names.map(function (k) { return get(want[k]).catch(function (e) { return { _err: e.message }; }); }))
      .then(function (res) {
        if (location.hash !== '#/cow/' + id) return;     // 読んでいる間に別の牛へ移った
        var d = {};
        names.forEach(function (k, i) { d[k] = res[i]; });
        // どれか読めなかったら、上にはっきり出す（空の欄を「記録が無い」と読み違えないように）
        var bad = names.filter(function (k) { return d[k] && d[k]._err; });
        app.innerHTML = '<a class="back" href="#/">← さがす</a>' +
          (bad.length ? '<p class="msg err">一部が読めませんでした（' + esc(bad.join('・')) + '）。開き直してください。</p>' : '') +
          card(c, d);
        window.scrollTo(0, 0);
      });
  }

  function rows(x) { return Array.isArray(x) ? x : []; }
  function failed(x) { return x && x._err ? '<p class="msg err">読めませんでした（' + esc(x._err) + '）</p>' : ''; }

  function card(c, d) {
    var ro = rows(d.roster)[0] || null;
    var robot = rows(d.robot);
    var rLast = robot[robot.length - 1] || null;
    var parity = ro && ro.parity != null ? ro.parity : (rLast ? rLast.parity : null);
    var here = c.status === '在籍';
    var age = months(c.birth_date);
    var chips = [
      '<span class="chip ' + (here ? 'on' : 'out') + '">' + (here ? '在籍' : '居ない' + (c.status_date ? '（' + day(c.status_date) + 'ごろ）' : '')) + '</span>',
      parity != null && parity !== '' ? '<span class="chip">' + esc(parity) + '産</span>' : '<span class="chip">未経産</span>',
      age != null ? '<span class="chip">' + n(age, 1) + 'か月</span>' : '',
      rLast && rLast.group_no ? '<span class="chip">群 ' + esc(rLast.group_no) + '</span>' : '',
      c.sex && c.sex !== '♀' && c.sex !== '雌' ? '<span class="chip">' + esc(c.sex) + '</span>' : '',
      c.breed && !/ホル/.test(c.breed) ? '<span class="chip">' + esc(c.breed) + '</span>' : ''
    ];
    rows(d.sale).forEach(function (s) {
      chips.push('<span class="chip out">' + esc(s.kind) + ' ' + day(s.date) + '</span>');
    });
    var out = '<div class="head"><div class="no">' + esc(c.mgmt_no || '----') + '</div>' +
      '<div class="id">' + esc(id10(c.cow_id)) + '・' + day(c.birth_date) + '生</div>' +
      (c.name ? '<div class="name">' + esc(c.name) + '</div>' : '') +
      '<div class="chips">' + chips.join('') + '</div></div>';

    // 搾ったことのない牛（未経産）に、空のロボットと乳検の欄は出さない
    var heifer = (parity == null || parity === '' || +parity === 0) && !robot.length && !rows(d.milk).length && !failed(d.robot) && !failed(d.milk);
    out += '<h2>いま</h2>';
    if (!heifer) out += robotBox(robot, d.robot);
    out += reproBox(c, ro, rows(d.repro), rows(d.calv), heifer);
    if (!heifer) out += milkBox(d.milk);
    out += healthBox(d.health);
    out += calvBox(c, d.calv);
    out += '<h2>これまで</h2>';
    out += birthBox(c, rows(d.birth)[0], rows(d.births), rows(d.colos), rows(d.feed));
    out += growthBox(c, d.weight);
    out += firstBox(c, rows(d.roster), rows(d.repro), rows(d.calv));
    out += lactBox(d.lact);
    out += genomeBox(rows(d.genome), rows(d.ginfo)[0]);
    out += saleBox(d.sale);
    return out;
  }

  function robotBox(robot, raw) {
    if (!robot.length) return box('ロボット（日乳量・反芻）', failed(raw) || none('レリーの記録がありません（搾乳していない牛か、9/15より前のことです）。'));
    var last = robot[robot.length - 1];
    var milk = robot.map(function (r) { return r.milk_kg; });
    var rum = robot.map(function (r) { return r.rumination_min; });
    var w7 = robot.slice(-7), p7 = robot.slice(-14, -7);
    var m7 = avg(w7.map(function (r) { return r.milk_kg; }));
    var mp = avg(p7.map(function (r) { return r.milk_kg; }));
    var diff = m7 != null && mp != null ? m7 - mp : null;
    var inner =
      '<div class="stats">' +
      stat('日乳量', n(last.milk_kg, 1), 'kg・' + md(last.date)) +
      stat('7日平均', n(m7, 1), diff == null ? 'kg' : 'kg（前の7日より ' + (diff >= 0 ? '+' : '') + n(diff, 1) + '）') +
      stat('反芻', n(last.rumination_min), '分・7日 ' + n(avg(w7.map(function (r) { return r.rumination_min; }))) + '分') +
      '</div>' +
      '<div class="small muted" style="margin-top:8px">日乳量（' + md(robot[0].date) + '〜' + md(last.date) + '）</div>' + spark(milk, 'var(--spark)') +
      '<div class="small muted">反芻</div>' + spark(rum, 'var(--spark2)') +
      '<dl class="kv" style="margin-top:6px">' +
      '<dt>搾乳回数</dt><dd>' + n(last.milkings_recent, 1) + ' 回/日</dd>' +
      (last.weight_kg != null ? '<dt>体重（ロボット）</dt><dd>' + n(last.weight_kg) + ' kg</dd>' : '') +
      '<dt>泌乳日数</dt><dd>' + n(last.dim) + ' 日</dd>' +
      (last.robot ? '<dt>ロボット</dt><dd>' + esc(last.robot) + '</dd>' : '') +
      '</dl>' + src('レリー「搾乳可能牛」（毎朝）・' + robot.length + '日ぶん');
    return box('ロボット（日乳量・反芻）', inner);
  }

  function stat(label, val, sub) {
    return '<div class="stat"><div class="label">' + esc(label) + '</div><div class="val">' + esc(val) + '</div><div class="sub">' + esc(sub) + '</div></div>';
  }

  function reproBox(c, ro, repro, calv, heifer) {
    var lastCalv = (ro && ro.last_calving) || (calv.length ? calv[calv.length - 1].date : null);
    var since = repro.filter(function (r) { return !lastCalv || r.date > lastCalv; });
    var inner = '<dl class="kv">';
    if (lastCalv) inner += '<dt>最新分娩</dt><dd>' + day(lastCalv) + '（分娩後 ' + days(lastCalv) + ' 日）</dd>';
    if (ro && ro.last_ai) inner += '<dt>最新授精</dt><dd>' + day(ro.last_ai) + '（' + days(ro.last_ai) + ' 日前）' + (ro.ai_code ? ' ' + esc(ro.ai_code) : '') + '</dd>';
    inner += '<dt>' + (heifer ? '授精（記録にある分）' : '今の産次の授精') + '</dt><dd>' + since.length + ' 回</dd>';
    if (ro && (ro.preg_check || ro.preg_result)) inner += '<dt>妊鑑</dt><dd>' + day(ro.preg_check) + ' ' + esc(ro.preg_result || '') + '</dd>';
    if (ro && ro.due_date) inner += '<dt>分娩予定</dt><dd>' + day(ro.due_date) + '（あと ' + (-days(ro.due_date)) + ' 日）</dd>';
    if (ro && ro.dry_due) inner += '<dt>乾乳予定</dt><dd>' + day(ro.dry_due) + '</dd>';
    inner += '</dl>';
    if (since.length) {
      inner += '<ul class="list" style="margin-top:6px">' + since.slice(0, 6).map(function (r) {
        return '<li><span class="d">' + day(r.date) + '</span>　' + esc(r.type || '') + ' ' + esc(r.sire_raw || '') + (r.result ? '　<b>' + esc(r.result) + '</b>' : '') + '</li>';
      }).join('') + '</ul>';
    }
    inner += src('TAF 在籍牛一覧' + (ro ? '（' + day(ro.snap_date) + '）' : '（載っていない）') + '・授精は在籍牛一覧と分娩記録');
    return box('繁殖', inner);
  }

  function milkBox(raw) {
    var m = rows(raw);
    if (!m.length) return box('乳検', failed(raw) || none('乳検の記録がありません。'));
    var t = '<div class="scroll"><table class="tbl"><thead><tr><th>月</th><th>日数</th><th>乳量</th><th>脂肪</th><th>蛋白</th><th>体細胞</th><th>MUN</th><th>BHB</th></tr></thead><tbody>' +
      m.map(function (r) {
        var hi = r.scc != null && +r.scc >= 200;
        if (r.milk_kg == null && r.scc == null && r.fat_pct == null) {
          return '<tr><td>' + esc(String(r.ym || '').replace('-', '/')) + '</td><td>' + n(r.dim) + '</td><td colspan="6" class="l muted">数字なし（乾乳中など）</td></tr>';
        }
        return '<tr><td>' + esc(String(r.ym || '').replace('-', '/')) + '</td><td>' + n(r.dim) + '</td><td>' + n(r.milk_kg, 1) +
          '</td><td>' + n(r.fat_pct, 2) + '</td><td>' + n(r.protein_pct, 2) + '</td><td' + (hi ? ' class="hi"' : '') + '>' + n(r.scc) +
          '</td><td>' + n(r.mun, 1) + '</td><td>' + n(r.bhb, 2) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    return box('乳検（新しい順）', t + '<div class="src">体細胞は千/mL。200以上を赤くしています。出どころ: 牛群検定（' + esc(m[0].source || '') + '）</div>');
  }

  function healthBox(raw) {
    var h = rows(raw);
    if (!h.length) return box('病気・けが', failed(raw) || none('診療の記録はありません（2022年4月から）。'));
    return box('病気・けが（' + h.length + '件）', '<ul class="list">' + h.slice(0, 15).map(function (r) {
      return '<li><span class="d">' + day(r.date) + (r.dim != null ? '・分娩後' + r.dim + '日' : '') + '</span><br>' + esc(r.disease || '') +
        '<span class="small muted">　' + esc(r.outcome || '') + (r.visits ? '・' + r.visits + '回' : '') + '</span></li>';
    }).join('') + '</ul>' + (h.length > 15 ? '<p class="small muted">ほか ' + (h.length - 15) + ' 件</p>' : '') +
      src('共済の診療カルテ（2022年4月〜）'));
  }

  // 分娩は2つの出どころ（分娩記録・在籍牛一覧）に同じ日が載る。同じ日は分娩記録を使う
  function calvings(raw) {
    var by = {};
    rows(raw).forEach(function (r) {
      var k = r.date;
      if (!by[k] || r.source === '分娩記録') by[k] = r;
    });
    return Object.keys(by).sort().map(function (k) { return by[k]; });
  }

  function calvBox(c, raw) {
    var k = calvings(raw);
    var kids = cows.filter(function (x) { return x.dam_cow_id === c.cow_id; });
    if (!k.length && !kids.length) return box('分娩', failed(raw) || none('分娩の記録はありません。'));
    var t = k.length ? '<ul class="list">' + k.slice().reverse().map(function (r) {
      var kid = r.calf_mgmt_no ? esc(r.calf_mgmt_no) : '';
      var what = [r.kind, r.calf_sex, r.calf_breed].filter(Boolean).map(esc).join(' ') + (kid ? ' 子 ' + kid : '') +
        (r.birth_weight ? '・' + n(r.birth_weight) + 'kg' : '') + (r.gestation_days ? '・妊娠' + r.gestation_days + '日' : '');
      return '<li><span class="d">' + day(r.date) + (r.parity ? '・' + r.parity + '産' : '') + '</span><br>' +
        (what || '<span class="small muted">子の記録なし（TAF の一覧で分娩だけ分かっている）</span>') + '</li>';
    }).join('') + '</ul>' : '';
    if (kids.length) {
      t += '<p class="small" style="margin-top:8px">台帳にいる子: ' + kids.map(function (x) {
        return '<a href="#/cow/' + x.cow_id + '">' + esc(x.mgmt_no) + '</a>';
      }).join('・') + '</p>';
    }
    return box('分娩', t + src('分娩記録（2025年〜）・TAF 在籍牛一覧'));
  }

  function birthBox(c, b, all, colos, feed) {
    var dam = c.dam_cow_id ? byId[c.dam_cow_id] : null;
    var inner = '<dl class="kv"><dt>生まれた日</dt><dd>' + day(c.birth_date) + '</dd>' +
      '<dt>出生体重</dt><dd>' + (b && b.birth_weight != null ? '<span class="big">' + n(b.birth_weight, 1) + '</span> kg' + other(b, all) : '—') + '</dd>' +
      (b && b.gestation_days ? '<dt>妊娠日数</dt><dd>' + b.gestation_days + ' 日</dd>' : '') +
      '<dt>母</dt><dd>' + (dam ? '<a href="#/cow/' + dam.cow_id + '">' + esc(dam.mgmt_no) + '</a>' : esc(c.dam_mgmt_no || '—')) + '</dd>' +
      '<dt>父</dt><dd>' + esc(c.sire_name_raw || '—') + '</dd></dl>';
    var give = colos.filter(function (r) { return String(r.kind || '').indexOf('給与') === 0; });
    var test = colos.filter(function (r) { return r.kind === '移行判定'; });
    if (give.length || test.length) {
      inner += '<dl class="kv" style="margin-top:8px">';
      if (give.length) {
        var g = give[0];
        inner += '<dt>初乳</dt><dd>' + (g.hours_after_birth != null ? '生後 ' + n(g.hours_after_birth, 1) + ' 時間・' : '') +
          n(give.reduce(function (s, r) { return s + (+r.volume_l || 0); }, 0), 1) + ' L' + (g.brix_pct ? '・Brix ' + n(g.brix_pct, 1) + '%' : '') + '</dd>';
      }
      test.forEach(function (t) {
        inner += '<dt>移行判定</dt><dd>' + day(t.date) + (t.serum_tp != null ? '　血清TP ' + n(t.serum_tp, 1) : '') + (t.serum_brix != null ? '　Brix ' + n(t.serum_brix, 1) + '%' : '') + '</dd>';
      });
      inner += '</dl>';
    }
    if (feed.length) {
      inner += '<p class="small" style="margin-top:8px">哺乳 ' + day(feed[0].date) + '〜' + day(feed[feed.length - 1].date) + '・計 ' +
        n(feed.reduce(function (s, r) { return s + (+r.volume_l || 0); }, 0)) + ' L</p>';
    }
    var from = b ? b.source : 'なし';
    return box('生まれ・初乳', inner + src('出生体重: ' + from + '・初乳と哺乳: 哺乳アプリ・母と父: 台帳（TAF・ゲノム表）'));
  }

  // 出どころによって出生体重が10kg近く違う牛がいる（詳しくは _基盤\CLAUDE.md）。
  // 強いほうを大きく出し、違う記録があることは必ず書く（黙って1つに決めない）
  function other(b, all) {
    var diff = all.filter(function (r) { return r.source !== b.source && r.birth_weight != null && Math.abs(r.birth_weight - b.birth_weight) >= 1; });
    if (!diff.length) return '';
    return '<br><span class="small hi">ほかの記録では ' + diff.map(function (r) { return n(r.birth_weight, 1) + 'kg（' + esc(r.source) + '）'; }).join('・') + '</span>';
  }

  function growthBox(c, raw) {
    var w = rows(raw);
    if (!w.length) return box('発育', failed(raw) || none('体測の記録はありません。'));
    var t = '<div class="scroll"><table class="tbl"><thead><tr><th>日</th><th>月齢</th><th>胸囲</th><th>体高</th><th>体重</th><th>充足率</th></tr></thead><tbody>' +
      w.slice().reverse().map(function (r) {
        var bw = r.weight_actual != null ? n(r.weight_actual) : (r.weight_est != null ? n(r.weight_est) + '<span class="muted">推</span>' : '—');
        return '<tr><td>' + day(r.date) + '</td><td>' + n(months(c.birth_date, r.date), 1) + '</td><td>' + n(r.chest_cm) + '</td><td>' +
          n(r.height_cm) + '</td><td>' + bw + '</td><td>' + (r.ratio != null ? n(r.ratio * (r.ratio < 3 ? 100 : 1)) + '%' : '—') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    return box('発育', t + src('体高BW（7.白川体高BW.xlsx）・哺乳アプリ。「推」は胸囲からの推定'));
  }

  // 初産までの繁殖。初回授精は TAF の在籍牛一覧の「初回授精日」を使う（未経産のあいだは生涯の初回）。
  // 分娩記録には受胎した授精しか無いので、そちらを初回と呼ぶと間違える（初回のあと2回目で受胎した牛がそうなる）
  function firstBox(c, roster, repro, calvRaw) {
    var k = calvings(calvRaw);
    var first = k.filter(function (r) { return +r.parity === 1; })[0] || null;
    var heifer = roster.filter(function (r) { return r.parity == null || r.parity === '' || +r.parity === 0; });
    var fa = heifer.map(function (r) { return r.first_ai; }).filter(Boolean).sort()[0] || null;
    var ok = repro.filter(function (r) { return r.result === '受胎' && (!first || r.date < first.date); })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; })[0] || null;
    if (!ok && !first) {
      var la = heifer.map(function (r) { return r.last_ai; }).filter(Boolean).sort();
      ok = la.length ? { date: la[la.length - 1], guess: true } : null;
    }
    if (!fa && !ok && !first) return '';
    var inner = '<dl class="kv">';
    if (fa) inner += '<dt>初回授精</dt><dd>' + day(fa) + '（' + n(months(c.birth_date, fa), 1) + 'か月）</dd>';
    if (ok) inner += '<dt>' + (ok.guess ? '最新授精' : '受胎した授精') + '</dt><dd>' + day(ok.date) + '（' + n(months(c.birth_date, ok.date), 1) + 'か月）</dd>';
    if (first) inner += '<dt>初産</dt><dd>' + day(first.date) + '（' + n(months(c.birth_date, first.date), 1) + 'か月）</dd>';
    inner += '</dl>';
    return box('初産まで', inner + src('初回授精: TAF 在籍牛一覧（2025年6月〜）・受胎: 分娩記録・初産: 分娩記録と在籍牛一覧'));
  }

  function lactBox(raw) {
    var l = rows(raw);
    if (!l.length) return '';
    var t = '<div class="scroll"><table class="tbl"><thead><tr><th>産次</th><th>分娩</th><th>305日乳量</th><th>脂肪</th><th>蛋白</th><th>体細胞</th></tr></thead><tbody>' +
      l.map(function (r) {
        if (r.milk_305 == null) return '<tr><td>' + esc(r.parity) + '</td><td>' + day(r.calving_date) + '</td><td colspan="4" class="l muted">305日に届いていない</td></tr>';
        return '<tr><td>' + esc(r.parity) + '</td><td>' + day(r.calving_date) + '</td><td>' + n(r.milk_305) + '</td><td>' +
          n(r.fat_pct, 2) + '</td><td>' + n(r.protein_pct, 2) + '</td><td>' + n(r.scc_avg) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    return box('産次ごとの成績', t + src('累計個体乳検（305日）'));
  }

  var TRAITS = ['TPI', 'NM$', '乳量', '脂肪量', '蛋白量', 'PL', 'SCS', 'DPR', '受胎指数', '体型', '肢蹄', '乳器', '飼料効率', '健康指数'];
  function genomeBox(g, info) {
    if (!g.length) return '';
    var by = {};
    g.forEach(function (r) { by[r.trait] = r.value; });
    var batch = g[0].batch;
    var inner = '<dl class="kv">' + TRAITS.filter(function (t) { return by[t] != null; }).map(function (t) {
      return '<dt>' + esc(t) + '</dt><dd>' + esc(by[t]) + '</dd>';
    }).join('') + '</dl>';
    return box('ゲノム', inner + src('ゲノム表（' + esc(batch) + ' の回）' + (info && info.test_status ? '・' + esc(info.test_status) : '')));
  }

  function saleBox(raw) {
    var s = rows(raw);
    if (!s.length) return '';
    return box('出ていった記録', '<ul class="list">' + s.map(function (r) {
      return '<li><span class="d">' + day(r.date) + '</span>　' + esc(r.kind || '') + (r.detail ? '・' + esc(r.detail) : '') +
        (r.price != null ? '　' + Number(r.price).toLocaleString('ja-JP') + ' 円' : '') + '</li>';
    }).join('') + '</ul>' + src('哺乳アプリ'));
  }

  // ------------------------------------------------------------ 道順
  function fromMail() {
    // メールのリンクから来ると #access_token=…&type=invite のように付いてくる
    var h = location.hash.slice(1);
    if (h.indexOf('access_token=') < 0 && h.indexOf('error') !== 0 && h.indexOf('&error') < 0) return null;
    var p = {};
    h.split('&').forEach(function (kv) { var i = kv.indexOf('='); p[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); });
    history.replaceState(null, '', location.pathname + location.search + '#/');
    if (p.error || p.error_description) return { error: p.error_description || p.error };
    keep({ access_token: p.access_token, refresh_token: p.refresh_token, expires_in: +p.expires_in || 3600,
           expires_at: +p.expires_at || 0, user: null });
    return { type: p.type };
  }

  function route() {
    if (location.protocol === 'file:') {
      // PC の _基盤\karte\index.html を直接開いたとき。ここには鍵が無い（公開するときに入る）
      app.innerHTML = '<p class="msg err">これは PC にある元のファイルです。カルテはこちらで開いてください。</p>' +
        '<p><a href="https://vet1123st-cyber.github.io/shirakawa-karte/">https://vet1123st-cyber.github.io/shirakawa-karte/</a></p>';
      return;
    }
    if (!CFG.url || !CFG.key) {
      // 箱の鍵を入れる前に住所だけ先に作った状態（make_karte.py --placeholder）
      app.innerHTML = '<p class="msg err">まだ準備中です。使えるようになったら佐藤さんから知らせます。</p>' +
        '<p class="small muted">（箱の設定 config.js が空です。PC で make_karte.py を走らせると入ります）</p>';
      return;
    }
    session().then(function (s) {
      if (!s) { showLogin(); return; }
      showWho(s);
      return loadCows().then(function () {
        var m = location.hash.match(/^#\/cow\/(\d{10})/);
        if (m) showCow(m[1]); else showSearch();
      });
    }).catch(function (err) {
      if (err.status === 401 || err.status === 403) { forget(); showLogin('もう一度ログインしてください。', true); return; }
      app.innerHTML = '<p class="msg err">箱が読めませんでした（' + esc(err.message) + '）。電波を確かめて、もう一度開いてください。</p>';
    });
  }

  var mail = fromMail();
  if (mail && mail.error) showLogin('メールのリンクが使えませんでした（' + mail.error + '）。もう一度送ってもらってください。', true);
  else if (mail && (mail.type === 'invite' || mail.type === 'recovery')) showSetPassword(mail.type);
  else route();
  window.addEventListener('hashchange', function () { if (load()) route(); });
})();
