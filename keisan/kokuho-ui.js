/* 国民健康保険料の計算フォーム。頁の <script id="city-data" type="application/json"> の市の設定と kokuho-calc.js を使う。 */
(function () {
  "use strict";
  var el = document.getElementById("calc");
  var data = document.getElementById("city-data");
  if (!el || !data || !window.KokuhoCalc) return;
  var city = JSON.parse(data.textContent);
  var K = window.KokuhoCalc;
  var MAX = 8;
  var yen = function (v) { return Math.round(v).toLocaleString("ja-JP") + "円"; };
  var NG = city.local && city.local.nagoya;  // 名古屋市の所得割額の独自控除だけに使う入力欄
  var man = function (s) { var v = parseFloat(String(s).replace(/[,，\s]/g, "")); return isFinite(v) && v > 0 ? Math.round(v * 10000) : 0; };

  function row(i) {
    var who = i === 0 ? "世帯主" : "家族" + i;
    return '<fieldset class="mem" data-i="' + i + '"><legend>' + who + (i ? ' <button type="button" class="del" aria-label="' + who + 'を外す">外す</button>' : "") + "</legend>" +
      '<label>年齢（2026年4月1日時点）<input name="age" type="number" inputmode="numeric" min="0" max="74" value="' + (i ? "" : "45") + '" required> 歳</label>' +
      '<label>給与の収入（2025年・税込の年額）<input name="kyuyo" type="text" inputmode="decimal" placeholder="0"> 万円</label>' +
      '<label>年金の収入（2025年・年額）<input name="nenkin" type="text" inputmode="decimal" placeholder="0"> 万円</label>' +
      '<label>その他の所得（事業所得など・経費を引いた後）<input name="other" type="text" inputmode="decimal" placeholder="0"> 万円</label>' +
      '<label class="chk"><input name="rishoku" type="checkbox"> 倒産・解雇・雇止めなどで離職した（65歳未満・ハローワークの離職理由が対象のもの）</label>' +
      (NG ? '<label>この人が申告した扶養家族（障害者控除の対象でない人・16歳未満も含む）<input name="fuyo" type="number" inputmode="numeric" min="0" max="9" placeholder="0"> 人</label>' +
        '<label>この人が申告した扶養家族（障害者控除の対象の人）<input name="fuyoSho" type="number" inputmode="numeric" min="0" max="9" placeholder="0"> 人</label>' +
        '<label class="chk"><input name="honnin" type="checkbox"> この人が障害者控除（本人）・寡婦控除・ひとり親控除の対象</label>' : "") +
      "</fieldset>";
  }

  el.innerHTML = '<form id="kf" onsubmit="return false"><div id="mems">' + row(0) + '</div>' +
    '<p><button type="button" id="add">＋ 家族（国保に入る人）を加える</button></p></form><div id="out" aria-live="polite"></div>';
  var mems = document.getElementById("mems");
  var out = document.getElementById("out");

  function renum() {
    Array.prototype.forEach.call(mems.querySelectorAll("fieldset.mem"), function (f, i) {
      f.dataset.i = i;
      f.querySelector("legend").firstChild.nodeValue = i === 0 ? "世帯主" : "家族" + i + " ";
    });
    document.getElementById("add").disabled = mems.children.length >= MAX;
  }

  function read() {
    var ms = [];
    Array.prototype.forEach.call(mems.querySelectorAll("fieldset.mem"), function (f) {
      var age = f.querySelector('[name="age"]').value;
      if (age === "") return;
      ms.push({age: Math.max(0, Math.min(74, parseInt(age, 10) || 0)), kyuyo: man(f.querySelector('[name="kyuyo"]').value),
               nenkin: man(f.querySelector('[name="nenkin"]').value), other: man(f.querySelector('[name="other"]').value),
               rishoku: f.querySelector('[name="rishoku"]').checked,
               fuyo: NG ? Math.max(0, Math.min(9, parseInt(f.querySelector('[name="fuyo"]').value, 10) || 0)) : 0,
               fuyoSho: NG ? Math.max(0, Math.min(9, parseInt(f.querySelector('[name="fuyoSho"]').value, 10) || 0)) : 0,
               honnin: NG ? f.querySelector('[name="honnin"]').checked : false});
    });
    return ms;
  }

  function show() {
    var ms = read();
    if (!ms.length) { out.innerHTML = '<p class="muted">年齢を入れると計算します。</p>'; return; }
    var r = K.calc(city, {members: ms});
    var LOC = city.local || {};
    var kg = {0.7: "7割軽減", 0.5: "5割軽減", 0.2: "2割軽減"}[r.keigen] || (r.genmen ? "市独自の2割減免" : "軽減なし");
    if (r.keigen && r.genmen) kg += "＋市独自の2割減免";
    var SHORT = {iryo: "医療分", shien: "支援金分", kaigo: "介護分", kodomo: "子ども分"};
    var rows = K.PARTS.filter(function (p) { return city.parts[p]; }).map(function (p) {
      var x = r.parts[p];
      var parts = ["所得割 " + yen(x.shotoku), "均等割 " + yen(Math.floor(x.kintou))];
      if (x.byodo) parts.push("平等割 " + yen(Math.floor(x.byodo)));
      return "<tr><th>" + SHORT[p] + "</th><td class=num><b>" + yen(x.amount) + "</b>" + (x.capped ? "<br>（上限）" : "") +
        "</td><td class=muted>" + (x.amount || x.sum ? parts.join("＋") : "かかりません") + "</td></tr>";
    }).join("");
    var notes = [];
    if (r.keigen) notes.push("世帯の所得が基準以下のため、均等割" + (Object.keys(city.parts).some(function (p) { return city.parts[p].byo; }) ? "・平等割" : "") + "が" + kg.replace("軽減", "") + "安くなっています。");
    if (r.genmen && LOC.sendai_genmen) notes.push(city.name + "の制度で、世帯の所得が基準未満（または2割軽減の世帯）のため、全区分の均等割・平等割（軽減前の額）の2割をさらに差し引いています（所得が一定額以下の方の減免）。区分の年額は減免の後、内訳の均等割・平等割は減免の前の額です。");
    else if (r.genmen) notes.push(city.name + "の制度で、世帯の所得が基準未満のため、医療分・支援金分・介護分の均等割・平等割が2割安くなっています（市独自の減免）。");
    if (LOC.sendai_child && ms.some(function (m) { return m.age <= 17; })) notes.push(city.name + "の制度で、18歳になった年度の3月31日までの子どもは、医療分・支援金分・介護分の均等割も全額減免されています（子育て世帯の減免）。");
    else if (ms.some(function (m) { return m.age <= 5; })) notes.push("未就学児の均等割（医療分・支援金分）は半額になっています。");
    if (ms.some(function (m) { return m.age <= 17; })) notes.push("18歳になった年度の3月31日までの子どもは、子ども・子育て支援金分の均等割がかかりません。");
    if (ms.some(function (m) { return m.age >= 65; })) notes.push("65〜74歳の人の介護保険料は、国民健康保険" + city.kindWord + "とは別に介護保険から請求されます。");
    if (r.members[0] && r.members[0].yokohamaChild) notes.push("横浜市の制度で、19歳未満の子どもの分として世帯主の所得割の計算から" + yen(r.members[0].yokohamaChild) + "を差し引いています。");
    if (NG && r.members.some(function (m) { return m.nagoyaDed; })) notes.push(city.name + "の制度で、扶養家族・本人の障害等の控除（所得割額の独自控除）を所得割から差し引いています。");
    if (NG && r.keigen) notes.push(city.name + "の制度で、医療分の均等割から1人につき2,000円を差し引いています（均等割額の独自控除）。");
    out.innerHTML = '<div class="result"><p class="big">年額 <b>' + yen(r.total) + "</b></p><p>1か月あたり 約" + yen(r.total / 12) +
      "（年額÷12。実際の納付は年" + (city.installments || "8〜10") + "回などに分かれます）・" + kg + "</p>" +
      '<div class="tbl"><table><tr><th>区分</th><th>年額</th><th>内訳</th></tr>' + rows + "</table></div>" +
      (notes.length ? "<ul>" + notes.map(function (n) { return "<li>" + n + "</li>"; }).join("") + "</ul>" : "") +
      '<p class="muted">2025年（1〜12月）の収入で計算した、年度の初めから終わりまで加入した場合の目安です。正式な金額は' + city.name + "からの通知で確かめてください。</p></div>";
  }

  document.getElementById("add").addEventListener("click", function () {
    if (mems.children.length >= MAX) return;
    mems.insertAdjacentHTML("beforeend", row(mems.children.length));
    renum();
    show();
  });
  mems.addEventListener("click", function (e) {
    if (e.target.classList.contains("del")) { e.target.closest("fieldset").remove(); renum(); show(); }
  });
  mems.addEventListener("input", show);
  mems.addEventListener("change", show);
  show();
})();
