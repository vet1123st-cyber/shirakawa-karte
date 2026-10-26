// 白川Farm — トップ（ロボット・繁殖の数字）／個体（4桁を打つと、その牛の「いま」と「これまで」が1枚で出る）／頭数。
// 2026-10-26 に「個体カルテ」から名前を変えた（住所 shirakawa-karte はそのまま。ホーム画面に置いた入口が切れないように）。
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

  function call(method, path, body, token, extra) {
    var h = { apikey: CFG.key, 'Content-Type': 'application/json' };
    if (token) h.Authorization = 'Bearer ' + token;
    if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
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

  // 通行証は1時間で切れる。切れる1分前か、切れていたら取り直す。
  // 「毎回IDとパスワードを入れる」と言われた（2026-10-26）原因になりうる2つを塞いである:
  //   * 取り直しを同時に何本も走らせない（同じ取り直しの札は1回しか使えない。2本目が断られて全部忘れていた）
  //   * 電波が悪くて取り直せなかっただけなら、ログインを忘れない（忘れるのは箱が「その札は無効」と言ったときだけ）
  var refreshing = null;
  function session() {
    var s = load();
    if (!s) return Promise.resolve(null);
    if (s.expires_at - 60 > Date.now() / 1000) return Promise.resolve(s);
    if (!refreshing) {
      refreshing = call('POST', '/auth/v1/token?grant_type=refresh_token', { refresh_token: s.refresh_token })
        .then(keep)
        .catch(function (err) {
          if (err.status === 400 || err.status === 401 || err.status === 403) { forget(); return null; }
          throw err;                                  // 電波のせい。ログインはそのまま
        })
        .then(function (x) { refreshing = null; return x; }, function (e) { refreshing = null; throw e; });
    }
    return refreshing;
  }

  // 読んだものを端末に控える（台帳と、開いた牛のカルテ）。次に開くときは控えをすぐ出し、裏で新しくする。
  // ログアウトしたら消す
  var MEMO = 'karte.memo.v1.';
  function memo(k, v) {
    try {
      if (v === undefined) return JSON.parse(localStorage.getItem(MEMO + k) || 'null');
      localStorage.setItem(MEMO + k, JSON.stringify({ at: Date.now(), v: v }));
      var list = JSON.parse(localStorage.getItem(MEMO + 'list') || '[]').filter(function (x) { return x !== k; });
      list.unshift(k);
      // 牛のカルテは新しい40頭まで（端末の置き場を食いつぶさない）
      list.filter(function (x) { return x.indexOf('cow.') === 0; }).slice(40).forEach(function (x) {
        localStorage.removeItem(MEMO + x);
        list = list.filter(function (y) { return y !== x; });
      });
      localStorage.setItem(MEMO + 'list', JSON.stringify(list));
    } catch (e) { return null; /* 控えが無くても使える */ }
  }
  function forgetMemo() {
    try {
      Object.keys(localStorage).forEach(function (k) { if (k.indexOf(MEMO) === 0) localStorage.removeItem(k); });
    } catch (e) { /* 同上 */ }
  }

  function get(path) {
    return session().then(function (s) {
      if (!s) throw Object.assign(new Error('ログインが切れました'), { status: 401 });
      return call('GET', '/rest/v1/' + path, null, s.access_token);
    });
  }

  // 箱に書く（いまは input_repro だけ。箱の決まりで、ほかの表には書けない）。
  // 同じ id なら上書き（電波が切れて送り直しても二重にならない）
  function upsert(table, rows) {
    return session().then(function (s) {
      if (!s) throw Object.assign(new Error('ログインが切れました'), { status: 401 });
      return call('POST', '/rest/v1/' + table + '?on_conflict=id', rows, s.access_token,
        { Prefer: 'resolution=merge-duplicates,return=minimal' });
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
    var nav = document.getElementById('tabs');
    if (nav) nav.hidden = true;
    app.innerHTML =
      '<form class="form" id="f">' +
      '<p>白川Farm（白川牧場の牛と頭数の記録）です。招待されたメールアドレスとパスワードで入ってください。</p>' +
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
      forgetMemo();
      cows = null;
      call('POST', '/auth/v1/logout', {}, t).catch(function () { /* 消えていてもよい */ });
      showLogin('ログアウトしました。');
    };
  }

  // ------------------------------------------------------------ 画面: さがす
  // 台帳（528頭・約140KB・1秒ほど）。端末の控えがあれば待たずにそれを使い、裏で読み直す
  var COW_Q = 'cow?select=cow_id,mgmt_no,name,birth_date,status,status_date,sex,breed,dam_cow_id,dam_mgmt_no,sire_name_raw&order=mgmt_no.asc';
  function setCows(rows) {
    cows = rows || [];
    byId = {};
    cows.forEach(function (c) { byId[c.cow_id] = c; });
    return cows;
  }
  function loadCows() {
    if (cows) return Promise.resolve(cows);
    var m = memo('cows');
    var fresh = get(COW_Q).then(function (r) { memo('cows', r); return setCows(r); });
    if (m && m.v && m.v.length) {
      fresh.catch(function () { /* 控えで続ける。次に開いたときにまた読む */ });
      return Promise.resolve(setCows(m.v));
    }
    return fresh;
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
    if (!c) { app.innerHTML = '<a class="back" href="#/cows">← さがす</a>' + none('この牛は台帳にありません。'); return; }
    // 前に開いた牛なら、控えをすぐ出す（上に「〇時〇分の控え・新しくしています」）。読めたら差し替える
    var m = memo('cow.' + id);
    var shown = false;
    if (m && m.v) {
      draw(c, m.v, '<p class="small muted" id="stale">' + md(new Date(m.at).toISOString()) + ' ' +
        new Date(m.at).toTimeString().slice(0, 5) + ' に読んだ控えです。新しくしています…</p>');
      shown = true;
    } else {
      app.innerHTML = '<a class="back" href="#/cows">← さがす</a><p class="muted">' + esc(c.mgmt_no) + ' を読んでいます…</p>';
    }
    // 1回で1頭ぶん全部（箱の関数 karte）。箱がまだ古くて関数が無いときだけ、表ごとに読む
    get('rpc/karte?p_cow=' + encodeURIComponent(id))
      .then(function (d) {
        if (location.hash !== '#/cow/' + id) return;
        memo('cow.' + id, d);
        draw(c, d, '');
        if (!shown) window.scrollTo(0, 0);
      })
      .catch(function (err) {
        if (location.hash !== '#/cow/' + id) return;
        if (err.status === 404) { oneByOne(c, id); return; }
        var s = document.getElementById('stale');
        if (s) { s.className = 'msg err'; s.textContent = '電波が悪く新しくできませんでした。下は前に読んだ控えです（' + err.message + '）'; return; }
        app.innerHTML = '<a class="back" href="#/cows">← さがす</a><p class="msg err">読めませんでした（' + esc(err.message) + '）。電波を確かめて、開き直してください。</p>';
      });
  }

  function draw(c, d, top) {
    var names = Object.keys(d);
    // どれか読めなかったら、上にはっきり出す（空の欄を「記録が無い」と読み違えないように）
    var bad = names.filter(function (k) { return d[k] && d[k]._err; });
    app.innerHTML = '<a class="back" href="#/cows">← さがす</a>' + top +
      (bad.length ? '<p class="msg err">一部が読めませんでした（' + esc(bad.join('・')) + '）。開き直してください。</p>' : '') +
      card(c, d);
  }

  // 箱に karte 関数が無い（箱の表.sql を流し直す前）ときの読み方。表ごとに16回
  function oneByOne(c, id) {
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
        draw(c, d, '');
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
  // 数字の横に小さく単位を付けたいとき（val は数字と単位だけを組んだ HTML。人の書いた文字は入れない）
  function statH(label, valHtml, sub) {
    return '<div class="stat"><div class="label">' + esc(label) + '</div><div class="val">' + valHtml + '</div><div class="sub">' + esc(sub) + '</div></div>';
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

  // ------------------------------------------------------------ 画面: トップ
  // PC の farm_summary.py が毎朝計算して箱の farm_summary 表に置く（ロボットの群の平均・授精率・妊娠率・受胎率）
  function showTop() {
    // ゲノムの行（約270KB）はゲノムのページだけで読む
    loadPage('top', 'top', 'farm_summary?select=section,key,date,value,n,note&section=neq.' + encodeURIComponent('ゲノム') +
      '&order=date.asc', drawTop);
  }

  function pick(rows, sec, key) {
    return rows.filter(function (r) { return r.section === sec && r.key === key; })
      .map(function (r) { return { d: r.date, v: r.value == null ? null : +r.value, n: r.n, note: r.note }; });
  }

  function drawTop(rows, top) {
    var set = {};
    rows.filter(function (r) { return r.section === '設定'; }).forEach(function (r) { set[r.key] = r.note; });
    var html = top + '<div class="head"><div class="name"><b>白川牧場</b></div><div class="id">' +
      (set['計算日'] ? day(set['計算日']) + ' に計算' : '') + '</div></div>';
    html += robotTop(rows);
    html += reproTop(rows);
    html += box('決めごと', '<dl class="kv">' + Object.keys(set).filter(function (k) { return k !== '計算日'; }).map(function (k) {
      return '<dt>' + esc(k.replace('の決め方', '')) + '</dt><dd class="small">' + esc(set[k]) + '</dd>';
    }).join('') + '</dl>');
    app.innerHTML = html;
  }

  function robotTop(rows) {
    var milk = pick(rows, 'ロボット', '日乳量');
    if (!milk.length) return box('ロボット', none('まだ記録がありません。'));
    var last = milk[milk.length - 1];
    var wk = milk.slice(-8, -1).map(function (x) { return x.v; });
    var base = avg(wk);
    var diff = base == null ? null : last.v - base;
    var cell = function (key, unit, dg) {
      var s = pick(rows, 'ロボット', key);
      if (!s.length) return '';
      var l = s[s.length - 1], b = avg(s.slice(-8, -1).map(function (x) { return x.v; }));
      return statH(key, n(l.v, dg) + '<span class="small">' + unit + '</span>',
        b == null ? '' : '前の7日 ' + n(b, dg));
    };
    return box('ロボット（' + md(last.d) + '）',
      '<div class="stats"><div class="stat"><div class="label">日乳量（1頭）</div><div class="val big">' + n(last.v, 1) +
      '<span class="small">kg</span></div><div class="sub">' + (diff == null ? '' : (diff >= 0 ? '+' : '') + n(diff, 1) + ' kg（前の7日とくらべて）') +
      '</div></div>' + cell('頭数', '頭', 0) + cell('搾乳回数', '回', 2) + '</div>' +
      trend([{ name: '日乳量', color: 'var(--spark)', pts: milk }], 'kg') +
      '<div class="stats">' + cell('反芻時間', '分', 0) + cell('リフューズ', '', 2) + cell('失敗', '', 2) + '</div>' +
      src('レリー Horizon「搾乳可能牛」（搾乳している牛だけの平均。毎朝）'));
  }

  function reproTop(rows) {
    var hdr = pick(rows, '繁殖', '授精率'), pr = pick(rows, '繁殖', '妊娠率');
    // 授精が5回に満たない月は線に入れない（2回で 0% のように大きく振れるため）
    var enough = function (p) { return (p.n || 0) >= 5; };
    var cp = pick(rows, '繁殖', '受胎率（経産）').filter(enough), ch = pick(rows, '繁殖', '受胎率（未経産）').filter(enough);
    if (!hdr.length) return box('繁殖', none('まだ計算されていません。'));
    var lastOf = function (s) { var x = s.filter(function (p) { return p.v != null; }); return x[x.length - 1]; };
    var mean = function (s) { var x = s.filter(function (p) { return p.v != null; }); return x.length ? avg(x.map(function (p) { return p.v; })) : null; };
    var wsum = function (s, k) {          // 直近 k か月の受胎率（回数で重みづけ）
      var x = s.slice(-k), nn = x.reduce(function (a, p) { return a + (p.n || 0); }, 0);
      return nn ? { v: x.reduce(function (a, p) { return a + p.v * p.n; }, 0) / nn, n: nn } : null;
    };
    var h = lastOf(hdr), p = lastOf(pr), c3 = wsum(cp, 3), h3 = wsum(ch, 3);
    return box('繁殖（経産・21日ごと）',
      '<div class="stats">' +
      statH('授精率', h ? n(h.v, 0) + '<span class="small">%</span>' : '—', h ? md(h.d) + '〜の21日・対象' + h.n + '頭' : '') +
      statH('妊娠率', p ? n(p.v, 0) + '<span class="small">%</span>' : '—', p ? md(p.d) + '〜・1年平均 ' + n(mean(pr), 1) + '%' : '') +
      statH('受胎率', c3 ? n(c3.v, 0) + '<span class="small">%</span>' : '—', c3 ? '直近3か月・' + c3.n + '回' + (h3 ? '／未経産 ' + n(h3.v, 0) + '%' : '') : '') +
      '</div>' +
      trend([{ name: '授精率', color: 'var(--spark2)', pts: hdr }, { name: '妊娠率', color: 'var(--spark)', pts: pr }], '%') +
      '<p class="small muted">妊娠率は直近およそ3か月、授精率は直近およそ5週間はまだ出ません（妊娠したかがまだ分からない・TAF への授精の報告待ち）。灰色の部分がそこで、0% ではありません。</p>' +
      trend([{ name: '受胎率（経産）', color: 'var(--spark)', pts: cp }, { name: '受胎率（未経産）', color: 'var(--spark2)', pts: ch }], '%', true) +
      src('TAF 繁殖のCSV（授精・分娩）と在籍牛一覧の分娩予定日'));
  }

  // 日付で並んだ線（いくつでも）。値が空の点は線を切り、終わりの空の区間は薄く塗る
  function trend(series, unit, monthly) {
    var ds = [];
    series.forEach(function (s) { s.pts.forEach(function (p) { if (ds.indexOf(p.d) < 0) ds.push(p.d); }); });
    ds.sort();
    if (ds.length < 2) return '';
    var vals = [];
    series.forEach(function (s) { s.pts.forEach(function (p) { if (p.v != null) vals.push(p.v); }); });
    if (!vals.length) return '';
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var pad = (hi - lo) * 0.15 || 1;
    lo = Math.max(0, Math.floor(lo - pad)); hi = Math.ceil(hi + pad);
    var W = 320, H = 120, L = 28, R = 6, T = 8, B = 20;
    var X = function (d) { return L + ds.indexOf(d) / (ds.length - 1) * (W - L - R); };
    var Y = function (v) { return T + (1 - (v - lo) / (hi - lo)) * (H - T - B); };
    var g = '';
    // 終わりの「まだ分からない」区間
    var known = [];
    series.forEach(function (s) { s.pts.forEach(function (p) { if (p.v != null) known.push(p.d); }); });
    var lastKnown = known.sort()[known.length - 1];
    if (lastKnown && lastKnown < ds[ds.length - 1]) {
      g += '<rect x="' + X(lastKnown).toFixed(1) + '" y="' + T + '" width="' + (X(ds[ds.length - 1]) - X(lastKnown)).toFixed(1) +
        '" height="' + (H - T - B) + '" class="unknown"/>';
    }
    series.forEach(function (s) {
      var d = '', on = false;
      s.pts.forEach(function (p) {
        if (p.v == null) { on = false; return; }
        d += (on ? 'L' : 'M') + X(p.d).toFixed(1) + ' ' + Y(p.v).toFixed(1) + ' ';
        on = true;
      });
      g += '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="2"/>';
    });
    var ticks = [lo, Math.round((lo + hi) / 2), hi].map(function (v) {
      return '<text x="' + (L - 4) + '" y="' + (Y(v) + 4).toFixed(1) + '" text-anchor="end">' + v + '</text>' +
        '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" class="grid"/>';
    }).join('');
    var lab = typeof monthly === 'function' ? monthly
      : function (d) { return monthly ? d.slice(2, 4) + '/' + (+d.slice(5, 7)) : md(d); };
    var mk = '<text x="' + L + '" y="' + (H - 5) + '" text-anchor="start">' + lab(ds[0]) + '</text>' +
      '<text x="' + (W - R) + '" y="' + (H - 5) + '" text-anchor="end">' + lab(ds[ds.length - 1]) + '</text>';
    var legend = series.length > 1 ? '<div class="legend">' + series.map(function (s) {
      return '<span><i style="background:' + s.color + '"></i>' + esc(s.name) + '</span>';
    }).join('') + '</div>' : '';
    return legend + '<svg class="herd" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' +
      esc(series.map(function (s) { return s.name; }).join('・')) + '（' + esc(unit) + '）の移り変わり">' + ticks + g + mk + '</svg>';
  }

  // ------------------------------------------------------------ 画面: ゲノム
  // PC の farm_summary.py が、今のゲノムダッシュボードと同じ payload を箱に1行で置く。
  // 計算はダッシュボードと同じ engine.js（同期群比較・全国とのくらべ）。在籍かどうかは台帳（TAF）で決める
  var GVIEWS = [['herd', '群'], ['sire', '精液'], ['year', '経年'], ['cows', '個体']];
  var gRaw = null;
  function gState(k, v) {
    try {
      if (v === undefined) return sessionStorage.getItem('g.' + k);
      sessionStorage.setItem('g.' + k, v);
    } catch (e) { return null; /* 覚えられなくても使える */ }
  }
  function showGenome() {
    loadPage('genome', 'genome', 'farm_summary?select=date,n,note&section=eq.' + encodeURIComponent('ゲノム') +
      '&key=eq.payload', drawGenome);
  }
  function here(c) { var x = byId[c.id]; return x ? x.status === '在籍' : c.status === '在籍'; }
  // 小数の桁は形質ごと（牛の値の大きさで決める。TPI は0桁、脂肪量・蛋白量は1桁、SCS は2桁）
  var gDec = {};
  function gfmt(k, v) {
    if (v == null || isNaN(v)) return '—';
    var s = (+v).toFixed(gDec[k] == null ? 1 : gDec[k]);
    return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s;
  }
  function setDec(E, D) {
    gDec = {};
    D.traits.forEach(function (t) {
      var mx = 0;
      D.cows.forEach(function (c) { var v = E.num(c.g[t.k]); if (v != null) mx = Math.max(mx, Math.abs(v)); });
      gDec[t.k] = mx >= 500 ? 0 : mx >= 10 ? 1 : 2;
    });
  }
  function pctTxt(p) { return p == null ? '—' : Math.round(p) + '%'; }

  function drawGenome(rows, top) {
    if (!rows.length || !rows[0].note) { app.innerHTML = top + none('ゲノムの数字がまだ箱にありません。'); return; }
    if (!window.Engine) { app.innerHTML = top + '<p class="msg err">ゲノムの計算（engine.js）が読めませんでした。開き直してください。</p>'; return; }
    var E = window.Engine;
    if (gRaw !== rows[0].note) { E.init(JSON.parse(rows[0].note)); gRaw = rows[0].note; setDec(E, E.data()); }
    var D = E.data();
    var view = gState('view') || 'herd';
    var trait = gState('trait') || 'TPI';
    if (!E.meta(trait)) trait = D.traits[0].k;
    var grp = gState('grp') || '在籍';
    var all = D.cows, mine = all.filter(here);
    var html = top + '<div class="head"><div class="name"><b>ゲノム</b></div><div class="id">' + esc(D.batch) +
      ' の評価・検査済み ' + all.length + ' 頭（いま居る ' + mine.length + ' 頭）</div></div>' +
      '<div class="seg" id="gv">' + GVIEWS.map(function (v) {
        return '<button type="button" data-gv="' + v[0] + '"' + (v[0] === view ? ' class="on"' : '') + '>' + v[1] + '</button>';
      }).join('') + '</div>';
    if (view !== 'herd') {
      html += '<div class="pickers"><select id="gt" aria-label="形質">' + D.traits.map(function (t) {
        return '<option value="' + esc(t.k) + '"' + (t.k === trait ? ' selected' : '') + '>' + esc(t.label) + '</option>';
      }).join('') + '</select>' + (view === 'year' || view === 'cows' ? '<select id="gg" aria-label="牛"><option' +
        (grp === '在籍' ? ' selected' : '') + '>在籍</option><option' + (grp === '全頭' ? ' selected' : '') + '>全頭</option></select>' : '') + '</div>';
    }
    var cows = grp === '全頭' ? all : mine;
    if (view === 'herd') html += gHerd(E, D, mine);
    else if (view === 'sire') html += gSire(E, D, all, trait);
    else if (view === 'year') html += gYear(E, D, cows, trait, grp);
    else html += gCows(E, D, cows, trait);
    html += src('ゲノム表（eGプラス）・精液マスタ（精液のPDF）・全国の分布（eGプラス）。計算はゲノムダッシュボードと同じ');
    app.innerHTML = html;
    [].forEach.call(document.querySelectorAll('#gv button'), function (b) {
      b.onclick = function () { gState('view', b.getAttribute('data-gv')); drawGenome(rows, ''); window.scrollTo(0, 0); };
    });
    var gt = document.getElementById('gt'), gg = document.getElementById('gg');
    if (gt) gt.onchange = function () { gState('trait', gt.value); drawGenome(rows, ''); };
    if (gg) gg.onchange = function () { gState('grp', gg.value); drawGenome(rows, ''); };
  }

  function gHerd(E, D, mine) {
    var t = '<div class="scroll"><table class="tbl"><thead><tr><th>形質</th><th>いま居る牛の平均</th><th>全国</th><th>北海道</th></tr></thead><tbody>';
    D.traits.forEach(function (m) {
      var s = E.stats(mine.map(function (c) { return E.num(c.g[m.k]); }));
      if (!s.n) return;
      t += '<tr><td class="l">' + esc(m.label) + (m.better === 'low' ? '<span class="small muted">（低いほど良い）</span>' : '') + '</td><td>' +
        gfmt(m.k, s.mean) + '</td><td>' + pctTxt(E.pctNational(m.k, s.mean)) + '</td><td>' + pctTxt(E.pctHokkaido(m.k, s.mean)) + '</td></tr>';
    });
    return box('群（いま居る牛）', t + '</tbody></table></div>' +
      '<p class="small muted">全国・北海道は、平均がその分布の何%の位置にあるか（eGプラスの分布から。上ほど良い。低いほど良い形質は向きをそろえてある）。±2%ほどの幅があります。</p>');
  }

  function gSire(E, D, all, trait) {
    var m = E.meta(trait);
    var rows = E.sireRows(all, trait).filter(function (r) { return r.n > 0; });
    var good = function (x) { return m.better === 'low' ? -x : x; };
    rows.sort(function (a, b) {
      var A = a.adjN >= 2 ? good(a.adj) : -1e9, B = b.adjN >= 2 ? good(b.adj) : -1e9;
      return B - A || b.n - a.n;
    });
    var t = '<div class="scroll"><table class="tbl"><thead><tr><th>種雄牛</th><th>娘</th><th>娘の平均</th><th>同期群比較</th><th>精液</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var sure = r.ci && (r.ci[0] > 0 || r.ci[1] < 0);
      var cls = sure ? (good(r.adj) > 0 ? ' class="ok"' : ' class="hi"') : '';
      t += '<tr><td class="l">' + esc(r.name || r.key) + (r.naab ? '<br><span class="small muted">' + esc(r.naab) + '</span>' : '') + '</td>' +
        '<td>' + r.n + '</td><td>' + gfmt(trait, r.mean) + '</td>' +
        '<td' + cls + '>' + (r.adjN >= 2 ? (r.adj >= 0 ? '+' : '') + gfmt(trait, r.adj) + (sure ? '' : '<br><span class="small muted">言い切れない</span>') : '—') + '</td>' +
        '<td>' + (r.master != null ? gfmt(trait, r.master) : '—') + '</td></tr>';
    });
    return box('精液ごと（' + esc(m.label) + '・検査済みの全頭）', t + '</tbody></table></div>' +
      '<p class="small muted">同期群比較 = 娘1頭ずつを「同じ年に生まれた、よその父の娘」の平均とくらべた差の平均。牧場が年々良くなっているぶん、' +
      '最近つけた精液ほど良く見えるのを外してある。95%の幅が0をまたぐときは「言い切れない」。緑は良い・赤は悪いと言い切れるもの。' +
      '精液 = 精液マスタ（PDF）の値。</p>');
  }

  function gYear(E, D, cows, trait, grp) {
    var m = E.meta(trait);
    var co = E.cohorts(cows, trait).filter(function (r) { return r.n > 0; });
    var html = trend([{ name: '平均', color: 'var(--spark)', pts: co.map(function (r) { return { d: r.year, v: r.mean }; }) },
                      { name: '中央', color: 'var(--spark2)', pts: co.map(function (r) { return { d: r.year, v: r.med }; }) }],
      m.label, function (y) { return y + '年生'; });
    var t = '<div class="scroll"><table class="tbl"><thead><tr><th>生まれ年</th><th>頭数</th><th>平均</th><th>中央</th><th>全国</th></tr></thead><tbody>';
    co.forEach(function (r) {
      t += '<tr><td>' + esc(r.year) + '</td><td>' + r.n + '</td><td>' + gfmt(trait, r.mean) + '</td><td>' + gfmt(trait, r.med) +
        '</td><td>' + pctTxt(E.pctNational(trait, r.mean)) + '</td></tr>';
    });
    html = box('生まれ年ごと（' + esc(m.label) + '・' + esc(grp) + '）', html + t + '</tbody></table></div>' +
      '<p class="small muted">いちばん新しい評価の回の値で、生まれ年どうしをくらべている（基準の改定をまたがない）。</p>');
    // 評価の回ごとの群平均（平均まとめ）。2025年4月に基準が変わったので、旧と新を別の線にする
    var tr = (D.trend || []).filter(function (x) { return x.v && x.v[trait] != null; });
    if (tr.length >= 2) {
      var oldB = tr.filter(function (x) { return x.base === '旧'; }), newB = tr.filter(function (x) { return x.base === '新'; });
      html += box('評価の回ごとの群平均（平均まとめ・' + esc(m.label) + '）',
        trend([{ name: '旧基準', color: 'var(--spark2)', pts: oldB.map(function (x) { return { d: x.date, v: x.v[trait] }; }) },
               { name: '新基準', color: 'var(--spark)', pts: newB.map(function (x) { return { d: x.date, v: x.v[trait] }; }) }],
          m.label, function (d) { return d.slice(2, 4) + '/' + (+d.slice(5, 7)); }) +
        '<p class="small muted">牧場がその回に出した「平均まとめ」の値。2025年4月に評価の基準が変わったので、旧と新は線をつなげない（同じものさしではない）。</p>');
    }
    return html;
  }

  function gCows(E, D, cows, trait) {
    var m = E.meta(trait);
    var list = cows.map(function (c) { return { c: c, v: E.num(c.g[trait]) }; }).filter(function (x) { return x.v != null; });
    list.sort(function (a, b) { return m.better === 'low' ? a.v - b.v : b.v - a.v; });
    return box('個体の順位（' + esc(m.label) + '）', '<ul class="list">' + list.map(function (x, i) {
      var c = x.c, row = byId[c.id];
      return '<li><a class="rowlink" href="#/cow/' + esc(c.id) + '"><span class="no">' + (i + 1) + '</span>' +
        '<span><b>' + esc(c.mgmt || '----') + '</b> <span class="small muted">' + esc(c.birth ? c.birth.slice(0, 4) + '年生' : '') +
        (row && row.status !== '在籍' ? '・居ない' : '') + '</span></span><span class="v">' + gfmt(trait, x.v) +
        '<span class="small muted">　全国 ' + pctTxt(E.pctNational(trait, x.v)) + '</span></span></a></li>';
    }).join('') + '</ul><p class="small muted">押すとその牛のカルテ。</p>');
  }

  // ------------------------------------------------------------ 画面: 頭数と見通し（段階3）
  // PC の herd_outlook.py が毎朝計算して箱の herd_outlook 表に置く。ここは読んで描くだけ（計算はしない）。
  //   kind 実際（過去13か月の月末）／いま／見通し（1年先。lo〜hi は300回くり返したうちの下10%〜上10%）／設定
  var ROOMS = ['搾乳（ロボット）', 'つなぎ', '乾乳前期', '分娩舎', '哺乳・D型', '育成舎'];
  // まとめの画面（トップ・頭数…）の読み方。控えがあればすぐ出し、裏で新しくする
  function loadPage(tab, memoKey, path, draw) {
    var m = memo(memoKey);
    if (m && m.v) draw(m.v, '<p class="small muted" id="stale">' + md(new Date(m.at).toISOString()) + ' ' +
      new Date(m.at).toTimeString().slice(0, 5) + ' に読んだ控えです。新しくしています…</p>');
    else app.innerHTML = '<p class="muted pad">読んでいます…</p>';
    get(path)
      .then(function (r) {
        if (tabOf() !== tab) return;
        memo(memoKey, r);
        draw(r, '');
      })
      .catch(function (err) {
        if (tabOf() !== tab) return;
        var s = document.getElementById('stale');
        if (s) { s.className = 'msg err'; s.textContent = '新しくできませんでした。下は前に読んだ控えです（' + err.message + '）'; return; }
        app.innerHTML = '<p class="msg err">読めませんでした（' + esc(err.message) + '）。' +
          (err.status === 404 ? '箱にまだこの表がありません（佐藤さんが箱の表を流し直すと出ます）。' : '電波を確かめて、開き直してください。') + '</p>';
      });
  }

  function showHerd() {
    loadPage('herd', 'herd', 'herd_outlook?select=item,month,kind,lo,mid,hi,cap,note&order=month.asc', drawHerd);
  }

  function series(rows, item) {
    // 月の順に [{m, kind, lo, mid, hi, cap}]。いま（日付つき）は月の位置に置く
    return rows.filter(function (r) { return r.item === item && r.kind !== '設定'; })
      .map(function (r) { return { m: r.month.slice(0, 7), day: r.month, kind: r.kind, lo: +r.lo, mid: +r.mid, hi: +r.hi, cap: r.cap == null ? null : +r.cap }; });
  }

  function drawHerd(rows, top) {
    if (!rows.length) { app.innerHTML = top + none('まだ計算されていません。'); return; }
    var set = {};
    rows.filter(function (r) { return r.item === '設定'; }).forEach(function (r) { set[r.month] = r.note; });
    var html = top +
      '<div class="head"><div class="name"><b>頭数と1年先の見通し</b></div>' +
      '<div class="id">' + day(set['計算日']) + ' に計算。線は真ん中、帯は「ありそうな幅」（300回くり返した下10%〜上10%）</div></div>';
    html += box('いま と 1年先', roomTable(rows) + src('TAF（在籍・繁殖・異動のCSV、在籍牛一覧）・レリー（つなぎの頭数）'));
    ROOMS.forEach(function (it) { html += box(it, chart(series(rows, it))); });
    html += box('分娩と除籍（月ごと）', chart(series(rows, '分娩'), '分娩', 'var(--spark)') + chart(series(rows, '除籍'), '除籍', 'var(--spark2)'));
    html += box('経産・未経産', chart(series(rows, '経産'), '経産') + chart(series(rows, '未経産'), '未経産'));
    html += box('決めごと', '<dl class="kv">' + Object.keys(set).filter(function (k) { return k !== '計算日'; }).map(function (k) {
      return '<dt>' + esc(k) + '</dt><dd class="small">' + esc(set[k]) + '</dd>';
    }).join('') + '</dl>' + checkLine(rows));
    app.innerHTML = html;
  }

  function roomTable(rows) {
    var t = '<div class="scroll"><table class="tbl"><thead><tr><th>区画</th><th>いま</th><th>1年で多い月</th><th>多いとき</th><th>容量</th></tr></thead><tbody>';
    ROOMS.forEach(function (it) {
      var s = series(rows, it);
      var now = s.filter(function (x) { return x.kind === 'いま'; })[0];
      var fut = s.filter(function (x) { return x.kind === '見通し'; });
      var peak = fut.reduce(function (a, x) { return !a || x.mid > a.mid ? x : a; }, null);
      var hiMax = fut.reduce(function (a, x) { return Math.max(a, x.hi); }, 0);
      var cap = (now && now.cap) || (peak && peak.cap);
      var over = function (v) { return cap && v > cap ? ' class="hi"' : ''; };
      t += '<tr><td>' + esc(it) + '</td><td' + (now ? over(now.mid) : '') + '>' + (now ? n(now.mid) : '—') + '</td>' +
        '<td' + (peak ? over(peak.mid) : '') + '>' + (peak ? n(peak.mid) + '<span class="small muted">（' + (+peak.m.slice(5)) + '月）</span>' : '—') + '</td>' +
        '<td' + over(hiMax) + '>' + (fut.length ? n(hiMax) : '—') + '</td><td>' + (cap ? n(cap) : '—') + '</td></tr>';
    });
    return t + '</tbody></table></div><p class="small muted">赤は容量を超えるところ。「多いとき」は1年のうち幅の上の端がいちばん高い月。</p>';
  }

  // 過去（実線）・いま（点）・見通し（点線と帯）・容量（赤の点線）を1枚に。ライブラリを使わず SVG を手で描く
  function chart(s, label, color) {
    if (!s.length) return none('記録がありません。');
    color = color || 'var(--spark)';
    var W = 320, H = 130, L = 26, R = 6, T = 8, B = 20;
    var xs = s.map(function (x) { return x.m; });
    var months = xs.filter(function (m, i) { return xs.indexOf(m) === i; });
    var cap = s.reduce(function (a, x) { return x.cap || a; }, null);
    var vals = [];
    s.forEach(function (x) { vals.push(x.lo, x.hi); });
    if (cap) vals.push(cap);
    var lo = Math.min.apply(null, vals.concat([0])), hi = Math.max.apply(null, vals);
    if (hi === lo) hi = lo + 1;
    hi = Math.ceil(hi * 1.08);
    var X = function (m) { return L + months.indexOf(m) / Math.max(1, months.length - 1) * (W - L - R); };
    var Y = function (v) { return T + (1 - (v - lo) / (hi - lo)) * (H - T - B); };
    var past = s.filter(function (x) { return x.kind === '実際'; });
    var now = s.filter(function (x) { return x.kind === 'いま'; });
    var fut = s.filter(function (x) { return x.kind === '見通し'; });
    var line = function (arr, key) { return arr.map(function (x, i) { return (i ? 'L' : 'M') + X(x.m).toFixed(1) + ' ' + Y(x[key]).toFixed(1); }).join(' '); };
    var g = '';
    if (fut.length) {
      var startF = now.length ? now : past.slice(-1);
      var band = startF.concat(fut);
      g += '<path d="' + line(band, 'hi') + ' L' + band.slice().reverse().map(function (x) { return X(x.m).toFixed(1) + ' ' + Y(x.lo).toFixed(1); }).join(' L') +
        ' Z" fill="' + color + '" opacity=".16"/>';
      g += '<path d="' + line(band, 'mid') + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-dasharray="4 3"/>';
    }
    if (past.length) g += '<path d="' + line(past.concat(now), 'mid') + '" fill="none" stroke="' + color + '" stroke-width="2"/>';
    now.forEach(function (x) { g += '<circle cx="' + X(x.m).toFixed(1) + '" cy="' + Y(x.mid).toFixed(1) + '" r="3.5" fill="' + color + '"/>'; });
    if (cap) g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(cap).toFixed(1) + '" y2="' + Y(cap).toFixed(1) +
      '" stroke="var(--warn)" stroke-width="1.5" stroke-dasharray="5 4"/><text x="' + (W - R) + '" y="' + (Y(cap) - 3).toFixed(1) +
      '" text-anchor="end" class="cap">容量 ' + cap + '</text>';
    // 目もり: 上下の数字と、最初・いま・最後の月
    var ticks = [lo, Math.round((lo + hi) / 2), hi].map(function (v) {
      return '<text x="' + (L - 4) + '" y="' + (Y(v) + 4).toFixed(1) + '" text-anchor="end">' + v + '</text>' +
        '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" class="grid"/>';
    }).join('');
    var mk = [months[0], now.length ? now[0].m : null, months[months.length - 1]].filter(Boolean).map(function (m, i) {
      var lab = m.slice(2, 4) + '/' + (+m.slice(5));
      return '<text x="' + X(m).toFixed(1) + '" y="' + (H - 5) + '" text-anchor="' + (i === 0 ? 'start' : i === 2 ? 'end' : 'middle') + '">' + lab + '</text>';
    }).join('');
    var nowLine = now.length ? '<line x1="' + X(now[0].m).toFixed(1) + '" x2="' + X(now[0].m).toFixed(1) + '" y1="' + T + '" y2="' + (H - B) + '" class="grid"/>' : '';
    var last = fut.length ? fut[fut.length - 1] : null;
    return (label ? '<div class="small muted">' + esc(label) + (now.length ? '　いま ' + n(now[0].mid) : '') +
      (last ? '　1年後 ' + n(last.mid) + '（' + n(last.lo) + '〜' + n(last.hi) + '）' : '') + '</div>' :
      (now.length || last ? '<div class="small muted">' + (now.length ? 'いま ' + n(now[0].mid) : '') +
        (last ? '　1年後 ' + n(last.mid) + '（' + n(last.lo) + '〜' + n(last.hi) + '）' : '') + '</div>' : '')) +
      '<svg class="herd" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(label || '') + 'の移り変わり">' +
      ticks + nowLine + g + mk + '</svg>';
  }

  function checkLine(rows) {
    var a = rows.filter(function (r) { return r.item === '答え合わせ'; });
    if (!a.length) return '';
    var inside = function (k) {
      var x = a.filter(function (r) { return r.kind === k; });
      return x.filter(function (r) { var v = +r.note; return v >= +r.lo && v <= +r.hi; }).length + '/' + x.length;
    };
    return '<p class="small muted">答え合わせ（' + esc(a[0].month) + '〜' + esc(a[a.length - 1].month) +
      '・1年前から計算して実際とくらべた。除籍の頭数だけは実際に合わせた）: 幅に入った月 経産 ' + inside('経産') +
      '・未経産 ' + inside('未経産') + '</p>';
  }

  // ------------------------------------------------------------ 道順
  // 下のタブ: トップ（#/）・個体（#/cows と #/cow/…）・頭数（#/herd）
  function tabOf() {
    var h = location.hash;
    if (/^#\/cows?(\/|$)/.test(h)) return 'cows';
    if (h === '#/herd') return 'herd';
    if (h === '#/genome') return 'genome';
    if (/^#\/repro(\/|$)/.test(h)) return 'repro';
    return 'top';
  }

  // 繁殖のページ（repro.js）に渡す道具。repro.js は箱と直接は話さない
  window.Farm = {
    app: app, get: get, upsert: upsert, esc: esc, n: n, day: day, md: md, days: days, box: box, none: none,
    src: src, find: function (q) { return find(q); }, byId: function () { return byId; },
    me: function () { return (load() || {}).email || ''; }, tabOf: tabOf
  };
  function markTab(t) {
    var nav = document.getElementById('tabs');
    if (!nav) return;
    nav.hidden = false;
    [].forEach.call(nav.querySelectorAll('a'), function (a) {
      a.className = a.getAttribute('data-tab') === t ? 'on' : '';
    });
  }

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
        var t = tabOf();
        markTab(t);
        app.onclick = app.oninput = null;     // 繁殖のページが付けた受け口を、ほかのページへ持ち越さない
        var m = location.hash.match(/^#\/cow\/(\d{10})/);
        if (m) showCow(m[1]);
        else if (t === 'herd') showHerd();
        else if (t === 'genome') showGenome();
        else if (t === 'repro') window.ReproPage.show(location.hash);
        else if (t === 'cows') showSearch();
        else showTop();
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
