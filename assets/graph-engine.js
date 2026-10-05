// Expression parser + canvas plotter shared by landing.html and graph.html.
(function () {
  const FUNCS = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    asin: Math.asin, acos: Math.acos, atan: Math.atan,
    sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp,
    ln: Math.log, log: Math.log10,
    floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign,
  };
  const CONSTS = { pi: Math.PI, e: Math.E };

  function tokenize(text) {
    const tokens = [];
    const re = /\s*(?:(\d+\.?\d*|\.\d+)|([a-z]+)|([-+*/^()]))/gy;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m[1]) tokens.push({ type: "num", value: parseFloat(m[1]) });
      else if (m[2]) tokens.push({ type: "id", value: m[2] });
      else tokens.push({ type: "op", value: m[3] });
      last = re.lastIndex;
    }
    const rest = text.slice(last).trim();
    if (rest) throw new Error(`"${rest[0]}" isn't something a function can use`);
    return tokens;
  }

  // Turns "x^2 - 3sin(x)" into a function of x. Throws an Error whose
  // message is written for the person typing.
  function compile(source) {
    const text = String(source)
      .toLowerCase()
      .replace(/π/g, "pi").replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-")
      .replace(/^\s*(y|f\s*\(\s*x\s*\))\s*=/, "");
    const tokens = tokenize(text);
    if (!tokens.length) throw new Error("Type a function of x, like x^2 - 1");
    let pos = 0;

    const peek = () => tokens[pos];
    const isOp = (t, v) => t && t.type === "op" && t.value === v;
    const take = (v) => (isOp(tokens[pos], v) ? (pos++, true) : false);
    const combine = (a, b, op) => (x) => op(a(x), b(x));

    function expr() {
      let left = term();
      for (;;) {
        if (take("+")) left = combine(left, term(), (a, b) => a + b);
        else if (take("-")) left = combine(left, term(), (a, b) => a - b);
        else return left;
      }
    }

    function term() {
      let left = unary();
      for (;;) {
        const t = peek();
        if (take("*")) left = combine(left, unary(), (a, b) => a * b);
        else if (take("/")) left = combine(left, unary(), (a, b) => a / b);
        // Implicit multiplication: 2x, 3(x+1), x sin(x)
        else if (t && (t.type !== "op" || t.value === "(")) left = combine(left, power(), (a, b) => a * b);
        else return left;
      }
    }

    function unary() {
      if (take("-")) {
        const inner = unary();
        return (x) => -inner(x);
      }
      if (take("+")) return unary();
      return power();
    }

    function power() {
      const base = primary();
      if (take("^")) return combine(base, unary(), Math.pow);
      return base;
    }

    function primary() {
      const t = tokens[pos++];
      if (!t) throw new Error("The function ends too early");
      if (t.type === "num") return () => t.value;
      if (t.type === "id") {
        if (t.value === "x") return (x) => x;
        if (t.value in CONSTS) return () => CONSTS[t.value];
        if (t.value in FUNCS) {
          if (!take("(")) throw new Error(`${t.value} needs parentheses, like ${t.value}(x)`);
          const arg = expr();
          if (!take(")")) throw new Error(`Close the parenthesis after ${t.value}(`);
          const fn = FUNCS[t.value];
          return (x) => fn(arg(x));
        }
        throw new Error(`"${t.value}" isn't a known function or variable`);
      }
      if (t.value === "(") {
        const inner = expr();
        if (!take(")")) throw new Error("A parenthesis is never closed");
        return inner;
      }
      throw new Error(`"${t.value}" is in an unexpected place`);
    }

    const fn = expr();
    if (pos < tokens.length) throw new Error(`"${tokens[pos].value}" is in an unexpected place`);
    return fn;
  }

  // Grid spacing: a 1/2/5 × 10ⁿ step near `raw`, split into minor lines
  function gridStep(raw) {
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / pow;
    if (n < 1.5) return { major: pow, per: 5 };
    if (n < 3.5) return { major: 2 * pow, per: 4 };
    if (n < 7.5) return { major: 5 * pow, per: 5 };
    return { major: 10 * pow, per: 5 };
  }

  function formatNumber(v) {
    if (Math.abs(v) < 1e-12) return "0";
    const abs = Math.abs(v);
    const s = abs >= 1e6 || abs < 1e-4 ? v.toExponential(2) : String(parseFloat(v.toPrecision(6)));
    return s.replace("-", "−");
  }

  const DEFAULT_THEME = {
    paper: "#edf1df",
    minor: "#d3ddc0",
    major: "#b4c69d",
    axis: "#1d2b24",
    label: "#52634f",
    font: '12px "JetBrains Mono", ui-monospace, monospace',
  };

  // view = { cx, cy, scale } — centre of the plot in graph units, and graph
  // units per CSS pixel. curves = [{ fn, color }].
  // options: { labels, progress (0–1 of the width drawn), theme }
  function draw(canvas, view, curves, options) {
    const opts = options || {};
    const theme = Object.assign({}, DEFAULT_THEME, opts.theme);
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const { scale } = view;
    const xmin = view.cx - (w / 2) * scale;
    const ymax = view.cy + (h / 2) * scale;
    const toX = (x) => (x - xmin) / scale;
    const toY = (y) => (ymax - y) / scale;

    ctx.fillStyle = theme.paper;
    ctx.fillRect(0, 0, w, h);

    // Grid
    const step = gridStep(scale * 90);
    const minor = step.major / step.per;
    const line = (x1, y1, x2, y2) => {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    };
    ctx.lineWidth = 1;
    const iStart = Math.ceil(xmin / minor);
    const iEnd = Math.floor((xmin + w * scale) / minor);
    const jStart = Math.ceil((ymax - h * scale) / minor);
    const jEnd = Math.floor(ymax / minor);
    for (let i = iStart; i <= iEnd; i++) {
      ctx.strokeStyle = i % step.per === 0 ? theme.major : theme.minor;
      const px = Math.round(toX(i * minor)) + 0.5;
      line(px, 0, px, h);
    }
    for (let j = jStart; j <= jEnd; j++) {
      ctx.strokeStyle = j % step.per === 0 ? theme.major : theme.minor;
      const py = Math.round(toY(j * minor)) + 0.5;
      line(0, py, w, py);
    }

    // Axes
    const axisX = Math.round(toX(0)) + 0.5;
    const axisY = Math.round(toY(0)) + 0.5;
    ctx.strokeStyle = theme.axis;
    ctx.lineWidth = 1.5;
    line(axisX, 0, axisX, h);
    line(0, axisY, w, axisY);

    // Axis numbers, pinned to the edge when the axis is off screen
    if (opts.labels !== false) {
      ctx.font = theme.font;
      ctx.fillStyle = theme.label;
      ctx.textBaseline = "top";
      const labelY = Math.min(Math.max(axisY + 5, 4), h - 18);
      const yLabelsOnLeft = axisX > w - 40;
      const labelX = Math.min(Math.max(axisX + 6, 6), w - 6);
      ctx.textAlign = "center";
      for (let i = iStart; i <= iEnd; i++) {
        const px = toX(i * minor);
        // Skip numbers that would be cut off by the edge of the plot
        if (i % step.per !== 0 || i === 0 || px < 16 || px > w - 16) continue;
        ctx.fillText(formatNumber(i * minor), px, labelY);
      }
      ctx.textBaseline = "middle";
      ctx.textAlign = yLabelsOnLeft ? "right" : "left";
      for (let j = jStart; j <= jEnd; j++) {
        if (j % step.per !== 0 || j === 0) continue;
        ctx.fillText(formatNumber(j * minor), yLabelsOnLeft ? w - 6 : labelX, toY(j * minor));
      }
    }

    // Curves
    const progress = opts.progress === undefined ? 1 : opts.progress;
    const limit = w * progress;
    const SAMPLE = 0.5;
    ctx.lineWidth = 2.25;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    curves.forEach((curve) => {
      ctx.strokeStyle = curve.color;
      ctx.beginPath();
      let pen = false;
      let prevY = 0;
      for (let px = 0; px <= limit; px += SAMPLE) {
        const x = xmin + px * scale;
        const y = curve.fn(x);
        if (!Number.isFinite(y)) { pen = false; continue; }
        const py = Math.min(Math.max(toY(y), -1e4), 1e4);
        if (pen && Math.abs(py - toY(prevY)) > h) {
          // A jump taller than the plot: keep drawing only if the function
          // really passes through the middle (steep), not across an asymptote
          const mid = curve.fn(x - (SAMPLE / 2) * scale);
          const between = mid >= Math.min(prevY, y) && mid <= Math.max(prevY, y);
          if (!between) pen = false;
        }
        if (pen) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
        pen = true;
        prevY = y;
      }
      ctx.stroke();
    });
  }

  window.GraphEngine = { compile, draw, formatNumber };
})();
