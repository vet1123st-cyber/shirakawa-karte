/* 販売と生乳はPC側で月次レポートと同じ集計を作り、同じ箱から読む。 */
(function () {
  window.BusinessPage={show:function(){
    var F=window.Farm;
    F.app.innerHTML='<p>販売・生乳を読んでいます…</p>';
    F.get('farm_summary?select=note&section=eq.'+encodeURIComponent('経営')+'&key=eq.payload').then(function(rows){
      if(location.hash!=='#/business')return;
      if(!rows.length){F.app.innerHTML=F.none('まだTAF販売・配分検査が取り込まれていません。');return;}
      var B=JSON.parse(rows[0].note),last=B.sales.slice(-24);
      var amounts=last.map(function(r){return {d:r.month+'-01',v:r.amount==null?null:r.amount/1000};});
      var heads=last.map(function(r){return {d:r.month+'-01',v:r.n};});
      var periods=B.bulk.slice(-36);
      var bulk=function(key){return periods.map(function(r){return {d:r.date,v:r[key]};});};
      var table='<div style="overflow:auto"><table><thead><tr><th>販売月</th><th>頭数</th><th>金額（千円）</th></tr></thead><tbody>'+last.map(function(r){return '<tr><td>'+F.esc(r.month)+'</td><td>'+r.n+'</td><td>'+F.n(r.amount/1000,0)+'</td></tr>';}).join('')+'</tbody></table></div>';
      F.app.innerHTML='<a class="back" href="#/">← トップ</a>'+F.box('販売・生乳',
        '<p class="small muted">TAF取得 '+F.esc((B.fetched||'').slice(0,10))+'。月次レポートと同じ取込・集計を参照します。</p>')+
        F.box('個体販売：金額（千円）',F.trend([{name:'販売金額',color:'var(--spark)',pts:amounts}],'千円',true))+
        F.box('個体販売：頭数',F.trend([{name:'頭数',color:'var(--spark2)',pts:heads}],'頭',true)+table)+
        F.box('バルク乳：乳脂率・乳蛋白率',F.trend([{name:'乳脂率',color:'var(--spark2)',pts:bulk('脂肪')},{name:'乳蛋白率',color:'var(--spark)',pts:bulk('蛋白')}],'%',false))+
        F.box('バルク乳：体細胞数',F.trend([{name:'体細胞',color:'var(--spark)',pts:bulk('体細胞数')}],'千/ml',false));
    }).catch(function(e){F.app.innerHTML=F.none('読めませんでした：'+e.message);});
  }};
})();
