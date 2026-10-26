/* ============================================================
   白川牧場 ゲノム分析エンジン
   計算だけを持つ。画面を触らない（app.js が触る）。
   ここを直したら scripts/selftest.py の数字と突き合わせること。
   ============================================================ */
(function (global) {
  'use strict';

  var D = null;                 // window.__DATA__
  var TR = {};                  // 形質キー → メタ
  var HERD = {};                // 形質キー → 牧場全体の平均とばらつき

  function num(v) { return (v === null || v === undefined || isNaN(v)) ? null : +v; }

  function stats(values) {
    var a = values.filter(function (v) { return v !== null && v !== undefined && !isNaN(v); })
                  .map(Number).sort(function (x, y) { return x - y; });
    if (!a.length) return { n: 0 };
    var n = a.length, sum = 0, i;
    for (i = 0; i < n; i++) sum += a[i];
    var mean = sum / n, v = 0;
    for (i = 0; i < n; i++) v += (a[i] - mean) * (a[i] - mean);
    var sd = n > 1 ? Math.sqrt(v / (n - 1)) : 0;
    function q(p) {
      var idx = (n - 1) * p, lo = Math.floor(idx), hi = Math.ceil(idx);
      return a[lo] + (a[hi] - a[lo]) * (idx - lo);
    }
    return { n: n, mean: mean, sd: sd, min: a[0], max: a[n - 1],
             q1: q(0.25), med: q(0.5), q3: q(0.75) };
  }

  function corr(xs, ys) {
    var n = xs.length;
    if (n < 3) return null;
    var mx = 0, my = 0, i;
    for (i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
    mx /= n; my /= n;
    var sxy = 0, sxx = 0, syy = 0;
    for (i = 0; i < n; i++) {
      var dx = xs[i] - mx, dy = ys[i] - my;
      sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
    }
    if (!sxx || !syy) return null;
    return sxy / Math.sqrt(sxx * syy);
  }

  /* 順位でみた相関。外れ値1頭に引っぱられないので、頭数が少ないときの保険になる */
  function ranks(v) {
    var idx = v.map(function (x, i) { return i; });
    idx.sort(function (a, b) { return v[a] - v[b]; });
    var r = new Array(v.length), i = 0;
    while (i < idx.length) {           // 同じ値は平均順位にする
      var j = i;
      while (j + 1 < idx.length && v[idx[j + 1]] === v[idx[i]]) j++;
      var avg = (i + j) / 2 + 1;
      for (var k = i; k <= j; k++) r[idx[k]] = avg;
      i = j + 1;
    }
    return r;
  }
  function spearman(xs, ys) {
    if (xs.length < 3) return null;
    return corr(ranks(xs), ranks(ys));
  }
  /* 相関の95%信頼区間（フィッシャーのz変換）。
     頭数が少ないと幅が広くなり、0をまたぐかどうかで「言い切れるか」が分かる。 */
  function corrCI(r, n) {
    if (r === null || n < 5 || Math.abs(r) >= 1) return null;
    var z = 0.5 * Math.log((1 + r) / (1 - r)), se = 1 / Math.sqrt(n - 3);
    var back = function (t) { return (Math.exp(2 * t) - 1) / (Math.exp(2 * t) + 1); };
    return [back(z - 1.96 * se), back(z + 1.96 * se)];
  }

  /* ---------- 立ち上げ ---------- */
  function init(data) {
    D = data;
    D.traits.forEach(function (t) { TR[t.k] = t; });
    D.cowById = {};
    D.cows.forEach(function (c) { D.cowById[c.id] = c; });
    D.sireByKey = {};
    D.sires.forEach(function (s) { D.sireByKey[s.key] = s; });
    D.traits.forEach(function (t) {
      HERD[t.k] = stats(D.cows.map(function (c) { return num(c.g[t.k]); }));
    });
    return D;
  }

  /* ---------- 群でしぼる ---------- */
  function group(name) {
    if (name === '在籍') return D.cows.filter(function (c) { return c.status === '在籍'; });
    if (name === 'その他') return D.cows.filter(function (c) { return c.status !== '在籍'; });
    return D.cows.slice();
  }

  /* ---------- 標準化（品種平均とくらべる／牧場の中でくらべる） ---------- */
  function zOf(traitKey, value, mode) {
    var t = TR[traitKey], v = num(value);
    if (!t || v === null) return null;
    var base, sd;
    if (mode === 'herd') {
      var h = HERD[traitKey];
      if (!h || !h.sd) return null;
      base = h.mean; sd = h.sd;
    } else {
      /* 品種平均とくらべる。ものさし（遺伝標準偏差）が分かっていない形質は
         勝手に牧場のばらつきで代用しない。数字が別物になってしまうため。 */
      if (!t.sd) return null;
      base = t.base; sd = t.sd;
    }
    var z = (v - base) / sd;
    return t.better === 'low' ? -z : z;         // 小さいほど良い形質は向きをそろえる
  }

  /* ---------- 全国・北海道とのくらべもの ---------- */
  /* eGプラスの分布（階級ごとの割合）から「この値は全国の何％の位置か」を出す。
     階級の中は均等に散らばっているとみなして、間を線で結ぶ。

     SCSのように**小さいほど良い**形質は、上下をひっくり返す。
     こうするとeGプラスの「日本パーセンタイル」と数字が合う
     （SCS 2.75 は eG で98%、そのままだと1.6%になってしまう）。 */
  function pctIn(traitKey, value, region) {
    var t = TR[traitKey], v = num(value);
    var b = D.bench ? D.bench[traitKey] : null;
    if (!t || v === null || !b || !b.dist || !b.dist.length) return null;
    var cum = 0, got = null;
    for (var i = 0; i < b.dist.length; i++) {
      var d = b.dist[i], p = (d.p && d.p[region] !== undefined) ? d.p[region] : null;
      if (p === null) return null;
      if (v < d.lo) { got = cum; break; }
      if (v <= d.hi) {
        var f = (d.hi > d.lo) ? (v - d.lo) / (d.hi - d.lo) : 0;
        got = cum + p * f;
        break;
      }
      cum += p;
    }
    if (got === null) got = cum;
    got = Math.max(0, Math.min(100, got));
    return t.better === 'low' ? 100 - got : got;
  }
  function pctNational(traitKey, value) { return pctIn(traitKey, value, '日本'); }
  function pctHokkaido(traitKey, value) { return pctIn(traitKey, value, '北海道地区'); }

  function benchOf(traitKey) { return D.bench ? (D.bench[traitKey] || null) : null; }
  function benchTraits() {
    if (!D.bench) return [];
    return D.traits.filter(function (t) { return D.bench[t.k]; });
  }

  /* ---------- 生年ごと（世代の進み方） ---------- */
  function cohorts(cows, traitKey) {
    var by = {};
    cows.forEach(function (c) {
      if (!c.birth) return;
      var y = c.birth.slice(0, 4);
      (by[y] = by[y] || []).push(num(c.g[traitKey]));
    });
    return Object.keys(by).sort().map(function (y) {
      var s = stats(by[y]);
      return { year: y, n: s.n, mean: s.mean, sd: s.sd, med: s.med,
               q1: s.q1, q3: s.q3, min: s.min, max: s.max };
    });
  }

  /* ---------- 種雄牛ごと ---------- */
  /* 母の世代の水準。
     娘 ≒ (父 + 母)/2 なので 母 ≒ 2×娘 − 父。
     検査済みの牛は若い牛ばかりで、母の世代より能力が高い。群平均を母の代わりに使うと
     逆算が低く出るので、PDFで父の値が分かっている種雄牛から母の世代の平均を割り出す。 */
  function damBase(cows, traitKey) {
    var by = {}, i;
    cows.forEach(function (c) {
      if (!c.sireKey) return;
      (by[c.sireKey] = by[c.sireKey] || []).push(num(c.g[traitKey]));
    });
    var sum = 0, w = 0;
    Object.keys(by).forEach(function (k) {
      var sire = D.sireByKey[k];
      if (!sire || !sire.t[traitKey] || sire.t[traitKey].s !== 'PDF') return;
      var s = stats(by[k]);
      if (s.n < 2) return;
      sum += (2 * s.mean - sire.t[traitKey].v) * s.n;
      w += s.n;
    });
    if (!w) return stats(cows.map(function (c) { return num(c.g[traitKey]); })).mean;
    return sum / w;
  }

  /* 生まれ年ごとの平均。世代が進むぶん、あとの年ほど高い。 */
  function cohortMeans(cows, traitKey) {
    var by = {};
    cows.forEach(function (c) {
      if (!c.birth) return;
      var v = num(c.g[traitKey]);
      if (v === null) return;
      var y = c.birth.slice(0, 4);
      (by[y] = by[y] || []).push(v);
    });
    var out = {};
    Object.keys(by).forEach(function (y) { out[y] = stats(by[y]).mean; });
    return out;
  }

  function sireRows(cows, traitKey) {
    var by = {};
    cows.forEach(function (c) {
      if (!c.sireKey) return;
      (by[c.sireKey] = by[c.sireKey] || { key: c.sireKey, name: c.sire, vals: [], cows: [] });
      by[c.sireKey].vals.push(num(c.g[traitKey]));
      by[c.sireKey].cows.push(c);
    });
    var herdMean = stats(cows.map(function (c) { return num(c.g[traitKey]); })).mean;
    var base = damBase(cows, traitKey);

    /* 生まれ年ごとに、牛をまとめておく（同期群の比較に使う） */
    var byYear = {};
    cows.forEach(function (c) {
      if (!c.birth || num(c.g[traitKey]) === null) return;
      (byYear[c.birth.slice(0, 4)] = byYear[c.birth.slice(0, 4)] || []).push(c);
    });

    return Object.keys(by).map(function (k) {
      var r = by[k], s = stats(r.vals), sire = D.sireByKey[k] || null;
      var m = sire && sire.t[traitKey] ? sire.t[traitKey] : null;

      /* ── 同期群比較 ──
         「この牛は、同じ年に生まれた“よその父の娘”とくらべてどうか」を1頭ずつ出し、
         その平均をその種雄牛の成績とする。
         こうしないと、最近つけた精液ほど良く見えてしまう（牧場全体が年々良くなっているため）。
         自分の娘は相手から外す。外さないと、娘が多い精液ほど差が薄まる。 */
      var devs = [], years = {};
      r.cows.forEach(function (c) {
        if (!c.birth) return;
        var y = c.birth.slice(0, 4), v = num(c.g[traitKey]);
        if (v === null) return;
        years[y] = (years[y] || 0) + 1;
        var peers = (byYear[y] || []).filter(function (p) { return p.sireKey !== k; })
                                     .map(function (p) { return num(p.g[traitKey]); })
                                     .filter(function (x) { return x !== null; });
        if (peers.length >= 3) devs.push(v - stats(peers).mean);
      });
      var ds = stats(devs);
      var se = ds.n > 1 ? ds.sd / Math.sqrt(ds.n) : null;

      return {
        key: k, name: r.name, naab: sire ? sire.naab : null,
        n: s.n, mean: s.n ? s.mean : null, sd: s.n ? s.sd : null,
        vsHerd: s.n ? s.mean - herdMean : null,
        adj: ds.n ? ds.mean : null,          // 同期群比較（これが本命）
        adjN: ds.n, se: se,
        ci: (se !== null) ? [ds.mean - 1.96 * se, ds.mean + 1.96 * se] : null,
        years: years,
        master: m ? m.v : null, masterSrc: m ? m.s : null,
        /* 娘の平均から父を逆に見積もった値。精液マスタと近ければ信用してよい目安 */
        backCalc: s.n ? 2 * s.mean - base : null,
        damBase: base
      };
    }).sort(function (a, b) { return b.n - a.n; });
  }

  /* ---------- 母の実績 × 娘のゲノム ---------- */
  var DAM_METRICS = [
    { k: 'me305', label: '母の305日乳量（産次をそろえた値）', unit: 'kg' },
    { k: 'milk305', label: '母の305日乳量（そのまま）', unit: 'kg' },
    { k: 'milkAvg', label: '母の305日乳量（全産次の平均）', unit: 'kg' },
    { k: 'fatPct', label: '母の乳脂率', unit: '%' },
    { k: 'proPct', label: '母の乳蛋白質率', unit: '%' },
    { k: 'scc', label: '母の体細胞数（幾何平均）', unit: '千/mL' },
    { k: 'scs', label: '母の体細胞スコア（実測の平均）', unit: '' },
    { k: 'openDays', label: '母の空胎日数', unit: '日' },
    { k: 'aiCount', label: '母の授精回数', unit: '回' },
    { k: 'calvAge', label: '母の初産分娩月齢', unit: 'か月' }
  ];

  /* 母の実績 × 娘のゲノム値。
     adjust=true のとき、娘の値から「同じ年に生まれた牛の平均」を引く。
     引かないと、最近生まれた娘ほど高く出るぶんが、そのまま相関に乗ってしまう
     （この牧場では2023年生と2026年生でTPIが600ちがう）。 */
  function damPairs(cows, damMetric, traitKey, adjust) {
    var coh = adjust ? cohortMeans(cows, traitKey) : null;
    var out = [];
    cows.forEach(function (c) {
      if (!c.dam) return;
      var p = D.perf[c.dam];
      if (!p) return;
      var x = num(p[damMetric]), y = num(c.g[traitKey]);
      if (x === null || y === null) return;
      var yr = c.birth ? c.birth.slice(0, 4) : null;
      if (adjust) {
        if (!yr || coh[yr] === undefined) return;
        y = y - coh[yr];
      }
      out.push({ x: x, y: y, cow: c, dam: D.dams[c.dam] || null,
                 parity: p.parity, year: yr });
    });
    return out;
  }

  /* ---------- 初産の推移 ---------- */
  function flYears() { return (D.firstLact && D.firstLact.years) || []; }
  function flDilution() { return (D.firstLact && D.firstLact.dilution) || []; }

  /* 初産前期（分娩後5〜150日）の実測を、生まれ年ごとにまとめる。
     ゲノム検査を始める前の世代（2022年生）も入るので、
     「ゲノムが下がった世代で実際の乳も下がったか」を外から確かめられる。 */
  function flByYear(key) {
    var e = (D.firstLact && D.firstLact.early) || {}, by = {};
    Object.keys(e).forEach(function (id) {
      var v = e[id];
      if (!v.by || v[key] === undefined || v[key] === null) return;
      (by[v.by] = by[v.by] || []).push(v[key]);
    });
    return Object.keys(by).sort().map(function (y) {
      var a = by[y];
      return { year: y, n: a.length, mean: a.reduce(function (s, x) { return s + x; }, 0) / a.length };
    });
  }

  /* ゲノム1形質 × 初産前期の実測1項目。
     生まれ年ごとの平均を両方から引いてから重ねる（同期群補正）。
     2023年生と2024年生では買った精液が違うので、そのまま混ぜると
     「年の差」を「ゲノムが当たっている」と読み違えるため。 */
  function flPairs(cows, traitKey, actKey, adjust) {
    var e = (D.firstLact && D.firstLact.early) || {};
    var raw = [];
    cows.forEach(function (c) {
      var a = e[c.id];
      if (!a) return;
      var x = num(c.g[traitKey]), y = num(a[actKey]);
      if (x === null || y === null) return;
      raw.push({ x: x, y: y, year: a.by || (c.birth ? c.birth.slice(0, 4) : null), cow: c, n: a.n });
    });
    if (!adjust) return raw;
    // 1年に4頭未満しかいない年は、その年の平均が当てにならないので落とす
    var cnt = {};
    raw.forEach(function (p) { if (p.year) cnt[p.year] = (cnt[p.year] || 0) + 1; });
    var keep = raw.filter(function (p) { return p.year && cnt[p.year] >= 4; });
    var mx = {}, my = {};
    Object.keys(cnt).forEach(function (y) {
      if (cnt[y] < 4) return;
      var s = keep.filter(function (p) { return p.year === y; });
      mx[y] = s.reduce(function (a, p) { return a + p.x; }, 0) / s.length;
      my[y] = s.reduce(function (a, p) { return a + p.y; }, 0) / s.length;
    });
    return keep.map(function (p) {
      return { x: p.x - mx[p.year], y: p.y - my[p.year],
               year: p.year, cow: p.cow, n: p.n, rawX: p.x, rawY: p.y };
    });
  }

  /* 上位1/3と下位1/3の実測の差。相関係数より現場に伝わる。
     ゲノム値は整数なので同点がよく出る。境目に同点が並ぶと、
     並べ方しだいでどの牛が上位に入るかが変わってしまう。
     牛の番号で必ず順番を決めて、いつ開いても同じ数字が出るようにする。 */
  function flThirds(pairs) {
    if (pairs.length < 9) return null;
    var s = pairs.slice().sort(function (a, b) {
      var ax = (a.rawX !== undefined ? a.rawX : a.x), bx = (b.rawX !== undefined ? b.rawX : b.x);
      if (ax !== bx) return ax - bx;
      return String(a.cow ? a.cow.id : '').localeCompare(String(b.cow ? b.cow.id : ''));
    });
    var k = Math.floor(s.length / 3);
    function avg(arr) {
      return arr.reduce(function (a, p) { return a + (p.rawY !== undefined ? p.rawY : p.y); }, 0) / arr.length;
    }
    var lo = avg(s.slice(0, k)), hi = avg(s.slice(-k));
    return { k: k, lo: lo, hi: hi, diff: hi - lo, pct: lo ? (hi - lo) / lo * 100 : null };
  }

  /* ---------- 母も娘もゲノム済みの組（参考・数が少ない） ---------- */
  function trios(cows) {
    return cows.filter(function (c) { return c.dam && D.cowById[c.dam]; })
               .map(function (c) { return { calf: c, dam: D.cowById[c.dam] }; });
  }

  function paRows(cows, traitKey) {
    return trios(cows).map(function (t) {
      var calf = num(t.calf.g[traitKey]), dam = num(t.dam.g[traitKey]);
      var sire = D.sireByKey[t.calf.sireKey];
      var sv = sire && sire.t[traitKey] ? sire.t[traitKey].v : null;
      var pa = (sv !== null && dam !== null) ? (sv + dam) / 2 : null;
      return {
        calf: t.calf, dam: t.dam, sireName: t.calf.sire,
        calfV: calf, damV: dam, sireV: sv, pa: pa,
        lift: (calf !== null && dam !== null) ? calf - dam : null,   // 引き上げ
        ms: (calf !== null && pa !== null) ? calf - pa : null        // 期待との差
      };
    }).filter(function (r) { return r.calfV !== null && r.damV !== null; });
  }

  /* ---------- 交配シミュレーター ---------- */
  function predict(damCowId, sireKey) {
    var sire = D.sireByKey[sireKey];
    var damCow = D.cowById[damCowId] || null;
    var zaiseki = group('在籍');
    return D.traits.map(function (t) {
      var sv = (sire && sire.t[t.k]) ? sire.t[t.k].v : null;
      var src = (sire && sire.t[t.k]) ? sire.t[t.k].s : null;
      var dv = damCow ? num(damCow.g[t.k]) : null;
      var damIsHerd = false;
      if (dv === null) {                       // 母のゲノムが無ければ在籍平均で代える
        dv = stats(zaiseki.map(function (c) { return num(c.g[t.k]); })).mean;
        damIsHerd = true;
        if (dv === undefined || isNaN(dv)) dv = null;
      }
      var pa = (sv !== null && dv !== null) ? (sv + dv) / 2 : null;
      var herd = stats(zaiseki.map(function (c) { return num(c.g[t.k]); }));
      return {
        trait: t, sire: sv, sireSrc: src, dam: dv, damIsHerd: damIsHerd,
        pa: pa, herdMean: herd.n ? herd.mean : null,
        diff: (pa !== null && herd.n) ? pa - herd.mean : null
      };
    });
  }

  /* ---------- 強み・弱点 ---------- */
  function radar(cows, mode) {
    return D.categories.map(function (cat) {
      var zs = [], used = [];
      cat.traits.forEach(function (tk) {
        var any = false;
        cows.forEach(function (c) {
          var z = zOf(tk, c.g[tk], mode);
          if (z !== null) { zs.push(z); any = true; }
        });
        if (any) used.push(TR[tk] ? TR[tk].label : tk);
      });
      var s = stats(zs);
      return { name: cat.name, z: s.n ? s.mean : 0, n: s.n, used: used };
    });
  }

  function rank(cows, traitKey, cowId) {
    var t = TR[traitKey];
    var arr = cows.map(function (c) { return { id: c.id, v: num(c.g[traitKey]) }; })
                  .filter(function (o) { return o.v !== null; });
    arr.sort(function (a, b) {
      return t && t.better === 'low' ? a.v - b.v : b.v - a.v;
    });
    for (var i = 0; i < arr.length; i++) if (arr[i].id === cowId) return { rank: i + 1, of: arr.length };
    return null;
  }

  global.Engine = {
    init: init, data: function () { return D; }, meta: function (k) { return TR[k]; },
    herd: function (k) { return HERD[k]; },
    group: group, stats: stats, corr: corr, spearman: spearman, corrCI: corrCI,
    zOf: zOf, cohortMeans: cohortMeans,
    pctNational: pctNational, pctHokkaido: pctHokkaido,
    benchOf: benchOf, benchTraits: benchTraits,
    cohorts: cohorts, sireRows: sireRows, damPairs: damPairs,
    flYears: flYears, flByYear: flByYear, flPairs: flPairs,
    flThirds: flThirds, flDilution: flDilution,
    paRows: paRows, trios: trios, predict: predict, radar: radar, rank: rank,
    DAM_METRICS: DAM_METRICS, num: num
  };
})(this);
