(function () {
  "use strict";
  var REFRESH_MS = 5 * 60 * 1000;
  var NS = "http://www.w3.org/2000/svg";
  var PALETTE = 9;
  var DAY_MS = 86400 * 1000;
  var state = { data: null, view: "total", range: "all", sort: "pnl", dir: -1, pick: null };

  // ---------- helpers ----------
  function usd(x, signed) {
    if (x == null || isNaN(x)) return "—";
    var s = Math.abs(x).toLocaleString("en-US", { style: "currency", currency: "USD" });
    if (signed === false) return (x < -0.004 ? "−" : "") + s;
    return (x < -0.004 ? "−" : x > 0.004 ? "+" : "") + s;
  }
  function pct(x) { return x == null || isNaN(x) ? "—" : (x * 100).toFixed(x >= 0.995 || x < 0.1 ? 1 : 0) + "%"; }
  function ratio(x) { return x == null || isNaN(x) ? "—" : x === Infinity ? "∞" : x.toFixed(2); }
  function tone(x) { return x == null ? "" : x > 0.004 ? "pos" : x < -0.004 ? "neg" : "flat"; }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function svgEl(tag, attrs, text) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }
  function ago(iso) {
    var s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    if (s < 90) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 86400 * 2) return Math.round(s / 3600) + " h ago";
    return Math.round(s / 86400) + " days ago";
  }
  function dayLabel(d) {
    var t = d.length === 10 ? Date.parse(d + "T12:00:00Z") : Date.parse(d);
    return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: d.length === 10 ? "UTC" : undefined });
  }
  function stamp(iso) {
    return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
  function color(i) { return "var(--s" + (i % PALETTE + 1) + ")"; }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function sum(a, f) { return a.reduce(function (acc, x) { return acc + f(x); }, 0); }

  // ---------- analytics ----------
  // Each strategy carries `daily`: [{d: "YYYY-MM-DD", eq: cumulative P&L at day end, n: trades that day}].
  function stats(s) {
    var eq = (s.daily || []).map(function (p) { return p.eq; });
    var changes = eq.map(function (v, i) { return v - (i ? eq[i - 1] : 0); });
    var peak = 0, dd = 0;
    eq.forEach(function (v) { peak = Math.max(peak, v); dd = Math.max(dd, peak - v); });
    var traded = changes.filter(function (c, i) { return Math.abs(c) > 0.004 || (s.daily[i] && s.daily[i].n > 0); });
    var settled = s.wins == null ? null : s.wins + s.losses;
    return {
      changes: changes,
      week: eq.length ? eq[eq.length - 1] - (eq.length > 7 ? eq[eq.length - 8] : 0) : 0,
      best: changes.length ? Math.max.apply(null, changes) : null,
      worst: changes.length ? Math.min.apply(null, changes) : null,
      drawdown: dd,
      upDays: traded.length ? traded.filter(function (c) { return c > 0.004; }).length / traded.length : null,
      winRate: settled ? s.wins / settled : null,
      perTrade: settled ? s.pnl / settled : null,
      profitFactor: s.gross_loss ? s.gross_win / s.gross_loss : s.gross_win ? Infinity : null,
      status: s.stopped ? "Stopped" : s.trades === 0 ? "Waiting" : s.open > 0 ? "In a position" : "Running"
    };
  }

  // Portfolio end-of-day series: every strategy's last known value carried forward, 0 before its start.
  function portfolio(list) {
    var days = {};
    list.forEach(function (s) { (s.daily || []).forEach(function (p) { days[p.d] = true; }); });
    var order = Object.keys(days).sort();
    var last = {};
    return order.map(function (d) {
      var row = { d: d, total: 0, n: 0 };
      list.forEach(function (s) {
        var hit = (s.daily || []).filter(function (p) { return p.d === d; })[0];
        if (hit) { last[s.label] = hit.eq; row.n += hit.n; }
        row[s.label] = last[s.label] || 0;
        row.total += row[s.label];
      });
      return row;
    });
  }

  // ---------- data ----------
  function load() {
    fetch("data/results.json?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) { state.data = d; render(); })
      .catch(function () {
        if (!state.data) document.getElementById("updated").textContent = "Results are not available right now";
      });
  }

  function render() {
    var d = state.data;
    var list = d.strategies || [];
    list.forEach(function (s, i) { s.color = color(i); s.st = stats(s); });
    var book = portfolio(list);
    if (!state.pick || !list.some(function (s) { return s.label === state.pick; })) {
      state.pick = list.slice().sort(function (a, b) { return b.trades - a.trades; })[0].label;
    }
    var upd = document.getElementById("updated");
    upd.textContent = "Updated " + ago(d.updated);
    upd.title = stamp(d.updated);
    document.getElementById("live").classList.toggle("stale", Date.now() - Date.parse(d.updated) > 3 * 3600 * 1000);
    document.getElementById("note").textContent = d.note || "";
    tiles(list, book, d.history || []);
    mainChart(list, book, d.history || []);
    dailyBars(document.getElementById("bars"), book.map(function (r, i) {
      return { d: r.d, v: r.total - (i ? book[i - 1].total : 0), n: r.n };
    }));
    underwater(document.getElementById("dd"), book.map(function (r) { return { d: r.d, v: r.total }; }));
    table(list);
    cards(list);
    detail(list);
  }

  // ---------- tiles ----------
  function tiles(list, book, history) {
    var total = sum(list, function (s) { return s.pnl; });
    var change = null;
    if (history.length > 1) {
      var cutoff = Date.parse(history[history.length - 1].t) - DAY_MS, base = null;
      for (var i = history.length - 1; i >= 0; i--) { if (Date.parse(history[i].t) <= cutoff) { base = history[i]; break; } }
      if (base) change = total - sum(list, function (s) { return typeof base[s.label] === "number" ? base[s.label] : 0; });
    }
    var week = sum(list, function (s) { return s.st.week; });
    var peak = 0, dd = 0, ddDay = null;
    book.forEach(function (r) { peak = Math.max(peak, r.total); if (peak - r.total > dd) { dd = peak - r.total; ddDay = r.d; } });
    var wins = sum(list, function (s) { return s.wins || 0; }), losses = sum(list, function (s) { return s.losses || 0; });
    var gw = sum(list, function (s) { return s.gross_win || 0; }), gl = sum(list, function (s) { return s.gross_loss || 0; });
    var trades = sum(list, function (s) { return s.trades; });
    var running = list.filter(function (s) { return !s.stopped; }).length;
    var box = document.getElementById("tiles");
    clear(box);
    [
      ["Total P&L", usd(total), tone(total), change == null ? "All strategies combined" : usd(change) + " in the last 24 h"],
      ["Last 7 days", usd(week), tone(week), "Change over the past week"],
      ["Max drawdown", dd > 0.004 ? usd(-dd) : "$0.00", dd > 0.004 ? "neg" : "", ddDay ? "Deepest on " + dayLabel(ddDay) : "Peak to trough, end of day"],
      ["Win rate", pct(wins + losses ? wins / (wins + losses) : null), "", (wins + losses).toLocaleString("en-US") + " settled trades"],
      ["Profit factor", ratio(gl ? gw / gl : null), "", "Gross wins ÷ gross losses"],
      ["Trades", trades.toLocaleString("en-US"), "", running + " running · " + (list.length - running) + " stopped"]
    ].forEach(function (t) {
      var tile = el("div", "tile");
      tile.appendChild(el("div", "k", t[0]));
      tile.appendChild(el("div", "v " + t[2], t[1]));
      tile.appendChild(el("div", "h", t[3]));
      box.appendChild(tile);
    });
  }

  // ---------- line chart ----------
  // points: [{t: ms, label: string, ...values}], series: [{key, label, color, bold}]
  function lineChart(box, points, series, opts) {
    opts = opts || {};
    clear(box);
    if (points.length < 2) {
      box.appendChild(el("p", "empty", opts.empty || "Not enough data yet. Check back soon."));
      return;
    }
    var W = Math.max(300, Math.round(box.clientWidth || 880)), H = opts.height || (W < 600 ? 220 : 300);
    var L = 64, R = 16, T = 14, B = 30;
    var t0 = points[0].t, t1 = points[points.length - 1].t;
    var lo = 0, hi = 0;
    series.forEach(function (s) { points.forEach(function (p) {
      var v = p[s.key]; if (typeof v === "number") { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    }); });
    if (hi - lo < 1) { hi += 0.5; lo -= 0.5; }
    var pad = (hi - lo) * 0.08; hi += opts.capTop ? 0 : pad; lo -= pad;
    var x = function (t) { return L + (t - t0) / (t1 - t0) * (W - L - R); };
    var y = function (v) { return T + (hi - v) / (hi - lo) * (H - T - B); };
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H });
    for (var i = 0; i <= 4; i++) {
      var v = lo + (hi - lo) * i / 4;
      svg.appendChild(svgEl("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), "class": "grid" }));
      svg.appendChild(svgEl("text", { x: L - 10, y: y(v) + 4, "text-anchor": "end" }, usd(v, false)));
    }
    svg.appendChild(svgEl("line", { x1: L, x2: W - R, y1: y(0), y2: y(0), "class": "zero" }));
    var ticks = W < 500 ? 2 : 4;
    for (var j = 0; j <= ticks; j++) {
      var t = t0 + (t1 - t0) * j / ticks;
      svg.appendChild(svgEl("text", { x: x(t), y: H - 8, "text-anchor": j === 0 ? "start" : j === ticks ? "end" : "middle" },
        opts.hours ? new Date(t).toLocaleTimeString(undefined, { hour: "numeric" }) :
          new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" })));
    }
    series.forEach(function (s) {
      var pts = [];
      points.forEach(function (p) { if (typeof p[s.key] === "number") pts.push(x(p.t).toFixed(1) + "," + y(p[s.key]).toFixed(1)); });
      if (pts.length < 2) return;
      if (s.bold) {
        svg.appendChild(svgEl("polygon", { points: pts.join(" ") + " " + x(t1).toFixed(1) + "," + y(0) + " " + x(t0).toFixed(1) + "," + y(0),
          "class": opts.areaClass || "area" }));
      }
      var line = svgEl("polyline", { points: pts.join(" "), fill: "none", "stroke-width": s.bold ? 2.5 : 1.8,
        "stroke-linejoin": "round", "stroke-linecap": "round" });
      line.style.stroke = s.color;
      svg.appendChild(line);
    });
    hover(box, svg, W, points.map(function (p) { return x(p.t); }), function (k) {
      return { title: points[k].label, rows: series.map(function (s) { return [s.color, s.label, points[k][s.key]]; }) };
    }, T, H - B);
  }

  // Shared hover: vertical guide plus a tooltip with one row per series.
  function hover(box, svg, W, xs, rowsAt, top, bottom) {
    var guide = svgEl("line", { y1: top, y2: bottom, "class": "guide" });
    guide.style.display = "none";
    svg.appendChild(guide);
    var tip = el("div", "tip");
    tip.hidden = true;
    box.appendChild(svg);
    box.appendChild(tip);
    function move(clientX) {
      var r = svg.getBoundingClientRect();
      var px = (clientX - r.left) / r.width * W, k = 0;
      for (var n = 1; n < xs.length; n++) if (Math.abs(xs[n] - px) < Math.abs(xs[k] - px)) k = n;
      guide.setAttribute("x1", xs[k]); guide.setAttribute("x2", xs[k]); guide.style.display = "";
      var info = rowsAt(k);
      clear(tip);
      tip.appendChild(el("div", "tip-t", info.title));
      info.rows.forEach(function (row) {
        if (typeof row[2] !== "number") return;
        var line = el("div", "tip-row");
        var sw = el("span", "sw"); sw.style.background = row[0];
        line.appendChild(sw); line.appendChild(el("span", null, row[1]));
        line.appendChild(el("span", "num " + (row[3] || tone(row[2])), row[4] || usd(row[2])));
        tip.appendChild(line);
      });
      tip.hidden = false;
      var left = xs[k] / W * r.width;
      tip.style.left = (left + 12 + tip.offsetWidth > r.width ? Math.max(left - tip.offsetWidth - 12, 0) : left + 12) + "px";
    }
    svg.addEventListener("mousemove", function (e) { move(e.clientX); });
    svg.addEventListener("touchmove", function (e) { if (e.touches[0]) move(e.touches[0].clientX); }, { passive: true });
    svg.addEventListener("mouseleave", function () { tip.hidden = true; guide.style.display = "none"; });
  }

  // ---------- main chart ----------
  function mainChart(list, book, history) {
    var series = state.view === "total"
      ? [{ key: "total", label: "Total", color: "var(--accent)", bold: true }]
      : list.map(function (s) { return { key: s.label, label: s.label, color: s.color }; });
    var points;
    if (state.range === "24h") {
      var end = history.length ? Date.parse(history[history.length - 1].t) : 0;
      points = history.filter(function (p) { return Date.parse(p.t) >= end - DAY_MS; }).map(function (p) {
        var q = { t: Date.parse(p.t), label: stamp(p.t), total: 0 };
        list.forEach(function (s) { q[s.label] = typeof p[s.label] === "number" ? p[s.label] : null; q.total += q[s.label] || 0; });
        return q;
      });
    } else {
      var rows = state.range === "7d" ? book.slice(-8) : book;
      points = rows.map(function (r, i) {
        var last = i === rows.length - 1;
        var q = { t: last ? Date.parse(state.data.updated) : Date.parse(r.d + "T00:00:00Z") + DAY_MS,
                  label: last ? "Now" : "End of " + dayLabel(r.d) };
        q.total = r.total;
        list.forEach(function (s) { q[s.label] = r[s.label]; });
        return q;
      });
    }
    lineChart(document.getElementById("chart"), points, series, { hours: state.range === "24h",
      empty: "The 24-hour view fills in as hourly updates arrive." });
    var legend = document.getElementById("legend");
    clear(legend);
    if (state.view === "each") {
      series.forEach(function (s) {
        var item = el("span", null, s.label);
        item.style.setProperty("--c", s.color);
        legend.appendChild(item);
      });
    }
  }

  // ---------- daily bars ----------
  function dailyBars(box, rows, height) {
    clear(box);
    if (!rows.length) { box.appendChild(el("p", "empty", "No daily results yet.")); return; }
    var W = Math.max(300, Math.round(box.clientWidth || 420)), H = height || 220, L = 56, R = 8, T = 10, B = 26;
    var lo = Math.min(0, Math.min.apply(null, rows.map(function (r) { return r.v; })));
    var hi = Math.max(0, Math.max.apply(null, rows.map(function (r) { return r.v; })));
    if (hi - lo < 0.5) { hi += 0.25; lo -= 0.25; }
    var y = function (v) { return T + (hi - v) / (hi - lo) * (H - T - B); };
    var slot = (W - L - R) / rows.length, bw = Math.max(2, Math.min(28, slot * 0.7));
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H });
    [hi, (hi + lo) / 2, lo].forEach(function (v) {
      svg.appendChild(svgEl("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), "class": "grid" }));
      svg.appendChild(svgEl("text", { x: L - 8, y: y(v) + 4, "text-anchor": "end" }, usd(v, false)));
    });
    var xs = [];
    rows.forEach(function (r, i) {
      var cx = L + slot * (i + 0.5);
      xs.push(cx);
      var h = Math.max(Math.abs(y(r.v) - y(0)), Math.abs(r.v) > 0.004 ? 1.5 : 0);
      svg.appendChild(svgEl("rect", { x: (cx - bw / 2).toFixed(1), y: (r.v >= 0 ? y(0) - h : y(0)).toFixed(1),
        width: bw.toFixed(1), height: h.toFixed(1), rx: 2, "class": r.v >= 0 ? "bar-pos" : "bar-neg" }));
    });
    svg.appendChild(svgEl("line", { x1: L, x2: W - R, y1: y(0), y2: y(0), "class": "zero" }));
    var every = Math.ceil(rows.length / (W < 500 ? 4 : 7));
    rows.forEach(function (r, i) {
      if ((rows.length - 1 - i) % every === 0) {
        svg.appendChild(svgEl("text", { x: xs[i], y: H - 8, "text-anchor": "middle" }, dayLabel(r.d)));
      }
    });
    hover(box, svg, W, xs, function (k) {
      var r = rows[k];
      return { title: dayLabel(r.d) + (k === rows.length - 1 ? " (so far)" : ""),
               rows: [["var(--muted)", "P&L", r.v], ["var(--line)", "Trades", r.n, "", String(r.n)]] };
    }, T, H - B);
  }

  // ---------- drawdown ----------
  function underwater(box, rows, height) {
    var peak = 0;
    var pts = rows.map(function (r, i) {
      peak = Math.max(peak, r.v);
      return { t: i === rows.length - 1 ? Date.parse(state.data.updated) : Date.parse(r.d + "T00:00:00Z") + DAY_MS,
               label: i === rows.length - 1 ? "Now" : "End of " + dayLabel(r.d), dd: r.v - peak };
    });
    lineChart(box, pts, [{ key: "dd", label: "Below peak", color: "var(--neg)", bold: true }],
      { height: height || 220, capTop: true, areaClass: "area-neg", empty: "No drawdown history yet." });
  }

  // ---------- table ----------
  var COLUMNS = [
    ["label", "Strategy"], ["status", "Status"], ["pnl", "P&L"], ["week", "7 days"], ["trades", "Trades"],
    ["winRate", "Win rate"], ["perTrade", "Avg / trade"], ["profitFactor", "Profit factor"],
    ["best", "Best day"], ["worst", "Worst day"], ["drawdown", "Max drawdown"], ["upDays", "Up days"]
  ];
  function value(s, key) {
    if (key === "label" || key === "pnl" || key === "trades") return s[key];
    return s.st[key];
  }
  function table(list) {
    var head = document.getElementById("thead"), body = document.getElementById("tbody");
    clear(head); clear(body);
    var tr = el("tr");
    COLUMNS.forEach(function (c) {
      var th = el("th", c[0] === "label" || c[0] === "status" ? "" : "num");
      var b = el("button", "sort", c[1] + (state.sort === c[0] ? (state.dir > 0 ? " ▲" : " ▼") : ""));
      b.type = "button";
      b.setAttribute("aria-label", "Sort by " + c[1]);
      b.addEventListener("click", function () {
        state.dir = state.sort === c[0] ? -state.dir : (c[0] === "label" || c[0] === "status" ? 1 : -1);
        state.sort = c[0];
        render();
      });
      th.appendChild(b);
      tr.appendChild(th);
    });
    head.appendChild(tr);
    var rows = list.slice().sort(function (a, b) {
      var va = value(a, state.sort), vb = value(b, state.sort);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va < vb ? -1 : va > vb ? 1 : 0) * state.dir;
    });
    rows.forEach(function (s) {
      var r = el("tr", s.label === state.pick ? "picked" : "");
      r.tabIndex = 0;
      var name = el("td", "name");
      var sw = el("span", "sw"); sw.style.background = s.color;
      name.appendChild(sw); name.appendChild(document.createTextNode(s.label));
      r.appendChild(name);
      r.appendChild(pill(el("td"), s));
      [[usd(s.pnl), tone(s.pnl)], [usd(s.st.week), tone(s.st.week)], [s.trades.toLocaleString("en-US"), ""],
       [pct(s.st.winRate), ""], [s.st.perTrade == null ? "—" : usd(s.st.perTrade), tone(s.st.perTrade)],
       [ratio(s.st.profitFactor), ""], [usd(s.st.best), tone(s.st.best)], [usd(s.st.worst), tone(s.st.worst)],
       [s.st.drawdown > 0.004 ? usd(-s.st.drawdown) : "$0.00", s.st.drawdown > 0.004 ? "neg" : ""], [pct(s.st.upDays), ""]
      ].forEach(function (c) { r.appendChild(el("td", "num " + c[1], c[0])); });
      var open = function () { choose(s.label); };
      r.addEventListener("click", open);
      r.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
      body.appendChild(r);
    });
  }
  function pill(parent, s) {
    var st = s.st.status;
    parent.appendChild(el("span", "pill " + { "Stopped": "stopped", "Waiting": "wait", "In a position": "open", "Running": "idle" }[st], st));
    return parent;
  }

  // ---------- cards ----------
  function cards(list) {
    var box = document.getElementById("cards");
    clear(box);
    list.slice().sort(function (a, b) { return b.pnl - a.pnl; }).forEach(function (s) {
      var c = el("button", "card" + (s.label === state.pick ? " picked" : ""));
      c.type = "button";
      c.setAttribute("aria-label", s.label + ", show details");
      c.style.setProperty("--c", s.color);
      var head = el("div", "card-head");
      head.appendChild(el("h3", null, s.label));
      pill(head, s);
      c.appendChild(head);
      c.appendChild(el("div", "pnl " + tone(s.pnl), usd(s.pnl)));
      c.appendChild(spark(s));
      var dl = el("dl", "facts");
      [["7 days", usd(s.st.week)], ["Trades", s.trades.toLocaleString("en-US")],
       ["Win rate", pct(s.st.winRate)], s.stopped ? ["Stopped", dayLabel(s.stopped)] : ["Last activity", s.as_of ? ago(s.as_of) : "—"]
      ].forEach(function (f) {
        var w = el("div");
        w.appendChild(el("dt", null, f[0]));
        w.appendChild(el("dd", null, f[1]));
        dl.appendChild(w);
      });
      c.appendChild(dl);
      c.addEventListener("click", function () { choose(s.label); });
      box.appendChild(c);
    });
  }
  function spark(s) {
    var W = 240, H = 44, vals = [0].concat((s.daily || []).map(function (p) { return p.eq; }));
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, preserveAspectRatio: "none", "class": "spark", "aria-hidden": "true" });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (hi - lo < 0.01) { hi += 0.5; lo -= 0.5; }
    var y = function (v) { return 3 + (hi - v) / (hi - lo) * (H - 6); };
    svg.appendChild(svgEl("line", { x1: 0, x2: W, y1: y(0), y2: y(0), "class": "zero", "vector-effect": "non-scaling-stroke" }));
    var pts = vals.map(function (v, i) { return (i / (vals.length - 1) * W).toFixed(1) + "," + y(v).toFixed(1); });
    var line = svgEl("polyline", { points: pts.join(" "), fill: "none", "stroke-width": 1.8, "vector-effect": "non-scaling-stroke",
      "stroke-linejoin": "round" });
    line.style.stroke = s.color;
    svg.appendChild(line);
    return svg;
  }

  // ---------- strategy detail ----------
  function choose(label) {
    state.pick = label;
    render();
    document.getElementById("detail").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function detail(list) {
    var s = list.filter(function (x) { return x.label === state.pick; })[0];
    var sel = document.getElementById("pick");
    clear(sel);
    list.forEach(function (x) {
      var o = el("option", null, x.label);
      o.value = x.label;
      o.selected = x.label === s.label;
      sel.appendChild(o);
    });
    document.getElementById("detail-title").textContent = s.label;
    var head = document.getElementById("detail-status");
    clear(head);
    pill(head, s);
    var since = "Paper record since " + dayLabel(s.since) + (s.stopped ? ", stopped " + dayLabel(s.stopped) : "");
    document.getElementById("detail-sub").textContent = since;

    var facts = document.getElementById("detail-facts");
    clear(facts);
    [["P&L", usd(s.pnl), tone(s.pnl)], ["Last 7 days", usd(s.st.week), tone(s.st.week)],
     ["Trades", s.trades.toLocaleString("en-US"), ""], ["Open positions", String(s.open), ""],
     ["Win rate", pct(s.st.winRate), ""], ["Wins / losses", s.wins == null ? "—" : s.wins + " / " + s.losses, ""],
     ["Avg / trade", s.st.perTrade == null ? "—" : usd(s.st.perTrade), tone(s.st.perTrade)],
     ["Profit factor", ratio(s.st.profitFactor), ""],
     ["Gross wins", s.gross_win == null ? "—" : usd(s.gross_win), s.gross_win ? "pos" : ""],
     ["Gross losses", s.gross_loss == null ? "—" : usd(-s.gross_loss), s.gross_loss ? "neg" : ""],
     ["Best day", usd(s.st.best), tone(s.st.best)], ["Worst day", usd(s.st.worst), tone(s.st.worst)],
     ["Max drawdown", s.st.drawdown > 0.004 ? usd(-s.st.drawdown) : "$0.00", s.st.drawdown > 0.004 ? "neg" : ""],
     ["Up days", pct(s.st.upDays), ""]
    ].forEach(function (f) {
      var w = el("div");
      w.appendChild(el("dt", null, f[0]));
      w.appendChild(el("dd", f[2], f[1]));
      facts.appendChild(w);
    });

    var daily = s.daily || [];
    var pts = daily.map(function (p, i) {
      var last = i === daily.length - 1;
      var q = { t: last ? Date.parse(state.data.updated) : Date.parse(p.d + "T00:00:00Z") + DAY_MS,
                label: last ? "Now" : "End of " + dayLabel(p.d) };
      q[s.label] = p.eq;
      return q;
    });
    lineChart(document.getElementById("detail-chart"), pts, [{ key: s.label, label: s.label, color: s.color, bold: true }], { height: 220 });
    dailyBars(document.getElementById("detail-bars"), daily.map(function (p, i) {
      return { d: p.d, v: s.st.changes[i], n: p.n };
    }), 180);
  }

  // ---------- controls ----------
  function seg(attr, key) {
    var buttons = document.querySelectorAll("[data-" + attr + "]");
    Array.prototype.forEach.call(buttons, function (b) {
      b.addEventListener("click", function () {
        state[key] = b.getAttribute("data-" + attr);
        Array.prototype.forEach.call(buttons, function (o) { o.setAttribute("aria-pressed", String(o === b)); });
        if (state.data) render();
      });
    });
  }
  seg("view", "view");
  seg("range", "range");
  document.getElementById("pick").addEventListener("change", function (e) { state.pick = e.target.value; render(); });
  var resizeTimer;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { if (state.data) render(); }, 150);
  });
  load();
  setInterval(load, REFRESH_MS);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) load(); });
})();
