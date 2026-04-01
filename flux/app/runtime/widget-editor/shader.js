// ── shader.js — WebGL shader component: presets + animation loop management ───

let _ctx = null;
export function setContext(ctx) { _ctx = ctx; }

// ── Shader Presets ────────────────────────────────────────────────────────────

export const SHADER_PRESETS = {
    plasma: {
        label: 'Plasma',
        glsl: `precision mediump float;
uniform float u_time;
uniform vec2 u_resolution;
void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    float v = sin(uv.x * 10.0 + u_time) + sin(uv.y * 10.0 + u_time)
            + sin((uv.x + uv.y) * 10.0 + u_time * 0.7)
            + sin(length(uv - 0.5) * 20.0 - u_time * 1.5);
    vec3 col = vec3(sin(v * 1.3), sin(v * 1.3 + 2.094), sin(v * 1.3 + 4.189)) * 0.5 + 0.5;
    gl_FragColor = vec4(col, 1.0);
}`,
    },
    starfield: {
        label: 'Starfield',
        glsl: `precision mediump float;
uniform float u_time;
uniform vec2 u_resolution;
float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    vec3 col = vec3(0.0);
    for (float i = 0.0; i < 6.0; i++) {
        vec2 seed = floor(uv * (8.0 + i * 4.0) + vec2(0.0, u_time * (0.3 + i * 0.15)));
        float r = rand(seed + i);
        float b = step(0.975, r) * (0.4 + 0.6 * sin(u_time * 2.0 + r * 6.28));
        col += vec3(b * 0.7, b * 0.85, b);
    }
    gl_FragColor = vec4(col, 1.0);
}`,
    },
    gradient_wave: {
        label: 'Gradient Wave',
        glsl: `precision mediump float;
uniform float u_time;
uniform vec2 u_resolution;
void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    float wave = sin(uv.x * 6.28 + u_time * 1.5) * 0.12 + sin(uv.x * 12.0 - u_time) * 0.06;
    float t = uv.y + wave;
    vec3 a = vec3(0.0, 0.75, 1.0);
    vec3 b = vec3(0.02, 0.05, 0.18);
    gl_FragColor = vec4(mix(b, a, clamp(t, 0.0, 1.0)), 1.0);
}`,
    },
    aurora: {
        label: 'Aurora',
        glsl: `precision mediump float;
uniform float u_time;
uniform vec2 u_resolution;
void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    float y = uv.y;
    float band = exp(-pow((y - 0.6 + sin(uv.x * 3.0 + u_time * 0.4) * 0.15) * 5.0, 2.0));
    vec3 c1 = vec3(0.0, 0.9, 0.6) * band;
    float band2 = exp(-pow((y - 0.45 + sin(uv.x * 5.0 - u_time * 0.3) * 0.1) * 6.0, 2.0));
    vec3 c2 = vec3(0.2, 0.4, 1.0) * band2;
    vec3 bg = vec3(0.01, 0.01, 0.05);
    gl_FragColor = vec4(bg + c1 * 0.8 + c2 * 0.6, 1.0);
}`,
    },
    neon_grid: {
        label: 'Neon Grid',
        glsl: `precision mediump float;
uniform float u_time;
uniform vec2 u_resolution;
void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    float speed = u_time * 0.3;
    vec2 grid = fract(uv * 8.0 + vec2(0.0, speed));
    float lines = step(0.93, max(grid.x, grid.y));
    vec3 col = lines * vec3(0.0, 0.85, 1.0);
    float glow = lines * 0.5;
    col += glow * vec3(0.0, 0.4, 0.6);
    gl_FragColor = vec4(col, 1.0);
}`,
    },
    matrix_rain: {
        label: 'Matrix Rain',
        glsl: `precision mediump float;
uniform float u_time;
uniform vec2 u_resolution;
float rand(vec2 c) { return fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    float cols = 20.0;
    float col = floor(uv.x * cols);
    float speed = 0.5 + rand(vec2(col, 0.0)) * 1.5;
    float offset = rand(vec2(col, 1.0)) * 10.0;
    float row = fract(uv.y + u_time * speed + offset);
    float head = step(0.97, 1.0 - row);
    float tail = exp(-row * 4.0) * (1.0 - head);
    float brightness = head + tail * 0.5;
    float flicker = step(0.5, rand(vec2(col, floor(u_time * 8.0))));
    gl_FragColor = vec4(0.0, brightness * (0.8 + 0.2 * flicker), brightness * 0.3 * (0.8 + 0.2 * flicker), 1.0);
}`,
    },
};

export const SHADER_PRESET_KEYS = Object.keys(SHADER_PRESETS);

// ── Vertex shader (same for all presets) ─────────────────────────────────────

const VERTEX_SHADER = `
attribute vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`;

// ── Animation loop management ─────────────────────────────────────────────────

const _loops = new Map(); // canvasEl → { gl, program, uTime, uRes, rafId, startTime }

export function startShaderLoop(canvasEl, fragmentGlsl) {
    stopShaderLoop(canvasEl);

    const gl = canvasEl.getContext('webgl') || canvasEl.getContext('experimental-webgl');
    if (!gl) return;

    const vs = _compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = _compile(gl, gl.FRAGMENT_SHADER, fragmentGlsl);
    if (!vs || !fs) return;

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;

    gl.useProgram(program);

    // Full-screen quad
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(program, 'u_time');
    const uRes  = gl.getUniformLocation(program, 'u_resolution');
    const startTime = performance.now();

    function frame() {
        const w = canvasEl.width, h = canvasEl.height;
        gl.viewport(0, 0, w, h);
        gl.uniform1f(uTime, (performance.now() - startTime) / 1000.0);
        gl.uniform2f(uRes, w, h);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        state.rafId = requestAnimationFrame(frame);
    }

    const state = { gl, program, uTime, uRes, startTime, rafId: requestAnimationFrame(frame) };
    _loops.set(canvasEl, state);
}

export function stopShaderLoop(canvasEl) {
    const state = _loops.get(canvasEl);
    if (state) {
        cancelAnimationFrame(state.rafId);
        _loops.delete(canvasEl);
    }
}

export function stopAllShaderLoops() {
    for (const [canvas] of _loops) stopShaderLoop(canvas);
}

function _compile(gl, type, src) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.warn('[shader] compile error:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

/**
 * Returns the GLSL to use for a component — either the preset or the custom code.
 */
export function resolveShaderGlsl(comp) {
    if (comp.props.preset === 'custom') return comp.props.fragmentShader || '';
    return (SHADER_PRESETS[comp.props.preset] || SHADER_PRESETS.plasma).glsl;
}
