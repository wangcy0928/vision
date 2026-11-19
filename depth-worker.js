// Vision — depth worker.
// Runs Depth Anything V2 Small (single-camera depth estimation) off the main thread so the camera
// preview, beeps and speech stay smooth. The model gives RELATIVE inverse depth (bigger = closer,
// no metres), so everything here is a ratio against the nearest thing in the frame.
//
// in : { type:"init" }                                  -> { type:"ready", device } | { type:"error", msg }
//      { type:"frame", buf, w, h }  (RGBA, w and h are multiples of 14)
// out: { type:"depth", cols:[left, ahead, right], ms, thumb, tw, th }   (cols are closeness 0-1)
import { pipeline, RawImage, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.min.js";

const MODEL = "onnx-community/depth-anything-v2-small";
// The part of the view that counts as "where you are about to walk"
const BAND_TOP = 0.30, BAND_BOTTOM = 0.65;                 // rows: roughly knee to head height ahead
const COLS = [[0.10, 0.37], [0.37, 0.63], [0.63, 0.90]];   // left, ahead, right

let pipe = null, proc = null;
// iPhone Safari pages are not "cross-origin isolated", so multi-threaded WASM can't run there.
// Ask for one thread up front instead of letting the runtime try and fail.
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;

const fails = [];
async function init() {
  // GPU first (fast, downloaded once); then CPU (slower). Every failure is reported back so the
  // phone can show WHY obstacle mode didn't start.
  const tries = [];
  let f16 = false;
  if (self.navigator && navigator.gpu) {
    try { const a = await navigator.gpu.requestAdapter(); f16 = !!(a && a.features.has("shader-f16")); if (!a) fails.push("gpu: no adapter"); }
    catch (e) { fails.push("gpu: " + e.message); }
    if (f16) tries.push({ device: "webgpu", dtype: "fp16" });
    tries.push({ device: "webgpu", dtype: "fp32" });
  } else fails.push("gpu: not in worker");
  tries.push({ device: "wasm", dtype: "q8" });
  tries.push({ device: "wasm", dtype: "fp32" });
  let lastErr = null;
  for (const t of tries) {
    try {
      pipe = await pipeline("depth-estimation", MODEL, t);
      proc = pipe.processor.image_processor || pipe.processor;
      proc.do_resize = false;              // frames arrive already at model size
      // one warm-up run so a broken GPU path fails here and not on the first real frame
      await run(new Uint8ClampedArray(56 * 56 * 4).fill(128), 56, 56);
      postMessage({ type: "ready", device: t.device + (t.dtype === "fp16" ? "" : "-" + t.dtype), fails });
      return;
    } catch (e) { lastErr = e; pipe = null; fails.push(`${t.device}/${t.dtype}: ${String((e && e.message) || e).slice(0, 80)}`); }
  }
  postMessage({ type: "error", msg: fails.join(" | ").slice(0, 400) });
}

function halfToFloat(h) {
  const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
  if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * Math.pow(2, e - 15) * (1 + f / 1024);
}

async function run(rgba, w, h) {
  const img = new RawImage(rgba, w, h, 4).rgb();
  const inputs = await proc(img);
  const { predicted_depth } = await pipe.model(inputs);
  const dims = predicted_depth.dims, H = dims[dims.length - 2], W = dims[dims.length - 1];
  let d = predicted_depth.data;
  if (d instanceof Uint16Array) { const f = new Float32Array(d.length); for (let i = 0; i < d.length; i++) f[i] = halfToFloat(d[i]); d = f; }
  return { d, W, H };
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  arr.sort((a, b) => a - b);
  return arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
}

function summarize({ d, W, H }) {
  // reference = the nearest things in view (95th percentile), usually the floor at your feet
  const sample = [];
  const stride = Math.max(1, Math.floor(d.length / 4000));
  for (let i = 0; i < d.length; i += stride) sample.push(d[i]);
  const ref = Math.max(1e-6, percentile(sample, 0.95));
  const y0 = Math.floor(H * BAND_TOP), y1 = Math.ceil(H * BAND_BOTTOM);
  const cols = COLS.map(([a, b]) => {
    const x0 = Math.floor(W * a), x1 = Math.ceil(W * b), v = [];
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) v.push(d[y * W + x]);
    return Math.max(0, Math.min(1, percentile(v, 0.75) / ref));   // 1 = as near as the nearest thing in view
  });
  // small picture of the depth map for the on-screen preview
  const tw = 32, th = Math.max(1, Math.round(32 * H / W)), thumb = new Uint8Array(tw * th);
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const v = d[Math.min(H - 1, Math.floor((y + .5) * H / th)) * W + Math.min(W - 1, Math.floor((x + .5) * W / tw))];
    thumb[y * tw + x] = Math.max(0, Math.min(255, Math.round(v / ref * 255)));
  }
  return { cols, thumb, tw, th };
}

onmessage = async (e) => {
  const m = e.data;
  if (m.type === "init") return init();
  if (m.type === "frame") {
    if (!pipe) return;
    const t0 = performance.now();
    try {
      const out = summarize(await run(new Uint8ClampedArray(m.buf), m.w, m.h));
      postMessage({ type: "depth", ...out, ms: performance.now() - t0 }, [out.thumb.buffer]);
    } catch (err) {
      postMessage({ type: "error", msg: String(err.message || err).slice(0, 200) });
    }
  }
};
