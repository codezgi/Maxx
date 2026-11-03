/* Maxx Global Medikal — dünya sahnesi (kütüphanesiz WebGL).
   Mavi küre gerçek kara haritasıyla 3B döner; üstünde ağ çizgileri ve parlayan düğümler.
   Ekran dışındayken ve sekme gizliyken durur; hareket azaltma tercihinde tek kare çizer.
   WebGL yoksa sayfadaki statik globe.webp görünür kalır. */
(function () {
  "use strict";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var host = document.querySelector('[data-scene="globe"]');
  if (!host) return;
  var glc = host.querySelector("canvas");
  var gl = glc && (glc.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false }));
  if (!gl) return;
  var net = document.createElement("canvas");
  host.appendChild(net);
  var ctx = net.getContext("2d");

  var RATIO = .455; // kürenin yarıçapı / sahne

  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function stage(t0, d, t) { return clamp((t - t0) / d, 0, 1); }
  function easeOut(t) { return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); }

  var VS = "attribute vec2 a;varying vec2 v;void main(){v=a;gl_Position=vec4(a,0.,1.);}";
  var FS = [
    "precision highp float;varying vec2 v;",
    "uniform sampler2D T;uniform mat3 M;uniform float S,PX,G;",
    "const float PI=3.14159265;",
    "void main(){",
    " vec2 p=v/S;float r=length(p);",
    " float disc=smoothstep(1.+PX,1.-PX,r);",
    /* Dış atmosfer */
    " float halo=(1.-disc)*exp(-(r-1.)*30.)*.26*(1.-smoothstep(1.03,1.09,r));",
    " vec3 c=vec3(0.);float a=0.;",
    " if(r<1.+PX){",
    "  float z=sqrt(max(0.,1.-min(r*r,1.)));",
    "  vec3 n=vec3(p,z),w=M*n;",
    "  vec2 uv=vec2(atan(w.x,w.z)/(2.*PI)+.5,.5-asin(clamp(w.y,-1.,1.))/PI);",
    "  vec4 t=texture2D(T,uv);float land=t.r,coast=t.g;",
    "  float l=clamp(dot(n,normalize(vec3(-.3,.55,.78))),0.,1.);",
    /* Okyanus: ortası koyu lacivert, kenara doğru mavi */
    "  vec3 ocean=mix(vec3(.027,.09,.235),vec3(.04,.23,.50),pow(r,2.8));",
    "  ocean+=vec3(.03,.14,.30)*coast*.6;",
    /* Kara: üst-ışık tarafı açık camgöbeği */
    "  vec3 ground=mix(vec3(.09,.30,.60),vec3(.27,.62,.88),pow(l,1.4));",
    "  ground=mix(ground,ground*1.08,smoothstep(.55,1.,coast));",
    "  c=mix(ocean,ground,land);",
    /* Kıyı ışığı ve kenar parlaması */
    "  c+=vec3(.25,.6,.95)*land*(1.-smoothstep(.5,.95,coast))*.12;",
    "  c+=vec3(.14,.40,.80)*pow(r,6.)*.34;",
    "  c*=mix(.74,1.02,l);",
    "  a=disc;",
    " }",
    " vec3 hc=vec3(.25,.55,.95);",
    " float o=(a+halo)*G;",
    " gl_FragColor=vec4((c*a+hc*halo)*G,o);",
    "}"
  ].join("\n");
  function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; }
  var pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { net.remove(); return; }
  gl.useProgram(pr);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  var loc = gl.getAttribLocation(pr, "a");
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  var U = { M: gl.getUniformLocation(pr, "M"), S: gl.getUniformLocation(pr, "S"), PX: gl.getUniformLocation(pr, "PX"), G: gl.getUniformLocation(pr, "G") };
  gl.clearColor(0, 0, 0, 0);

  /* Ağ: sabit tohumla üretilir, her ziyarette aynı görünür. Coğrafi anlam taşımaz. */
  var seed = 73;
  function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
  var nodes = [], N = 96, ga = Math.PI * (3 - Math.sqrt(5));
  for (var i = 0; i < N; i++) {
    var y = 1 - (i + .5) * 2 / N + (rnd() - .5) * .05, ra = Math.sqrt(Math.max(0, 1 - y * y)), th = ga * i + (rnd() - .5) * .5;
    nodes.push({ v: [ra * Math.sin(th), y, ra * Math.cos(th)], ph: rnd() * 6.28, s: .75 + rnd() * .9 });
  }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function slerp(a, b, t) {
    var d = Math.acos(clamp(dot(a, b), -1, 1)), s = Math.sin(d) || 1, p = Math.sin((1 - t) * d) / s, q = Math.sin(t * d) / s;
    return [a[0] * p + b[0] * q, a[1] * p + b[1] * q, a[2] * p + b[2] * q];
  }
  var edges = [], seen = {};
  function link(a, b) {
    var k = a < b ? a + "-" + b : b + "-" + a;
    if (seen[k]) return; seen[k] = 1;
    var pts = [], steps = Math.max(3, Math.ceil(Math.acos(clamp(dot(nodes[a].v, nodes[b].v), -1, 1)) * 9));
    for (var s = 0; s <= steps; s++) pts.push(slerp(nodes[a].v, nodes[b].v, s / steps));
    edges.push({ pts: pts, at: rnd() });
  }
  nodes.forEach(function (n, ix) {
    var near = nodes.map(function (m, j) { return { j: j, d: dot(n.v, m.v) }; }).filter(function (o) { return o.j !== ix; }).sort(function (x, z) { return z.d - x.d; });
    link(ix, near[0].j); link(ix, near[1].j);
    if (rnd() < .42) link(ix, near[4 + (rnd() * 12 | 0)].j);
  });
  var pulses = [];
  for (i = 0; i < 16; i++) pulses.push({ e: edges[rnd() * edges.length | 0], t: rnd(), sp: .1 + rnd() * .14 });

  /* Etkileşim: sürükle-döndür, ataletle yavaşla */
  var dragX = 0, dragY = 0, vx = 0, vy = 0, dragging = false, px = 0, py = 0;
  host.addEventListener("pointerdown", function (e) { dragging = true; px = e.clientX; py = e.clientY; vx = vy = 0; host.classList.add("is-grabbing"); try { host.setPointerCapture(e.pointerId); } catch (x) {} });
  host.addEventListener("pointermove", function (e) {
    if (!dragging) return;
    var dx = (e.clientX - px) * .0065, dy = (e.clientY - py) * .004; px = e.clientX; py = e.clientY;
    dragX -= dx; dragY = clamp(dragY + dy, -.6, .6); vx = -dx; vy = dy;
  });
  function release() { dragging = false; host.classList.remove("is-grabbing"); }
  host.addEventListener("pointerup", release); host.addEventListener("pointercancel", release);

  var w = 0, h = 0, dpr = 1;
  function draw(t, dt) {
    var grow = reduce ? 1 : easeOut(stage(0, 1.5, t));
    if (!dragging) { dragX += vx; dragY += vy; vx *= .95; vy *= .95; dragY -= dragY * Math.min(1, dt * .6); }
    /* Yeryüzü doğuya döner; açılışta yavaşlayarak yerine oturur */
    var yaw = -1.15 - (reduce ? 0 : (1 - easeOut(stage(0, 2.2, t))) * -1.1 + t * .09) + dragX;
    var pitch = .36 + dragY, roll = -.3;
    var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
    /* Görünüm → dünya: Ry(yaw)·Rx(pitch)·Rz(roll) */
    var m = [
      cy * cr + sy * sp * sr, -cy * sr + sy * sp * cr, sy * cp,
      cp * sr, cp * cr, -sp,
      -sy * cr + cy * sp * sr, sy * sr + cy * sp * cr, cy * cp
    ];
    var scale = RATIO * 2 * (.9 + .1 * grow), Rpx = scale * Math.min(w, h) / 2;
    gl.viewport(0, 0, glc.width, glc.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    /* GLSL sütun sırası */
    gl.uniformMatrix3fv(U.M, false, [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
    gl.uniform1f(U.S, scale); gl.uniform1f(U.PX, 1.2 / (Rpx * dpr)); gl.uniform1f(U.G, grow);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    /* Ağ katmanı */
    var cx = w / 2, cyy = h / 2;
    function proj(a) { // dünya → görünüm = M'nin devriği
      return [cx + (m[0] * a[0] + m[3] * a[1] + m[6] * a[2]) * Rpx, cyy - (m[1] * a[0] + m[4] * a[1] + m[7] * a[2]) * Rpx, m[2] * a[0] + m[5] * a[1] + m[8] * a[2]];
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = "round"; ctx.lineWidth = .7;
    edges.forEach(function (e) {
      var k = reduce ? 1 : easeOut(stage(.5 + e.at * 1.4, 1.1, t));
      if (k <= 0) return;
      var end = Math.round((e.pts.length - 1) * k), prev = proj(e.pts[0]);
      for (var s = 1; s <= end; s++) {
        var q = proj(e.pts[s]);
        var z = Math.min(prev[2], q[2]);
        if (z > .02) {
          ctx.strokeStyle = "rgba(150,226,255," + (.1 + z * .3).toFixed(3) + ")";
          ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
        }
        prev = q;
      }
    });
    nodes.forEach(function (n) {
      var q = proj(n.v);
      if (q[2] < .02) return;
      var k = reduce ? 1 : easeOut(stage(.3, 1.4, t));
      var tw = reduce ? .8 : .62 + .38 * Math.sin(t * 1.3 + n.ph);
      var a = k * tw * (.35 + q[2] * .65), rr = n.s * (.7 + q[2] * .5);
      ctx.fillStyle = "rgba(90,210,255," + (a * .24).toFixed(3) + ")";
      ctx.beginPath(); ctx.arc(q[0], q[1], rr * 3.2, 0, 7); ctx.fill();
      ctx.fillStyle = "rgba(205,245,255," + a.toFixed(3) + ")";
      ctx.beginPath(); ctx.arc(q[0], q[1], rr, 0, 7); ctx.fill();
    });
    if (!reduce) pulses.forEach(function (p) {
      p.t += dt * p.sp; if (p.t > 1) { p.t = 0; p.e = edges[(Math.random() * edges.length) | 0]; }
      var f = p.t * (p.e.pts.length - 1), i0 = f | 0, q = proj(p.e.pts[Math.min(i0, p.e.pts.length - 1)]);
      if (q[2] < .05) return;
      var fade = Math.sin(p.t * Math.PI) * stage(1.6, 1, t);
      ctx.fillStyle = "rgba(255,255,255," + (.9 * fade).toFixed(3) + ")";
      ctx.beginPath(); ctx.arc(q[0], q[1], 1.5, 0, 7); ctx.fill();
    });
  }

  var raf = 0, visible = false, started = 0, last = 0, ready = false;
  function resize() {
    var r = host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2); w = r.width; h = r.height;
    glc.width = net.width = Math.round(w * dpr); glc.height = net.height = Math.round(h * dpr);
    if (ready && reduce) draw(1e6, 0);
  }
  function frame(now) {
    raf = 0;
    if (!visible || document.hidden || !w) return;
    if (!started) started = now;
    var dt = Math.min(now - last, 50) / 1000; last = now;
    draw((now - started) / 1000, dt);
    raf = requestAnimationFrame(frame);
  }
  function kick() { if (ready && !raf && !reduce && visible && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); } }

  var img = new Image();
  img.onload = function () {
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    ready = true;
    host.classList.add("is-live");
    new ResizeObserver(function () { resize(); kick(); }).observe(host);
    new IntersectionObserver(function (e) { visible = e[e.length - 1].isIntersecting; kick(); }, { rootMargin: "80px" }).observe(host);
    document.addEventListener("visibilitychange", kick);
    resize();
    if (reduce) draw(1e6, 0);
  };
  img.src = "/assets/img/globe-land.webp?v=motion-20261103i";
})();
