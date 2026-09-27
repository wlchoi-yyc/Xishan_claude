// 後期處理：柔光（bloom）、山水調色、暗角、宣紙紋理
// 場景先畫到浮點畫布（線性色彩），最後一步才做色調映射與 sRGB 轉換
import * as THREE from '../lib/three.module.js';

// 霧：原本的霧在色調映射「之後」才混合，所以同一個霧值在後期處理下（線性空間混合）會顯得濃得多，
// 令遠山發白。這裏在畫到浮點畫布時（沒有 TONE_MAPPING）把霧的曲線壓低，保持遠景清晰、只在很遠處溶入天色。
THREE.ShaderChunk.fog_fragment = THREE.ShaderChunk.fog_fragment.replace(
  'gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );',
  `#ifndef TONE_MAPPING
    fogFactor = pow( fogFactor, 1.8 );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );`);

const FS_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export function createPost(renderer, { lowEnd = false } = {}) {
  const size = new THREE.Vector2();
  const rtOpts = { type: THREE.HalfFloatType, depthBuffer: true, samples: lowEnd ? 0 : 4 };
  const sceneRT = new THREE.WebGLRenderTarget(1, 1, rtOpts);
  const smallOpts = { type: THREE.HalfFloatType, depthBuffer: false };
  const bloomA = new THREE.WebGLRenderTarget(1, 1, smallOpts);
  const bloomB = new THREE.WebGLRenderTarget(1, 1, smallOpts);

  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);

  // 1. 取出亮部（縮細）
  const brightMat = new THREE.ShaderMaterial({
    uniforms: { tex: { value: null }, threshold: { value: 1.5 } },
    vertexShader: FS_VERT,
    fragmentShader: `uniform sampler2D tex; uniform float threshold; varying vec2 vUv;
      void main(){ vec3 c = texture2D(tex, vUv).rgb; float l = max(max(c.r, c.g), c.b);
        float k = smoothstep(threshold, threshold + 0.6, l); gl_FragColor = vec4(c * k, 1.0); }`,
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  // 2. 高斯模糊（橫、直各一次）
  const blurMat = new THREE.ShaderMaterial({
    uniforms: { tex: { value: null }, dir: { value: new THREE.Vector2() } },
    vertexShader: FS_VERT,
    fragmentShader: `uniform sampler2D tex; uniform vec2 dir; varying vec2 vUv;
      void main(){
        vec3 c = texture2D(tex, vUv).rgb * 0.2270270;
        c += texture2D(tex, vUv + dir * 1.3846154).rgb * 0.3162162;
        c += texture2D(tex, vUv - dir * 1.3846154).rgb * 0.3162162;
        c += texture2D(tex, vUv + dir * 3.2307692).rgb * 0.0702703;
        c += texture2D(tex, vUv - dir * 3.2307692).rgb * 0.0702703;
        gl_FragColor = vec4(c, 1.0); }`,
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  // 3. 合成：柔光 → 色調映射 → 調色 → 暗角 → 紙紋 → sRGB
  const finalMat = new THREE.ShaderMaterial({
    uniforms: {
      tex: { value: sceneRT.texture }, bloom: { value: bloomA.texture },
      bloomStrength: { value: lowEnd ? 0 : 0.35 },
      saturation: { value: 1.0 },          // 略為收斂飽和度，較似設色山水
      contrast: { value: 0.18 },           // 輕微 S 曲線，去掉灰濛
      warmth: { value: new THREE.Vector3(1.015, 1.0, 0.98) },
      paper: { value: new THREE.Color('#efe4cc') }, paperMix: { value: 0.03 },
      vignette: { value: 0.28 }, grain: { value: 0.016 },
      resolution: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader: FS_VERT,
    fragmentShader: `
      uniform sampler2D tex; uniform sampler2D bloom; uniform float bloomStrength;
      uniform float saturation; uniform float contrast; uniform vec3 warmth; uniform vec3 paper; uniform float paperMix;
      uniform float vignette; uniform float grain; uniform vec2 resolution;
      varying vec2 vUv;
      float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1,0)), u.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y); }
      void main(){
        vec3 c = texture2D(tex, vUv).rgb + texture2D(bloom, vUv).rgb * bloomStrength;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        c = gl_FragColor.rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, saturation);
        c *= warmth;
        c = mix(c, c * c * (3.0 - 2.0 * c), contrast);
        // 宣紙：亮部帶一點米黃，並有不規則纖維
        vec2 px = vUv * resolution;
        float fiber = vnoise(px * vec2(0.012, 0.05)) * 0.6 + vnoise(px * 0.09) * 0.4;
        c = mix(c, c * paper, paperMix * (0.6 + fiber * 0.8));
        c += (hash(floor(px)) - 0.5) * grain * (0.15 + l);
        // 暗角
        vec2 d = vUv - 0.5; d.x *= resolution.x / resolution.y;
        c *= 1.0 - vignette * smoothstep(0.35, 1.05, length(d));
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
        #include <colorspace_fragment>
      }`,
    depthTest: false, depthWrite: false,
  });

  function setSize(w, h, pr) {
    size.set(Math.floor(w * pr), Math.floor(h * pr));
    sceneRT.setSize(size.x, size.y);
    const bw = Math.max(1, Math.floor(size.x / 4)), bh = Math.max(1, Math.floor(size.y / 4));
    bloomA.setSize(bw, bh); bloomB.setSize(bw, bh);
    finalMat.uniforms.resolution.value.set(size.x, size.y);
  }

  function pass(mat, target) {
    quad.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(quadScene, quadCam);
  }

  const post = {
    enabled: true,
    uniforms: finalMat.uniforms,
    setSize,
    render(scene, camera) {
      if (!post.enabled) { renderer.setRenderTarget(null); renderer.render(scene, camera); return; }
      renderer.setRenderTarget(sceneRT);
      renderer.render(scene, camera);
      if (finalMat.uniforms.bloomStrength.value > 0) {
        brightMat.uniforms.tex.value = sceneRT.texture; pass(brightMat, bloomA);
        const bw = bloomA.width, bh = bloomA.height;
        for (let i = 0; i < 2; i++) {
          const r = 1 + i * 1.5;
          blurMat.uniforms.tex.value = bloomA.texture; blurMat.uniforms.dir.value.set(r / bw, 0); pass(blurMat, bloomB);
          blurMat.uniforms.tex.value = bloomB.texture; blurMat.uniforms.dir.value.set(0, r / bh); pass(blurMat, bloomA);
        }
      }
      pass(finalMat, null);
    },
  };
  return post;
}
