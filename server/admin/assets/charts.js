// 極簡 inline SVG 圖表（不依賴外部 CDN）
window.Charts = (function () {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nice = (max) => { if (max <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(max))); const n = max / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };
  const fmt = (v) => Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : Math.abs(v) >= 1e4 ? (v / 1e3).toFixed(0) + 'k' : (Math.round(v * 10) / 10).toLocaleString('zh-TW');
  function frame(labels, max, W, H, pad) {
    let s = '';
    const top = nice(max);
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (H - pad.t - pad.b) * (1 - i / 4);
      s += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}" stroke="rgba(255,255,255,.08)"/><text x="${pad.l - 6}" y="${y + 4}" text-anchor="end">${fmt(top * i / 4)}</text>`;
    }
    const step = Math.max(1, Math.ceil(labels.length / 8));
    labels.forEach((l, i) => {
      const last = labels.length - 1;
      if (i !== last && (i % step || last - i < step * 0.7)) return;
      const x = pad.l + (W - pad.l - pad.r) * (labels.length === 1 ? .5 : i / (labels.length - 1));
      s += `<text x="${x}" y="${H - 6}" text-anchor="middle">${esc(String(l).slice(5))}</text>`;
    });
    return { s, top };
  }
  function line({ labels, series, height = 200 }) {
    const W = 640, H = height, pad = { l: 44, r: 12, t: 10, b: 24 };
    const max = Math.max(1, ...series.flatMap((s) => s.values));
    const f = frame(labels, max, W, H, pad);
    let s = f.s;
    for (const se of series) {
      const pts = se.values.map((v, i) => [pad.l + (W - pad.l - pad.r) * (labels.length === 1 ? .5 : i / (labels.length - 1)), pad.t + (H - pad.t - pad.b) * (1 - v / f.top)]);
      const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
      if (se.fill) s += `<path d="${d} L${pts[pts.length - 1][0]} ${H - pad.b} L${pts[0][0]} ${H - pad.b} Z" fill="${se.color}" opacity=".15"/>`;
      s += `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="2"/>`;
      pts.forEach((p, i) => { s += `<circle cx="${p[0]}" cy="${p[1]}" r="2.5" fill="${se.color}"><title>${esc(labels[i])}：${se.values[i]}</title></circle>`; });
    }
    return `<svg class="chart" viewBox="0 0 ${W} ${H}">${s}</svg>` + legend(series);
  }
  function bars({ labels, series, height = 200, stacked = true }) {
    const W = 640, H = height, pad = { l: 44, r: 12, t: 10, b: 24 };
    const totals = labels.map((_, i) => stacked ? series.reduce((a, s) => a + Math.max(0, s.values[i]), 0) : Math.max(...series.map((s) => s.values[i])));
    const max = Math.max(1, ...totals);
    const f = frame(labels, max, W, H, pad);
    let s = f.s;
    const cw = (W - pad.l - pad.r) / labels.length;
    const bw = Math.max(2, cw * .7);
    labels.forEach((l, i) => {
      const cx = pad.l + (W - pad.l - pad.r) * (labels.length === 1 ? .5 : i / (labels.length - 1));
      let acc = 0;
      series.forEach((se, k) => {
        const v = Math.max(0, se.values[i]);
        const h = (H - pad.t - pad.b) * v / f.top;
        const w = stacked ? bw : bw / series.length;
        const x = stacked ? cx - bw / 2 : cx - bw / 2 + k * w;
        const y = H - pad.b - h - (stacked ? acc : 0);
        if (stacked) acc += h;
        if (v) s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${se.color}" rx="2"><title>${esc(l)} ${esc(se.name)}：${v.toLocaleString('zh-TW')}</title></rect>`;
      });
    });
    return `<svg class="chart" viewBox="0 0 ${W} ${H}">${s}</svg>` + legend(series);
  }
  function legend(series) {
    if (series.length < 2 && !series[0].name) return '';
    return '<div class="legend">' + series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name || '')}</span>`).join('') + '</div>';
  }
  function hbars(items, { valueFmt = (v) => v.toLocaleString('zh-TW') } = {}) {
    const max = Math.max(1, ...items.map((i) => i.value));
    return items.map((it) => `<div class="hbar"><span class="${it.cls || ''}">${esc(it.label)}</span><span class="bar"><i style="width:${(it.value / max * 100).toFixed(1)}%"></i></span><span class="num">${esc(valueFmt(it.value))}</span></div>`).join('') || '<p class="muted">尚無資料</p>';
  }
  return { line, bars, hbars };
})();
