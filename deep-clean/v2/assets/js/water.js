/* ==========================================================================
   Deep Clean V2 — eau interactive (WebGL 1, sans bibliothèque)

   - Une grille d'ondes (équation des ondes discrète) tourne sur le CPU ;
     ses pentes et hauteurs sont envoyées au GPU à chaque image (texture).
   - Le fragment shader réfracte le calque de texte (dessiné dans un canvas 2D
     à l'emplacement exact du texte HTML), puis ajoute ombrage, reflets
     spéculaires et caustiques procédurales (écrites pour ce site).
   - Rien ne tourne quand la section est hors écran ou l'onglet masqué.

   API : var w = DCWater(canvas, { textRoot, icon, onLost });
         w -> null si WebGL indisponible, sinon { drop(x, y, force, rayon),
         refresh(), destroy() } (coordonnées en px CSS, relatives au canvas).
   ========================================================================== */

(function () {
  "use strict";

  var VERT =
    "attribute vec2 p;" +
    "varying vec2 vUv;" +
    "void main(){ vUv = vec2(p.x * .5 + .5, .5 - p.y * .5); gl_Position = vec4(p, 0., 1.); }";

  var FRAG = [
    "precision mediump float;",
    "varying vec2 vUv;",
    "uniform sampler2D uH;",   // r,g : pentes ; b : hauteur
    "uniform sampler2D uT;",   // calque de texte
    "uniform vec2 uRes;",      // taille du canvas (px)
    "uniform float uTime;",
    "uniform float uRefr;",    // amplitude de réfraction (px)
    "uniform vec3 uTop;",
    "uniform vec3 uBot;",

    // Caustiques : réseau de sinus replié par deux distorsions successives ;
    // les « plis » (valeurs proches de 0) deviennent des filets lumineux.
    "float caustic(vec2 p, float t){",
    "  p += .42 * vec2(sin(p.y * 1.27 + t * .83), cos(p.x * 1.13 - t * .71));",
    "  p += .27 * vec2(sin(p.y * 2.31 - t * .57 + 1.7), cos(p.x * 2.07 + t * .64 + .6));",
    "  float v = sin(p.x * 2.4) + sin(p.y * 2.1) + sin((p.x + p.y) * 1.6 + t * .35);",
    "  v = abs(v) * .3333;",
    "  return pow(1. - v, 9.);",
    "}",

    "void main(){",
    "  vec4 hs = texture2D(uH, vUv);",
    "  vec2 g = (hs.rg - .5) * 2.;",
    "  vec2 uv = vUv + g * uRefr / uRes;",
    "  vec4 txt = texture2D(uT, uv);",
    "  float asp = uRes.x / uRes.y;",
    "  vec2 q = vec2(vUv.x * asp, vUv.y) * 3.2 + g * .9;",
    "  float c = caustic(q, uTime * .55) * .65 + caustic(q * 1.7 + 4.3, uTime * .8) * .35;",
    "  vec3 col = mix(uTop, uBot, smoothstep(0., 1., vUv.y));",
    "  col += c * .13;",
    "  col = mix(col, txt.rgb, txt.a);",
    "  vec3 n = normalize(vec3(-g * 2.4, 1.));",
    "  vec3 L = normalize(vec3(-.45, -.55, .7));",
    "  col += (dot(n, L) - L.z) * .42;",
    "  float spec = pow(max(dot(reflect(-L, n), vec3(0., 0., 1.)), 0.), 90.);",
    "  col += spec * .7;",
    "  gl_FragColor = vec4(col, 1.);",
    "}"
  ].join("\n");

  function hexToVec(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  function DCWater(canvas, opts) {
    opts = opts || {};
    var gl;
    try {
      gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: "low-power" }) ||
        canvas.getContext("experimental-webgl");
    } catch (e) { gl = null; }
    if (!gl) return null;

    function shader(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    }
    var prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    var U = {};
    ["uH", "uT", "uRes", "uTime", "uRefr", "uTop", "uBot"].forEach(function (k) { U[k] = gl.getUniformLocation(prog, k); });
    gl.uniform1i(U.uH, 0);
    gl.uniform1i(U.uT, 1);
    gl.uniform3fv(U.uTop, hexToVec(opts.top || "#D6EEF7"));
    gl.uniform3fv(U.uBot, hexToVec(opts.bottom || "#BFE2F0"));

    function texture(unit) {
      var t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }
    var texH = texture(0), texT = texture(1);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    /* --- simulation --------------------------------------------------- */
    var cols = 0, rows = 0, cur, prev, packed, cellX = 8, cellY = 8, energy = 0;
    var DAMP = 0.982;

    function step() {
      var c = cols, r = rows, a = cur, b = prev, e = 0;
      for (var y = 1; y < r - 1; y++) {
        var row = y * c;
        for (var x = 1; x < c - 1; x++) {
          var i = row + x;
          var n = (a[i - 1] + a[i + 1] + a[i - c] + a[i + c]) * 0.5 - b[i];
          n *= DAMP;
          b[i] = n;
          e += n < 0 ? -n : n;
        }
      }
      prev = a; cur = b;
      energy = e / (c * r);
    }

    function pack() {
      var c = cols, r = rows, h = cur, out = packed;
      for (var y = 0; y < r; y++) {
        var ym = y > 0 ? y - 1 : y, yp = y < r - 1 ? y + 1 : y;
        for (var x = 0; x < c; x++) {
          var xm = x > 0 ? x - 1 : x, xp = x < c - 1 ? x + 1 : x;
          var i = y * c + x, o = i * 4;
          var gx = (h[y * c + xp] - h[y * c + xm]) * 0.5;
          var gy = (h[yp * c + x] - h[ym * c + x]) * 0.5;
          var vx = 128 + gx * 160, vy = 128 + gy * 160, vh = 128 + h[i] * 60;
          out[o] = vx < 0 ? 0 : vx > 255 ? 255 : vx;
          out[o + 1] = vy < 0 ? 0 : vy > 255 ? 255 : vy;
          out[o + 2] = vh < 0 ? 0 : vh > 255 ? 255 : vh;
          out[o + 3] = 255;
        }
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texH);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, out);
    }

    function drop(x, y, force, radius) {
      if (!cols) return;
      var cx = x / cellX, cy = y / cellY, rad = Math.max(1.5, (radius || 14) / cellX), f = force == null ? 1 : force;
      var x0 = Math.max(1, Math.floor(cx - rad)), x1 = Math.min(cols - 2, Math.ceil(cx + rad));
      var y0 = Math.max(1, Math.floor(cy - rad)), y1 = Math.min(rows - 2, Math.ceil(cy + rad));
      for (var j = y0; j <= y1; j++) {
        for (var i = x0; i <= x1; i++) {
          var d = Math.sqrt((i - cx) * (i - cx) + (j - cy) * (j - cy)) / rad;
          if (d < 1) cur[j * cols + i] -= f * (Math.cos(d * Math.PI) + 1) * 0.5;
        }
      }
      wake();
    }

    /* --- calque de texte : chaque caractère est dessiné à la position
           exacte que lui donne la mise en page HTML -------------------- */
    var tc = document.createElement("canvas"), tctx = tc.getContext("2d");
    var range = document.createRange();

    function paintText() {
      var W = canvas.width, H = canvas.height;
      tc.width = W; tc.height = H;
      tctx.clearRect(0, 0, W, H);
      var root = opts.textRoot;
      if (root) {
        var origin = canvas.getBoundingClientRect(), k = W / Math.max(1, origin.width);
        if (opts.icon && opts.icon.complete && opts.icon.naturalWidth) {
          var eb = root.querySelector(".eyebrow");
          if (eb) {
            var er = eb.getBoundingClientRect(), fs = parseFloat(getComputedStyle(eb).fontSize);
            var ih = fs * 1.05, iw = fs * 0.72;
            tctx.drawImage(opts.icon, (er.left - origin.left) * k, (er.top + er.height / 2 - ih / 2 - origin.top) * k, iw * k, ih * k);
          }
        }
        var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), node;
        while ((node = walker.nextNode())) {
          var el = node.parentElement, cs = getComputedStyle(el), text = node.nodeValue;
          if (!text.trim()) continue;
          var tt = cs.textTransform;
          if (tt === "uppercase") text = text.toUpperCase();
          else if (tt === "lowercase") text = text.toLowerCase();
          var size = parseFloat(cs.fontSize) * k;
          tctx.font = cs.fontStyle + " " + cs.fontWeight + " " + size + "px " + cs.fontFamily;
          tctx.fillStyle = cs.color;
          tctx.textBaseline = "alphabetic";
          var m = tctx.measureText("H");
          var asc = m.fontBoundingBoxAscent || size * 0.968;
          for (var i = 0; i < text.length; i++) {
            var ch = text.charAt(i);
            if (/\s/.test(ch)) continue;
            range.setStart(node, i);
            range.setEnd(node, i + 1);
            var r = range.getBoundingClientRect();
            if (!r.width && !r.height) continue;
            tctx.fillText(ch, (r.left - origin.left) * k, (r.top - origin.top) * k + asc);
          }
        }
      }
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, texT);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tc);
    }

    function resize() {
      var w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      var dpr = Math.min(window.devicePixelRatio || 1, w < 700 ? 2 : 1.5);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      var cell = w < 700 ? 6 : 8;
      var nc = Math.max(24, Math.round(w / cell)), nr = Math.max(24, Math.round(h / cell));
      cellX = w / nc; cellY = h / nr;
      if (nc !== cols || nr !== rows) {
        cols = nc; rows = nr;
        cur = new Float32Array(cols * rows);
        prev = new Float32Array(cols * rows);
        packed = new Uint8Array(cols * rows * 4);
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(U.uRes, canvas.width, canvas.height);
      gl.uniform1f(U.uRefr, 26 * dpr);
      paintText();
      pack();
    }

    /* --- boucle ------------------------------------------------------- */
    var raf = 0, visible = false, last = 0, acc = 0, t0 = performance.now(), dead = false;

    function frame(now) {
      raf = 0;
      if (dead || !visible || document.hidden) return;
      var dt = Math.min(64, now - (last || now));
      last = now;
      acc += dt;
      var n = 0;
      while (acc >= 16.6 && n < 3) { step(); acc -= 16.6; n++; }
      if (n) pack();
      gl.uniform1f(U.uTime, (now - t0) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(frame);
    }
    function wake() { if (!raf && visible && !dead) { last = 0; raf = requestAnimationFrame(frame); } }

    var io = new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      if (visible) wake();
    }, { rootMargin: "80px 0px" });
    io.observe(canvas);
    document.addEventListener("visibilitychange", wake);

    var rt = 0;
    function onResize() { clearTimeout(rt); rt = setTimeout(function () { resize(); wake(); }, 120); }
    window.addEventListener("resize", onResize);
    if (window.ResizeObserver) new ResizeObserver(onResize).observe(canvas);

    canvas.addEventListener("webglcontextlost", function (e) {
      e.preventDefault();
      dead = true;
      if (opts.onLost) opts.onLost();
    });

    resize();

    return {
      drop: drop,
      refresh: function () { resize(); wake(); },
      energy: function () { return energy; },
      destroy: function () { dead = true; io.disconnect(); window.removeEventListener("resize", onResize); }
    };
  }

  window.DCWater = DCWater;
})();
