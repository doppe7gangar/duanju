// Local sharpening cannot recover detail lost in the source encode.
// 标准 / 强: contrast-adaptive sharpening at screen size.
// 精细 (stored as "ultra" for existing preferences): bicubic resampling followed by
// the same sharpening, slightly stronger. No denoising: smoothing low-contrast
// texture before sharpening made the previous 超清 mode softer than 强.
// Falls back to the plain <video> if WebGL is unavailable.
(() => {
  const canvas = $('#enhance-canvas');
  const select = $('#enhance');
  let gl = null;
  let failed = false;
  let frameRequest = 0;
  let hasFrame = false;
  let mode = select.value;
  const programs = {};
  let videoTexture = null;
  let stages = [];      // one resampling target for 精细
  let stageSize = [0, 0];

  const VERTEX = `attribute vec2 p; varying vec2 uv;
    void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

  // 标准 / 强: single CAS pass straight to the screen-sized canvas.
  const CAS = `precision highp float;
    uniform sampler2D frame; uniform vec2 px; uniform float sharpness; varying vec2 uv;
    void main() {
      vec3 c = texture2D(frame, uv).rgb;
      vec3 n = texture2D(frame, uv + vec2(0.0, px.y)).rgb;
      vec3 s = texture2D(frame, uv - vec2(0.0, px.y)).rgb;
      vec3 e = texture2D(frame, uv + vec2(px.x, 0.0)).rgb;
      vec3 w = texture2D(frame, uv - vec2(px.x, 0.0)).rgb;
      vec3 mn = min(c, min(min(n, s), min(e, w)));
      vec3 mx = max(c, max(max(n, s), max(e, w)));
      vec3 amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, vec3(0.0001)), 0.0, 1.0));
      vec3 weight = -amp / mix(8.0, 5.0, sharpness);
      vec3 color = (c + (n + s + e + w) * weight) / (1.0 + 4.0 * weight);
      gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    }`;

  // Detail-preserving resample: Catmull-Rom bicubic up, 4x supersampled down.
  const RESAMPLE = `precision highp float;
    uniform sampler2D frame; uniform vec2 srcSize; uniform vec2 outPx; uniform float shrinking; varying vec2 uv;
    vec3 catmullRom(vec2 coord) {
      vec2 pos = coord * srcSize - 0.5;
      vec2 f = fract(pos);
      vec2 base = (floor(pos) + 0.5) / srcSize;
      vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
      vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
      vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
      vec2 w3 = f * f * (-0.5 + 0.5 * f);
      vec2 w12 = w1 + w2;
      vec2 off12 = w2 / w12;
      vec2 t0 = base - 1.0 / srcSize;
      vec2 t3 = base + 2.0 / srcSize;
      vec2 t12 = base + off12 / srcSize;
      vec3 r = texture2D(frame, vec2(t0.x, t0.y)).rgb * w0.x * w0.y
        + texture2D(frame, vec2(t12.x, t0.y)).rgb * w12.x * w0.y
        + texture2D(frame, vec2(t3.x, t0.y)).rgb * w3.x * w0.y
        + texture2D(frame, vec2(t0.x, t12.y)).rgb * w0.x * w12.y
        + texture2D(frame, vec2(t12.x, t12.y)).rgb * w12.x * w12.y
        + texture2D(frame, vec2(t3.x, t12.y)).rgb * w3.x * w12.y
        + texture2D(frame, vec2(t0.x, t3.y)).rgb * w0.x * w3.y
        + texture2D(frame, vec2(t12.x, t3.y)).rgb * w12.x * w3.y
        + texture2D(frame, vec2(t3.x, t3.y)).rgb * w3.x * w3.y;
      return r;
    }
    void main() {
      vec3 color;
      if (shrinking > 0.5) {
        vec2 q = outPx * 0.25;
        color = 0.25 * (texture2D(frame, uv + vec2(-q.x, -q.y)).rgb + texture2D(frame, uv + vec2(q.x, -q.y)).rgb
          + texture2D(frame, uv + vec2(-q.x, q.y)).rgb + texture2D(frame, uv + vec2(q.x, q.y)).rgb);
      } else color = catmullRom(uv);
      color = clamp(color, 0.0, 1.0);
      gl_FragColor = vec4(color, 1.0);
    }`;

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'shader');
    return shader;
  }
  function link(fragment, names) {
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.bindAttribLocation(program, 0, 'p');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('link');
    const uniforms = {};
    for (const name of names) uniforms[name] = gl.getUniformLocation(program, name);
    return { program, uniforms };
  }
  function makeTexture() {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    for (const [key, value] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, key, value);
    return texture;
  }
  function init() {
    if (gl || failed) return !!gl;
    try {
      gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
      if (!gl) throw new Error('WebGL unavailable');
      programs.cas = link(CAS, ['frame', 'px', 'sharpness']);
      programs.resample = link(RESAMPLE, ['frame', 'srcSize', 'outPx', 'shrinking']);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      videoTexture = makeTexture();
      stages = [0].map(() => ({ texture: makeTexture(), buffer: gl.createFramebuffer() }));
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      return true;
    } catch (_) {
      failed = true;
      gl = null;
      canvas.hidden = true;
      return false;
    }
  }

  // Render at the on-screen size of the picture (object-fit contain / cover) in device pixels.
  function fitCanvas() {
    const frame = canvas.parentElement.getBoundingClientRect();
    const fit = $('#theater').classList.contains('fit-cover') ? Math.max : Math.min;
    const scale = fit(frame.width / video.videoWidth, frame.height / video.videoHeight);
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.min(3840, Math.round(video.videoWidth * scale * ratio)));
    const height = Math.max(1, Math.min(3840, Math.round(video.videoHeight * scale * ratio)));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  }
  function ensureStages(width, height) {
    if (stageSize[0] === width && stageSize[1] === height) return;
    for (const stage of stages) {
      gl.bindTexture(gl.TEXTURE_2D, stage.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, stage.buffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, stage.texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer');
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    stageSize = [width, height];
  }
  // Draw a full-screen pass from `source` texture into `target` (null = the canvas).
  function pass(program, source, target, width, height, setUniforms) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.bindTexture(gl.TEXTURE_2D, source);
    gl.viewport(0, 0, width, height);
    gl.useProgram(program.program);
    gl.uniform1i(program.uniforms.frame, 0);
    setUniforms(program.uniforms);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  function draw() {
    if (mode === '0' || !video.videoWidth || video.readyState < 2 || !init()) return;
    try {
      fitCanvas();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, videoTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
      let sharpenSource = videoTexture;
      if (mode === 'ultra') {
        // Work at the on-screen size, so nothing added here is averaged away by a later downscale.
        const sw = video.videoWidth;
        const sh = video.videoHeight;
        const ow = canvas.width;
        const oh = canvas.height;
        ensureStages(ow, oh);
        pass(programs.resample, videoTexture, stages[0].buffer, ow, oh, u => {
          gl.uniform2f(u.srcSize, sw, sh);
          gl.uniform2f(u.outPx, 1 / ow, 1 / oh);
          // Bicubic keeps more detail for mild reductions; supersample only when shrinking below half.
          gl.uniform1f(u.shrinking, ow < sw * 0.5 ? 1 : 0);
        });
        sharpenSource = stages[0].texture;
      }
      pass(programs.cas, sharpenSource, null, canvas.width, canvas.height, u => {
        gl.uniform2f(u.px, 1 / canvas.width, 1 / canvas.height);
        gl.uniform1f(u.sharpness, mode === 'ultra' ? 1.0 : Number(mode) || 0.5);
      });
      if (!hasFrame) { hasFrame = true; canvas.classList.add('live'); }
    } catch (_) {
      failed = true;
      canvas.hidden = true;
      stop();
    }
  }
  function onFrame() {
    frameRequest = 0;
    draw();
    start();
  }
  function start() {
    if (frameRequest || mode === '0' || failed || !('requestVideoFrameCallback' in video)) return;
    frameRequest = video.requestVideoFrameCallback(onFrame);
  }
  function stop() {
    if (frameRequest) video.cancelVideoFrameCallback(frameRequest);
    frameRequest = 0;
  }
  function blank() {
    hasFrame = false;
    canvas.classList.remove('live');
  }
  function apply() {
    mode = select.value;
    canvas.hidden = mode === '0' || failed;
    if (mode !== '0') { draw(); start(); } else { stop(); blank(); }
  }

  select.addEventListener('change', () => {
    try { localStorage.setItem('guoju:enhance', select.value); } catch (_) {}
    apply();
  });
  // A new episode must not show the previous episode's last frame while it loads.
  video.addEventListener('emptied', blank);
  for (const type of ['loadeddata', 'seeked', 'play']) video.addEventListener(type, () => { draw(); start(); });
  new ResizeObserver(() => draw()).observe(canvas.parentElement);
  $('#fit').addEventListener('change', () => requestAnimationFrame(draw));
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); gl = null; stageSize = [0, 0]; blank(); });
  canvas.addEventListener('webglcontextrestored', () => { failed = false; apply(); });
  apply();
})();
