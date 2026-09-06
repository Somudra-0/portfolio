/**
 * main.js  —  Glitch Portfolio Core  (standalone, no ES module imports)
 * Works over both file:// and http:// — Three.js loaded globally via <script>
 * ───────────────────────────────────────────────────────────────────────────
 * Architecture:
 *   1. Capability detection → fallback to CSS-grid on low-end devices
 *   2. Three.js render pipeline
 *      a. Off-screen RenderTarget for the "scene" content
 *      b. Animated noise background + floating particle field
 *      c. Full-screen quad with GLSL glitch shader (post-process)
 *   3. Parallax layer system — three DOM layers move at different
 *      speeds reacting to mouse + scroll ("anti-gravity drift")
 *   4. Projects loaded via fetch('./projects.json')
 *   5. DOM construction, custom cursor, smooth loading screen
 */

/* ═══════════════════════════════════════════════════════════════
   GLSL SHADERS  (inlined — avoids cross-origin import issues)
═══════════════════════════════════════════════════════════════ */
const VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG_GLITCH = `
  uniform sampler2D uScene;
  uniform float     uTime;
  uniform float     uGlitch;
  uniform float     uScroll;
  uniform vec2      uMouse;
  uniform vec2      uResolution;
  varying vec2 vUv;

  float hash(float n) { return fract(sin(n) * 43758.5453123); }
  float hash2(vec2 p)  { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash2(i), b = hash2(i+vec2(1,0)),
          c = hash2(i+vec2(0,1)), d = hash2(i+vec2(1,1));
    return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
  }

  float scanline(vec2 uv, float lc, float s) {
    return 1.0 - s * (0.5 - 0.5 * sin(uv.y * lc * 3.14159));
  }

  vec2 blockShift(vec2 uv, float intensity) {
    float bs  = 0.04 + 0.08 * hash(floor(uTime * 3.0));
    float row = floor(uv.y / bs);
    float trig = hash(row + floor(uTime * 4.0));
    if (trig < intensity * 0.7) {
      float shift = (hash(row * 2.0 + 1.0) - 0.5) * 0.06 * intensity;
      uv.x = fract(uv.x + shift);
    }
    return uv;
  }

  vec3 chromaOffset(sampler2D tex, vec2 uv, float amount) {
    vec2 dir = (uv - 0.5) * amount;
    float r = texture2D(tex, uv + dir * vec2(1.0, 0.3)).r;
    float g = texture2D(tex, uv).g;
    float b = texture2D(tex, uv - dir * vec2(1.0, 0.3)).b;
    return vec3(r, g, b);
  }

  float vignette(vec2 uv, float s) {
    vec2 d = uv - 0.5;
    return 1.0 - dot(d,d) * s;
  }

  float digitalNoise(vec2 uv, float t) {
    return hash2(floor(uv * 4.0) + vec2(floor(t * 8.0)));
  }

  void main() {
    vec2 uv = vUv;
    float burstCycle = floor(uTime * 3.0);
    float burstRand  = hash(burstCycle * 7.4);
    float burst      = step(0.82, burstRand) * uGlitch;

    vec2 shiftedUv = blockShift(uv, burst);
    float ca = 0.006 + burst * 0.018;
    vec3 col = chromaOffset(uScene, shiftedUv, ca);

    col *= scanline(uv, uResolution.y * 0.5, 0.12 + burst * 0.08);

    float barT  = floor(uTime * 2.0 + 0.5);
    float barPos = hash(barT * 3.7);
    float barW   = 0.015 + hash(barT) * 0.04;
    if (burst > 0.5 && abs(uv.y - barPos) < barW) {
      float bs = (hash(barT * 9.1) - 0.5) * 0.12;
      col = chromaOffset(uScene, vec2(fract(uv.x + bs), uv.y), 0.025);
      col = mix(col, col.gbr, 0.4);
    }

    if (burst > 0.4) {
      float n = digitalNoise(uv, uTime);
      col = mix(col, vec3(n * 0.2, n * 1.0, n * 0.6), burst * 0.08);
    }

    col *= vignette(uv, 1.6);
    col *= 1.0 + burst * 0.08 * sin(uTime * 60.0);

    vec2 mo = (uMouse - 0.5) * 0.003;
    vec3 mc = chromaOffset(uScene, clamp(uv + mo, 0.0, 1.0), 0.002);
    col = mix(col, mc, 0.3);

    gl_FragColor = vec4(col, 1.0);
  }
`;

const FRAG_BG = `
  uniform float uTime;
  uniform vec2  uMouse;
  uniform float uScroll;
  varying vec2 vUv;

  float hash2(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  float noise(vec2 p){
    vec2 i=floor(p),f=fract(p);
    f=f*f*(3.0-2.0*f);
    return mix(mix(hash2(i),hash2(i+vec2(1,0)),f.x),
               mix(hash2(i+vec2(0,1)),hash2(i+vec2(1,1)),f.x),f.y);
  }
  void main(){
    vec2 uv = vUv + (uMouse - 0.5) * 0.04;
    uv.y += uScroll * 0.1;
    float n1=noise(uv*3.0 +vec2(uTime*.05,0));
    float n2=noise(uv*6.0 -vec2(0,uTime*.04));
    float n3=noise(uv*12.0+vec2(uTime*.02));
    vec3 col = vec3(0.015,0.015,0.03)
             + vec3(0,0.22,0.18)*n1
             + vec3(0.18,0,0.12)*n2
             + n3*0.015;
    float glow = smoothstep(0.3,0.0,abs(uv.y-0.5-uScroll*0.05));
    col += vec3(0,0.08,0.06)*glow;
    gl_FragColor = vec4(col,1.0);
  }
`;

const VERT_PARTICLES = `
  attribute float size;
  attribute vec3  color;
  varying   vec3  vColor;
  uniform   float uTime;
  uniform   vec2  uMouse;
  void main(){
    vColor = color;
    vec3 pos = position;
    float phase = pos.x*10.0+pos.y*7.0;
    pos.x += sin(uTime*0.4+phase)*0.005;
    pos.y += cos(uTime*0.3+phase)*0.007;
    vec2 m  = uMouse*2.0-1.0;
    vec2 d  = pos.xy-m;
    float dl = length(d);
    pos.xy  += normalize(d)*max(0.0,0.08-dl)*0.3;
    vec4 mv = modelViewMatrix*vec4(pos,1.0);
    gl_PointSize = size*(250.0/-mv.z);
    gl_Position  = projectionMatrix*mv;
  }
`;

const FRAG_PARTICLES = `
  varying vec3 vColor;
  void main(){
    float d = length(gl_PointCoord-0.5);
    if(d>0.5) discard;
    float alpha = smoothstep(0.5,0.1,d)*0.6;
    gl_FragColor = vec4(vColor,alpha);
  }
`;

/* ═══════════════════════════════════════════════════════════════
   CAPABILITY DETECTION
═══════════════════════════════════════════════════════════════ */
const WEBGL_OK = (() => {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch(e) { return false; }
})();

const LOW_END = !WEBGL_OK
  || navigator.hardwareConcurrency <= 2
  || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (LOW_END) document.body.classList.add('no-webgl');

/* ═══════════════════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════════════════ */
const state = {
  mouse:    { x: 0.5, y: 0.5 },
  scroll:   0,
  scrollPx: 0,
  glitch:   1.0,
  time:     0,
  lastTime: 0,
  projects: [],
};

/* ═══════════════════════════════════════════════════════════════
   LOADER
═══════════════════════════════════════════════════════════════ */
const loaderEl  = document.getElementById('loader');
const loaderBar = document.querySelector('.loader-bar');

function setProgress(pct) {
  if (loaderBar) loaderBar.style.width = pct + '%';
}
function hideLoader() {
  if (loaderEl) loaderEl.classList.add('hidden');
}

/* ═══════════════════════════════════════════════════════════════
   THREE.JS SETUP
═══════════════════════════════════════════════════════════════ */
let renderer, sceneMain, cameraMain, renderTarget, particleMesh;
let quadScene, quadCamera;
let bgUniforms, quadUniforms, particleUniforms;

function initThree() {
  const canvas = document.getElementById('gl-canvas');
  if (!canvas || typeof THREE === 'undefined') return;

  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);

  /* ── Scene A: background + particles → RenderTarget ─── */
  sceneMain  = new THREE.Scene();
  cameraMain = new THREE.OrthographicCamera(-1,1,1,-1,0.1,10);
  cameraMain.position.z = 1;

  renderTarget = new THREE.WebGLRenderTarget(
    window.innerWidth, window.innerHeight,
    { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }
  );

  bgUniforms = {
    uTime:   { value: 0 },
    uMouse:  { value: new THREE.Vector2(0.5, 0.5) },
    uScroll: { value: 0 },
  };
  const bgMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ uniforms: bgUniforms, vertexShader: VERT, fragmentShader: FRAG_BG })
  );
  sceneMain.add(bgMesh);

  /* particles */
  particleMesh = buildParticles();
  sceneMain.add(particleMesh);

  /* ── Scene B: post-process glitch quad → screen ──── */
  quadScene  = new THREE.Scene();
  quadCamera = new THREE.OrthographicCamera(-1,1,1,-1,0.1,10);
  quadCamera.position.z = 1;

  quadUniforms = {
    uScene:      { value: renderTarget.texture },
    uTime:       { value: 0 },
    uGlitch:     { value: 1.0 },
    uScroll:     { value: 0 },
    uMouse:      { value: new THREE.Vector2(0.5, 0.5) },
    uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
  };
  const quadMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ uniforms: quadUniforms, vertexShader: VERT, fragmentShader: FRAG_GLITCH })
  );
  quadScene.add(quadMesh);
}

function buildParticles() {
  const COUNT = 1000;
  const positions  = new Float32Array(COUNT * 3);
  const velocities = new Float32Array(COUNT * 3);
  const colors     = new Float32Array(COUNT * 3);
  const sizes      = new Float32Array(COUNT);

  const palette = [
    new THREE.Color('#00ffcc'),
    new THREE.Color('#ff00aa'),
    new THREE.Color('#ffaa00'),
    new THREE.Color('#aa00ff'),
    new THREE.Color('#ffffff'),
  ];

  for (let i = 0; i < COUNT; i++) {
    positions[i*3]   = (Math.random()-0.5)*2;
    positions[i*3+1] = (Math.random()-0.5)*2;
    positions[i*3+2] = Math.random()*-0.5;
    velocities[i*3]   = (Math.random()-0.5)*0.0003;
    velocities[i*3+1] = (Math.random()-0.5)*0.0003 - 0.00005;
    const clr = palette[Math.floor(Math.random()*palette.length)];
    colors[i*3]=clr.r; colors[i*3+1]=clr.g; colors[i*3+2]=clr.b;
    sizes[i] = Math.random()*2+0.5;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions,  3));
  geo.setAttribute('color',    new THREE.BufferAttribute(colors,     3));
  geo.setAttribute('size',     new THREE.BufferAttribute(sizes,      1));
  geo._vel = velocities;

  particleUniforms = {
    uTime:  { value: 0 },
    uMouse: { value: new THREE.Vector2(0.5,0.5) },
  };

  return new THREE.Points(geo, new THREE.ShaderMaterial({
    uniforms:       particleUniforms,
    vertexShader:   VERT_PARTICLES,
    fragmentShader: FRAG_PARTICLES,
    transparent:    true,
    vertexColors:   true,
    depthWrite:     false,
    blending:       THREE.AdditiveBlending,
  }));
}

/* ═══════════════════════════════════════════════════════════════
   PARALLAX DOM LAYERS
═══════════════════════════════════════════════════════════════ */
const layers = {
  bg:  { el: null, speedX: 0.012, speedY: 0.008, scrollF: -0.04 },
  mid: { el: null, speedX: 0.025, speedY: 0.018, scrollF:  0.02 },
  fg:  { el: null, speedX: 0.045, speedY: 0.032, scrollF:  0.06 },
};

const lerpMouse = { x: 0, y: 0 };

function updateParallax() {
  const cx = state.mouse.x - 0.5;
  const cy = state.mouse.y - 0.5;
  lerpMouse.x += (cx - lerpMouse.x) * 0.06;
  lerpMouse.y += (cy - lerpMouse.y) * 0.06;

  for (const layer of Object.values(layers)) {
    if (!layer.el) continue;
    const tx = lerpMouse.x * window.innerWidth  * layer.speedX;
    const ty = lerpMouse.y * window.innerHeight * layer.speedY
             + state.scrollPx * layer.scrollF;
    layer.el.style.transform = `translate(${tx}px,${ty}px)`;
  }
}

function populateParallaxLayers() {
  layers.bg.el  = document.getElementById('layer-bg');
  layers.mid.el = document.getElementById('layer-mid');
  layers.fg.el  = document.getElementById('layer-fg');

  const symbols = ['◈','⬡','✦','◎','⬢','▲','◇','⬟'];

  // inject floating animation keyframes once
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    @keyframes float-1{0%,100%{transform:translateY(0) rotate(0deg)} 50%{transform:translateY(-18px) rotate(5deg)}}
    @keyframes float-2{0%,100%{transform:translateY(0) rotate(0deg)} 50%{transform:translateY(-12px) rotate(-4deg)}}
    @keyframes float-3{0%,100%{transform:translateY(0) rotate(0deg)} 50%{transform:translateY(-22px) rotate(8deg)}}
  `;
  document.head.appendChild(styleEl);

  function addFloaters(layer, count, sizeRange, opacityRange, palette) {
    if (!layer.el) return;
    for (let i = 0; i < count; i++) {
      const el  = document.createElement('span');
      const s   = sizeRange[0]   + Math.random()*(sizeRange[1]-sizeRange[0]);
      const op  = opacityRange[0]+ Math.random()*(opacityRange[1]-opacityRange[0]);
      const clr = palette[Math.floor(Math.random()*palette.length)];
      const sym = symbols[Math.floor(Math.random()*symbols.length)];
      Object.assign(el.style, {
        position:  'absolute',
        left:      Math.random()*110-5+'%',
        top:       Math.random()*110-5+'%',
        fontSize:  s+'px',
        color:     clr,
        opacity:   op,
        userSelect:'none',
        fontFamily:'monospace',
        filter:    i%3===0?'blur(0px)':'blur(1px)',
        animation: `float-${(i%3)+1} ${4+Math.random()*6}s ${Math.random()*4}s ease-in-out infinite`,
        pointerEvents:'none',
      });
      el.textContent = sym;
      layer.el.appendChild(el);
    }
  }

  if (!LOW_END) {
    addFloaters(layers.bg,  16, [10,20], [0.03,0.12], ['#00ffcc','#ff00aa','#ffaa00']);
    addFloaters(layers.mid, 10, [18,36], [0.06,0.18], ['#00ffcc','#aa00ff','#ff00aa']);
    addFloaters(layers.fg,   6, [30,60], [0.04,0.10], ['#00ffcc','#ffffff']);
  }
}

/* ═══════════════════════════════════════════════════════════════
   PROJECTS  (fetch + inject)
═══════════════════════════════════════════════════════════════ */
async function loadProjects() {
  try {
    // fetch works on http://. On file:// it may be blocked by browser security.
    const res = await fetch('./projects.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    state.projects = await res.json();
  } catch (e) {
    console.warn('[Portfolio] fetch failed, using inline demo data.', e);
    state.projects = DEMO_PROJECTS;
  }
  renderProjects(state.projects);
}

/* Inline fallback data so file:// users still see project cards */
const DEMO_PROJECTS = [
  { id:1, title:'Roro',                       subtitle:'A personal AI companion built to understand, remember, and interact.',       description:'An ongoing personal project combining conversation, memory, personality, reasoning, voice interaction, automation, computer interaction, and both local and online AI capabilities. Roro can act as a companion, but it can also handle assistant-like tasks and interact with different tools and systems. The project is focused on building something that can continuously evolve rather than simply behave like a conventional chatbot.',          tags:['AI Companion','Memory','Voice','Automation'],       image:'./img-roro.png',        link:'#', status:'In Active Development', color:'#00ffcc' },
  { id:2, title:'Roro Studio',                subtitle:'Exploring AI-powered workflows for creative software.',                      description:'A project exploring how AI and automation can assist with video editing and other creative workflows across different editing software and tools. The goal is to make complicated creative workflows easier to automate, experiment with, and control through intelligent systems.',                                                                                                                                                                    tags:['AI','Video','Automation','Creative Tools'],         image:'./img-roro-studio.png', link:'#', status:'In Development',       color:'#ff00aa' },
  { id:3, title:'Interactive Web Experiments', subtitle:'Web experiences built to move, react, and be explored.',                    description:'Experiments with animation, shaders, procedural visuals, interaction, and unconventional interfaces. This portfolio is itself part of that experimentation.',                                                                                                                                                                                                                                                                              tags:['JavaScript','WebGL','Three.js','Creative Code'],    image:'./img-web.png',         link:'#', status:'Ongoing',              color:'#ffaa00' },
  { id:4, title:'Games & Experiments',        subtitle:'Small ideas built to see what happens.',                                     description:'Games, prototypes, interactive experiments, and random technical ideas built for learning and exploration. Some become finished projects. Others exist simply because they were interesting enough to build.',                                                                                                                                                                                                                tags:['Game Dev','JavaScript','Prototypes'],               image:'./img-games.png',       link:'#', status:'Experimental',         color:'#aa00ff' },
];

function renderProjects(projects) {
  const grid = document.querySelector('.project-grid');
  if (!grid) return;

  grid.innerHTML = projects.map((p, i) => `
    <article class="project-card" style="--card-accent:${p.color}" data-id="${p.id}">
      <div class="card-glitch"></div>
      <img class="card-img" src="${p.image}" alt="${p.title}" loading="lazy"
           onerror="this.style.cssText='background:#111;height:200px;display:block';" />
      <div class="card-body">
        <div class="card-tags">
          ${p.tags.map(t=>`<span class="card-tag">${t}</span>`).join('')}
        </div>
        <h3 class="card-title">${p.title}</h3>
        ${p.subtitle ? `<p class="card-subtitle">${p.subtitle}</p>` : ''}
        <p class="card-desc">${p.description}</p>
        ${p.link && p.link !== '#'
          ? `<a class="card-link" href="${p.link}" target="_blank" rel="noopener">View Project</a>`
          : `<span class="card-status">${p.status || 'Ongoing'}</span>`
        }
      </div>
    </article>
  `).join('');

  /* 3-D tilt on hover */
  grid.querySelectorAll('.project-card').forEach(card => {
    card.addEventListener('mousemove', e => {
      if (LOW_END) return;
      const r  = card.getBoundingClientRect();
      const cx = (e.clientX-r.left)/r.width  - 0.5;
      const cy = (e.clientY-r.top) /r.height - 0.5;
      card.style.transform =
        `translateY(-8px) scale(1.01) rotateX(${-cy*8}deg) rotateY(${cx*8}deg)`;
    });
    card.addEventListener('mouseleave', () => { card.style.transform=''; });
  });

  /* scroll-in reveal */
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.style.opacity   = '1';
        e.target.style.transform = 'translateY(0)';
        obs.unobserve(e.target);
      }
    });
  }, { threshold: 0.1 });

  grid.querySelectorAll('.project-card').forEach((card, i) => {
    card.style.opacity    = '0';
    card.style.transform  = 'translateY(40px)';
    card.style.transition = `opacity .6s ${i*0.08}s ease, transform .6s ${i*0.08}s cubic-bezier(.23,1,.32,1)`;
    obs.observe(card);
  });
}

/* ═══════════════════════════════════════════════════════════════
   CUSTOM CURSOR
═══════════════════════════════════════════════════════════════ */
function initCursor() {
  if (LOW_END || !window.matchMedia('(pointer:fine)').matches) return;
  const dot  = document.createElement('div');
  const ring = document.createElement('div');
  dot.className  = 'cursor';
  ring.className = 'cursor-ring';
  document.body.append(dot, ring);
  let rx = 0, ry = 0;
  document.addEventListener('mousemove', e => {
    dot.style.left = ring.style.left = e.clientX+'px';
    dot.style.top  = ring.style.top  = e.clientY+'px';
    rx = e.clientX; ry = e.clientY;
  });
  document.addEventListener('mousedown', () => {
    dot.style.transform  = 'translate(-50%,-50%) scale(1.6)';
    ring.style.transform = 'translate(-50%,-50%) scale(0.7)';
  });
  document.addEventListener('mouseup', () => {
    dot.style.transform = ring.style.transform = '';
  });
  (function lagRing(){
    const rl = parseFloat(ring.style.left)||0;
    const rt = parseFloat(ring.style.top) ||0;
    ring.style.left = rl+(rx-rl)*0.14+'px';
    ring.style.top  = rt+(ry-rt)*0.14+'px';
    requestAnimationFrame(lagRing);
  })();
}

/* ═══════════════════════════════════════════════════════════════
   INPUT EVENTS
═══════════════════════════════════════════════════════════════ */
function initEvents() {
  window.addEventListener('mousemove', e => {
    state.mouse.x = e.clientX / window.innerWidth;
    state.mouse.y = 1 - e.clientY / window.innerHeight;
  });
  window.addEventListener('touchmove', e => {
    const t = e.touches[0];
    state.mouse.x = t.clientX / window.innerWidth;
    state.mouse.y = 1 - t.clientY / window.innerHeight;
  }, { passive: true });
  window.addEventListener('scroll', () => {
    const max     = document.body.scrollHeight - window.innerHeight;
    state.scrollPx = window.scrollY;
    state.scroll   = max > 0 ? window.scrollY / max : 0;
  }, { passive: true });
  window.addEventListener('resize', () => {
    if (!renderer) return;
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderTarget.setSize(window.innerWidth, window.innerHeight);
    if (quadUniforms) quadUniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
  });
}

/* ═══════════════════════════════════════════════════════════════
   RENDER LOOP
═══════════════════════════════════════════════════════════════ */
let glitchTarget  = 1.0;
let nextGlitchAt  = 0;

function scheduleGlitch(t) {
  if (t > nextGlitchAt) {
    glitchTarget = Math.random() > 0.3 ? 1.0 : 0.0;
    nextGlitchAt = t + 1.5 + Math.random() * 3.5;
  }
}

function animate(ts) {
  requestAnimationFrame(animate);
  const t  = ts * 0.001;
  const dt = t - state.lastTime;
  state.lastTime = t;
  state.time = t;

  scheduleGlitch(t);
  state.glitch += (glitchTarget - state.glitch) * 0.08;

  if (!LOW_END && renderer && typeof THREE !== 'undefined') {
    /* update particles */
    if (particleMesh) {
      const pos = particleMesh.geometry.attributes.position;
      const vel = particleMesh.geometry._vel;
      for (let i = 0; i < pos.count; i++) {
        pos.array[i*3]   += vel[i*3];
        pos.array[i*3+1] += vel[i*3+1];
        if (pos.array[i*3]   >  1) pos.array[i*3]   = -1;
        if (pos.array[i*3]   < -1) pos.array[i*3]   =  1;
        if (pos.array[i*3+1] >  1) pos.array[i*3+1] = -1;
        if (pos.array[i*3+1] < -1) pos.array[i*3+1] =  1;
      }
      pos.needsUpdate = true;
      particleUniforms.uTime.value    = t;
      particleUniforms.uMouse.value.set(state.mouse.x, state.mouse.y);
    }

    /* update bg */
    if (bgUniforms) {
      bgUniforms.uTime.value   = t;
      bgUniforms.uScroll.value = state.scroll;
      bgUniforms.uMouse.value.set(state.mouse.x, state.mouse.y);
    }

    /* pass 1 → render target */
    renderer.setRenderTarget(renderTarget);
    renderer.render(sceneMain, cameraMain);

    /* pass 2 → screen */
    renderer.setRenderTarget(null);
    if (quadUniforms) {
      quadUniforms.uTime.value   = t;
      quadUniforms.uGlitch.value = state.glitch;
      quadUniforms.uScroll.value = state.scroll;
      quadUniforms.uMouse.value.set(state.mouse.x, state.mouse.y);
    }
    renderer.render(quadScene, quadCamera);
  }

  updateParallax();
}

/* ═══════════════════════════════════════════════════════════════
   BOOT
═══════════════════════════════════════════════════════════════ */
async function boot() {
  setProgress(10);
  initCursor();
  setProgress(20);
  if (!LOW_END) initThree();
  setProgress(40);
  populateParallaxLayers();
  setProgress(60);
  await loadProjects();
  setProgress(85);
  initEvents();
  setProgress(100);
  if (!LOW_END && renderer) requestAnimationFrame(animate);
  setTimeout(hideLoader, 350);
}

document.addEventListener('DOMContentLoaded', boot);
