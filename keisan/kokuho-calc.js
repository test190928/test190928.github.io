/* 国民健康保険料（税）の計算（令和8年度）。ブラウザと node（build.py・照合）で同じものを使う。
 * 全国共通の規則（所得の計算・軽減の基準・未就学児と子どもの軽減・基礎控除）はここに、市ごとの料率と端数の処理は city に置く。
 * 根拠: さいたま市「国民健康保険税の計算」「軽減（低所得）」「軽減（未就学児）」「所得の種類と所得金額の算出方法」（evidence/ に原文）。
 *
 * household = {members: [{age, kyuyo, nenkin, other, rishoku}]}（members[0] が世帯主）
 *   age: 2026年4月1日時点の年齢。5歳以下＝未就学児、17歳以下＝子ども（18歳になった年度の3月31日まで）、
 *        40〜64歳＝介護分あり、65〜74歳＝年金の控除・軽減判定で65歳以上の扱い。年度の途中で40・65・75歳になる人の月割は扱わない。
 *        誕生日が1月1日〜4月1日の人は、前年12月31日・1月1日時点の年齢が1つ下になる（ここでは同じ年齢として扱う）
 *   kyuyo: 給与収入（源泉徴収票の支払金額）/ nenkin: 公的年金等の収入 / other: その他の所得（事業所得など・所得金額）
 *   rishoku: 倒産・解雇・雇止めなどで離職した（非自発的失業者の軽減。給与所得を 30/100 にする。離職時 65歳未満のみ）
 * 世帯主・加入者は全員、年度の初めから終わりまで国保に加入している前提（月割・擬制世帯主・特定同一世帯所属者は扱わない）。
 */
(function (root) {
  "use strict";
  var PARTS = ["iryo", "shien", "kaigo", "kodomo"];
  var LABEL = {iryo: "医療分", shien: "後期高齢者支援金分", kaigo: "介護分", kodomo: "子ども・子育て支援金分"};
  var MAN = 10000;

  function floor(v) { return Math.floor(v + 1e-9); }
  function floorTo(v, unit) { return Math.floor((v + 1e-9) / unit) * unit; }
  function ceilTo(v, unit) { return Math.ceil((v - 1e-9) / unit) * unit; }

  // 給与所得（令和8年度以降の速算表。令和7年分の給与収入から）
  function kyuyoShotoku(a) {
    if (a < 651000) return 0;
    if (a < 1900000) return a - 650000;
    var b4 = Math.floor(a / 4000) * 4000;
    if (a < 3600000) return b4 * 7 / 10 - 80000;
    if (a < 6600000) return b4 * 8 / 10 - 440000;
    if (a < 8500000) return floor(a * 9 / 10) - 1100000;
    return a - 1950000;
  }

  // 公的年金等に係る雑所得（令和3年度以降の速算表）。otherTotal は年金以外の合計所得
  function nenkinShotoku(a, senior, otherTotal) {
    var adj = otherTotal > 20000000 ? 200000 : otherTotal > 10000000 ? 100000 : 0;
    var v;
    if (a < (senior ? 3300000 : 1300000)) v = a - (senior ? 1100000 : 600000);
    else if (a < 4100000) v = a * 0.75 - 275000;
    else if (a < 7700000) v = a * 0.85 - 685000;
    else if (a < 10000000) v = a * 0.95 - 1455000;
    else v = a - 1955000;
    return Math.max(0, floor(v + adj));
  }

  // 基礎控除（住民税の額。合計所得 2,400万円超で段階的に減る）
  function kisoKojo(total) {
    if (total <= 24000000) return 430000;
    if (total <= 24500000) return 290000;
    if (total <= 25000000) return 150000;
    return 0;
  }

  // 照合用の年齢区分（cat）を年齢に直す
  var CAT_AGE = {pre: 4, child: 13, teen: 16, adult: 29, kaigo: 49, senior: 69};
  function ageOf(m) { return m.age != null && m.age !== "" ? +m.age : CAT_AGE[m.cat]; }
  function catOf(age) {
    if (age <= 5) return "pre";
    if (age <= 17) return "child";
    if (age >= 65) return "senior";
    if (age >= 40) return "kaigo";
    return "adult";
  }

  function person(m) {
    var kyuyo = +m.kyuyo || 0, nenkin = +m.nenkin || 0, other = +m.other || 0;
    var senior = m.cat === "senior";
    var ks = kyuyoShotoku(kyuyo);
    // 非自発的失業者の軽減は離職時に65歳未満の人だけ（65〜74歳の区分では使わない）
    if (m.rishoku && !senior) ks = floor(ks * 30 / 100);
    var ns = nenkinShotoku(nenkin, senior, Math.max(0, other + ks));
    var adj = 0;  // 所得金額調整控除（給与所得と年金所得の両方があるとき）
    if (ks > 0 && ns > 0) adj = Math.max(0, Math.min(ks, 100000) + Math.min(ns, 100000) - 100000);
    ks = Math.max(0, ks - adj);
    var total = Math.max(0, other + ks + ns);
    var base = Math.max(0, total - kisoKojo(total));
    var hantei = senior ? total - Math.min(ns, 150000) : total;
    var kyuyoTo = kyuyo > 550000 || nenkin > (senior ? 1250000 : 600000);
    return {kyuyoShotoku: ks, nenkinShotoku: ns, total: total, base: base, hantei: Math.max(0, hantei), kyuyoTo: kyuyoTo};
  }

  // 軽減の割合（0 / 0.2 / 0.5 / 0.7）。令和8年度の基準
  function keigen(hanteiTotal, n, nKyuyo) {
    var k = Math.max(0, nKyuyo - 1) * 100000;
    if (hanteiTotal <= 430000 + k) return 0.7;
    if (hanteiTotal <= 430000 + 310000 * n + k) return 0.5;
    if (hanteiTotal <= 430000 + 570000 * n + k) return 0.2;
    return 0;
  }

  function liable(part, m) { return part === "kaigo" ? m.cat === "kaigo" : true; }

  function calc(city, household) {
    var ms = household.members.filter(function (m) { return m && (m.cat || (m.age != null && m.age !== "")); })
      .map(function (m) { var a = ageOf(m); return {age: a, cat: catOf(a), kyuyo: m.kyuyo, nenkin: m.nenkin, other: m.other, rishoku: m.rishoku}; });
    var ps = ms.map(person);
    var loc = city.local || {};
    // 横浜市: 19歳未満で所得58万円以下の被保険者1人につき、世帯主の基準総所得金額（所得割の基礎）から控除する（軽減の判定には使わない）
    if (loc.yokohama_child && ps.length) {
      var y = loc.yokohama_child, ded = 0;
      ms.forEach(function (m, i) {
        if (i > 0 && m.age < 19 && ps[i].total <= y.limit) ded += m.age < 16 ? y.u16 : y.u19;
      });
      ps[0].base = Math.max(0, ps[0].base - ded);
      ps[0].yokohamaChild = ded;
    }
    var n = ms.length;
    var hantei = ps.reduce(function (s, p) { return s + p.hantei; }, 0);
    var nKyuyo = ps.filter(function (p) { return p.kyuyoTo; }).length;
    var rate = n ? keigen(hantei, n, nKyuyo) : 0;
    // 千葉市: 法定軽減に当たらず、軽減判定所得が 基準×√人数（1万円単位に切上げ）未満の世帯は、医療・後期・介護分の均等割・平等割を市独自に2割減免（公式の試算表の式）
    var genmen = 0, cg = loc.chiba_genmen;
    if (cg && n && !rate && hantei < ceilTo(cg.base * Math.sqrt(n), cg.unit)) genmen = cg.rate;
    var r = city.round || {};
    var res = {members: ps, keigen: rate, genmen: genmen, hantei: hantei, parts: {}, total: 0};
    PARTS.forEach(function (part) {
      var c = city.parts[part];
      if (!c) return;
      var pr = genmen && cg.parts.indexOf(part) >= 0 ? genmen : rate;  // この区分に当てる軽減（減免）の割合
      var keep = 1 - pr;
      var who = ms.filter(function (m) { return liable(part, m); });
      var idx = ms.map(function (m, i) { return liable(part, m) ? i : -1; }).filter(function (i) { return i >= 0; });
      if (!who.length) { res.parts[part] = {shotoku: 0, kintou: 0, byodo: 0, sum: 0, amount: 0, capped: false}; return; }
      var shotoku;
      if (r.shotoku === "household") {
        // r.shotoku_round に挙げた区分は1円未満を四捨五入（江戸川区の公式の試算: 医療・支援・子ども分は四捨五入、介護分は切捨て）
        var hb = idx.reduce(function (s, i) { return s + ps[i].base; }, 0) * c.rate;
        shotoku = (r.shotoku_round || []).indexOf(part) >= 0 ? Math.round(hb) : floor(hb);
      } else {
        shotoku = idx.reduce(function (s, i) { return s + floor(floorTo(ps[i].base, r.base || 1) * c.rate); }, 0);
      }
      var kin = 0;
      who.forEach(function (m) {
        var v;
        if (part === "kodomo") v = (m.cat === "pre" || m.cat === "child") ? 0 : c.kin + (c.kin18 || 0);
        // 未就学児の軽減額（均等割の5割）は1円未満を切り上げる（均等割が奇数の小田原市の公式の試算: 27,645円→軽減13,823円）
        else if (m.cat === "pre") v = r.kintou ? c.kin - Math.ceil(c.kin / 2) : c.kin / 2;
        else v = c.kin;
        kin += v;
      });
      var byo = c.byo || 0;
      if (r.kintou) {
        // 軽減額を r.kintou 円単位で切り上げて引く（世帯の均等割・平等割の合計それぞれに）
        kin = floorTo(kin, 1) - ceilTo(kin * pr, r.kintou);
        byo = byo - ceilTo(byo * pr, r.kintou);
      } else {
        kin = kin * keep;
        byo = byo * keep;
      }
      var sum = shotoku + kin + byo;
      var amount = floorTo(sum, r.part || 1);
      var capped = amount > c.cap;
      if (capped) amount = c.cap;
      res.parts[part] = {shotoku: shotoku, kintou: kin, byodo: byo, sum: sum, amount: amount, capped: capped};
      res.total += amount;
    });
    if (r.total) res.total = floorTo(res.total, r.total);
    return res;
  }

  var api = {calc: calc, catOf: catOf, kyuyoShotoku: kyuyoShotoku, nenkinShotoku: nenkinShotoku, keigen: keigen, PARTS: PARTS, LABEL: LABEL};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.KokuhoCalc = api;
})(this);
