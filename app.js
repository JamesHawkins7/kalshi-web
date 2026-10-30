(function () {
  "use strict";
  var REFRESH_MS = 5 * 60 * 1000;
  var NS = "http://www.w3.org/2000/svg";
  var PALETTE = 9;
  var state = { data: null, view: "total", sort: "pnl" };

  // ---------- helpers ----------
  function usd(x, signed) {
    var s = Math.abs(x).toLocaleString("en-US", { style: "currency", currency: "USD" });
    if (signed === false) return (x < 0 ? "−" : "") + s;
    return (x < 0 ? "−" : x > 0 ? "+" : "") + s;
  }
  function tone(x) { return x > 0.004 ? "pos" : x < -0.004 ? "neg" : "flat"; }
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
  function day(iso) { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
  function stamp(iso) {
    return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
  function color(i) { return "var(--s" + (i % PALETTE + 1) + ")"; }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

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
    list.forEach(function (s, i) { s.color = color(i); });
    var upd = document.getElementById("updated");
    upd.textContent = "Updated " + ago(d.updated);
    upd.title = stamp(d.updated);
    var stale = Date.now() - Date.parse(d.updated) > 3 * 3600 * 1000;
    document.getElementById("live").classList.toggle("stale", stale);
    document.getElementById("note").textContent = d.note || "";
    tiles(list, d.history || []);
    chart(list, d.history || []);
    cards(list, d.history || []);
  }

  // ---------- tiles ----------
  function tiles(list, history) {
    var total = list.reduce(function (a, s) { return a + s.pnl; }, 0);
    var trades = list.reduce(function (a, s) { return a + s.trades; }, 0);
    var open = list.reduce(function (a, s) { return a + s.open; }, 0);
    var active = list.filter(function (s) { return s.trades > 0; });
    var up = active.filter(function (s) { return s.pnl > 0; }).length;
    var change = null;
    if (history.length > 1) {
      var cutoff = Date.parse(history[history.length - 1].t) - 86400 * 1000, base = null;
      for (var i = history.length - 1; i >= 0; i--) { if (Date.parse(history[i].t) <= cutoff) { base = history[i]; break; } }
      if (base) change = total - sumPoint(base, list);
    }
    var box = document.getElementById("tiles");
    clear(box);
    [
      ["Total P&L", usd(total), tone(total), change == null ? "All strategies combined" : usd(change) + " in the last 24 h"],
      ["In profit", up + " of " + active.length, "", "Strategies that have traded"],
      ["Trades", trades.toLocaleString("en-US"), "", list.length + " strategies tracked"],
      ["Open positions", open.toLocaleString("en-US"), "", "Across all strategies"]
    ].forEach(function (t) {
      var tile = el("div", "tile");
      tile.appendChild(el("div", "k", t[0]));
      tile.appendChild(el("div", "v " + t[2], t[1]));
      tile.appendChild(el("div", "h", t[3]));
      box.appendChild(tile);
    });
  }
  function sumPoint(p, list) {
    return list.reduce(function (a, s) { return a + (typeof p[s.label] === "number" ? p[s.label] : 0); }, 0);
  }

  // ---------- chart ----------
  function chart(list, history) {
    var box = document.getElementById("chart"), legend = document.getElementById("legend");
    clear(box); clear(legend);
    if (history.length < 2) {
      box.appendChild(el("p", "empty", "The chart fills in as hourly updates arrive. Check back soon."));
      return;
    }
    var series = state.view === "total"
      ? [{ label: "Total", color: "var(--accent)", get: function (p) { return sumPoint(p, list); }, bold: true }]
      : list.map(function (s) { return { label: s.label, color: s.color, get: function (p) { return p[s.label]; } }; });

    var W = Math.max(320, Math.round(box.clientWidth || 880)), H = W < 600 ? 220 : 300, L = 64, R = 16, T = 14, B = 30;
    var ts = history.map(function (p) { return Date.parse(p.t); });
    var t0 = ts[0], t1 = ts[ts.length - 1];
    var lo = 0, hi = 0;
    series.forEach(function (s) { history.forEach(function (p) {
      var v = s.get(p); if (typeof v === "number") { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    }); });
    if (hi - lo < 1) { hi += 0.5; lo -= 0.5; }
    var pad = (hi - lo) * 0.08; hi += pad; lo -= pad;
    var x = function (t) { return L + (t - t0) / (t1 - t0) * (W - L - R); };
    var y = function (v) { return T + (hi - v) / (hi - lo) * (H - T - B); };

    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H });
    for (var i = 0; i <= 4; i++) {
      var v = lo + (hi - lo) * i / 4;
      svg.appendChild(svgEl("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), "class": "grid" }));
      svg.appendChild(svgEl("text", { x: L - 10, y: y(v) + 4, "text-anchor": "end" }, usd(v, false)));
    }
    svg.appendChild(svgEl("line", { x1: L, x2: W - R, y1: y(0), y2: y(0), "class": "zero" }));
    for (var j = 0; j <= 4; j++) {
      var t = t0 + (t1 - t0) * j / 4;
      svg.appendChild(svgEl("text", { x: x(t), y: H - 8, "text-anchor": j === 0 ? "start" : j === 4 ? "end" : "middle" },
        new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" })));
    }
    series.forEach(function (s) {
      var pts = [];
      history.forEach(function (p, idx) { var v = s.get(p); if (typeof v === "number") pts.push(x(ts[idx]).toFixed(1) + "," + y(v).toFixed(1)); });
      if (pts.length < 2) return;
      if (s.bold) {
        var area = svgEl("polygon", { points: pts.join(" ") + " " + x(t1).toFixed(1) + "," + y(0) + " " + x(t0).toFixed(1) + "," + y(0), "class": "area" });
        svg.appendChild(area);
      }
      var line = svgEl("polyline", { points: pts.join(" "), fill: "none", "stroke-width": s.bold ? 2.5 : 1.8,
        "stroke-linejoin": "round", "stroke-linecap": "round", "vector-effect": "non-scaling-stroke" });
      line.style.stroke = s.color;
      svg.appendChild(line);
    });

    // hover
    var guide = svgEl("line", { y1: T, y2: H - B, "class": "guide" });
    guide.style.display = "none";
    svg.appendChild(guide);
    var tip = el("div", "tip");
    tip.hidden = true;
    box.appendChild(svg);
    box.appendChild(tip);
    function move(clientX) {
      var r = svg.getBoundingClientRect();
      var px = (clientX - r.left) / r.width * W;
      var target = t0 + (px - L) / (W - L - R) * (t1 - t0), k = 0;
      for (var n = 1; n < ts.length; n++) if (Math.abs(ts[n] - target) < Math.abs(ts[k] - target)) k = n;
      var gx = x(ts[k]);
      guide.setAttribute("x1", gx); guide.setAttribute("x2", gx); guide.style.display = "";
      clear(tip);
      tip.appendChild(el("div", "tip-t", stamp(history[k].t)));
      series.forEach(function (s) {
        var v = s.get(history[k]); if (typeof v !== "number") return;
        var row = el("div", "tip-row");
        var sw = el("span", "sw"); sw.style.background = s.color;
        row.appendChild(sw); row.appendChild(el("span", null, s.label));
        row.appendChild(el("span", "num " + tone(v), usd(v)));
        tip.appendChild(row);
      });
      tip.hidden = false;
      var left = gx / W * r.width;
      tip.style.left = Math.min(Math.max(left + 12, 0), r.width - tip.offsetWidth - 4) + "px";
      if (left + 12 + tip.offsetWidth > r.width) tip.style.left = Math.max(left - tip.offsetWidth - 12, 0) + "px";
    }
    svg.addEventListener("mousemove", function (e) { move(e.clientX); });
    svg.addEventListener("touchmove", function (e) { if (e.touches[0]) move(e.touches[0].clientX); }, { passive: true });
    svg.addEventListener("mouseleave", function () { tip.hidden = true; guide.style.display = "none"; });

    if (state.view === "each") {
      series.forEach(function (s) {
        var item = el("span", null, s.label);
        item.style.setProperty("--c", s.color);
        legend.appendChild(item);
      });
    }
  }

  // ---------- cards ----------
  function cards(list, history) {
    var box = document.getElementById("cards");
    clear(box);
    var sorted = list.slice().sort(state.sort === "pnl"
      ? function (a, b) { return b.pnl - a.pnl; }
      : function (a, b) { return a.label < b.label ? -1 : 1; });
    sorted.forEach(function (s) {
      var c = el("article", "card");
      c.style.setProperty("--c", s.color);
      var head = el("div", "card-head");
      head.appendChild(el("h3", null, s.label));
      var waiting = s.trades === 0;
      head.appendChild(el("span", "pill " + (s.stopped ? "stopped" : waiting ? "wait" : s.open > 0 ? "open" : "idle"),
        s.stopped ? "Stopped" : waiting ? "No trades yet" : s.open > 0 ? "In a position" : "Flat"));
      c.appendChild(head);
      c.appendChild(el("div", "pnl " + tone(s.pnl), usd(s.pnl)));
      c.appendChild(spark(s, history));
      var dl = el("dl", "facts");
      [["Trades", s.trades.toLocaleString("en-US")], ["Open", String(s.open)], ["Since", day(s.since)],
       s.stopped ? ["Stopped", day(s.stopped)] : ["Last activity", s.as_of ? ago(s.as_of) : "—"]].forEach(function (f) {
        var w = el("div");
        w.appendChild(el("dt", null, f[0]));
        var dd = el("dd", null, f[1]);
        if (f[0] === "Last activity" && s.as_of) dd.title = stamp(s.as_of);
        w.appendChild(dd);
        dl.appendChild(w);
      });
      c.appendChild(dl);
      box.appendChild(c);
    });
  }
  function spark(s, history) {
    var W = 240, H = 44, vals = [];
    history.forEach(function (p) { if (typeof p[s.label] === "number") vals.push(p[s.label]); });
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, preserveAspectRatio: "none", "class": "spark", "aria-hidden": "true" });
    if (vals.length < 2) {
      svg.appendChild(svgEl("line", { x1: 0, x2: W, y1: H / 2, y2: H / 2, "class": "zero" }));
      return svg;
    }
    var lo = Math.min.apply(null, vals.concat([0])), hi = Math.max.apply(null, vals.concat([0]));
    if (hi - lo < 0.01) { hi += 0.5; lo -= 0.5; }
    var y = function (v) { return 3 + (hi - v) / (hi - lo) * (H - 6); };
    svg.appendChild(svgEl("line", { x1: 0, x2: W, y1: y(0), y2: y(0), "class": "zero" }));
    var pts = vals.map(function (v, i) { return (i / (vals.length - 1) * W).toFixed(1) + "," + y(v).toFixed(1); });
    var line = svgEl("polyline", { points: pts.join(" "), fill: "none", "stroke-width": 1.8, "vector-effect": "non-scaling-stroke",
      "stroke-linejoin": "round" });
    line.style.stroke = s.color;
    svg.appendChild(line);
    return svg;
  }

  // ---------- controls ----------
  function wire(attr, key) {
    var buttons = document.querySelectorAll("[data-" + attr + "]");
    Array.prototype.forEach.call(buttons, function (b) {
      b.addEventListener("click", function () {
        state[key] = b.getAttribute("data-" + attr);
        Array.prototype.forEach.call(buttons, function (o) { o.setAttribute("aria-pressed", String(o === b)); });
        if (state.data) render();
      });
    });
  }
  var resizeTimer;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { if (state.data) chart(state.data.strategies || [], state.data.history || []); }, 150);
  });
  wire("view", "view");
  wire("sort", "sort");
  load();
  setInterval(load, REFRESH_MS);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) load(); });
})();
