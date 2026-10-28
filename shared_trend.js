/* 牛群管理アプリと月次レポートで共用する繁殖グラフ。 */
(function(root){
  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function md(d){return (+d.slice(5,7))+'/'+(+d.slice(8,10));}
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
  root.FarmTrend={render:trend};
})(window);
