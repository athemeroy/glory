// 后期管线：主画面 → 第一人称手臂层 → 泛光 → 色调分级（暗角/受击色差/饱和度） → 输出（色调映射+sRGB） → SMAA
import * as THREE from 'three';
import { EffectComposer } from '../../vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../../vendor/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from '../../vendor/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from '../../vendor/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../../vendor/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from '../../vendor/jsm/postprocessing/SMAAPass.js';
import { FXAAShader } from '../../vendor/jsm/shaders/FXAAShader.js';

// 第一人称手臂层：清深度后叠加，不画背景
class OverlayPass extends RenderPass {
  constructor(scene, camera, enabledFn) { super(scene, camera); this.clear = false; this.clearDepth = true; this.enabledFn = enabledFn; }
  render(renderer, writeBuffer, readBuffer, dt, mask) {
    if (!this.enabledFn()) return;
    const bg = this.scene.background; this.scene.background = null;
    const sm = renderer.shadowMap.autoUpdate; renderer.shadowMap.autoUpdate = false;
    super.render(renderer, writeBuffer, readBuffer, dt, mask);
    renderer.shadowMap.autoUpdate = sm;
    this.scene.background = bg;
  }
}

// 泛光前清洗：NaN/Inf 置零并钳制亮度，避免个别坏像素经泛光扩散成整屏黑
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv);
      if (!(c.r == c.r) || !(c.g == c.g) || !(c.b == c.b) || c.r > 6.0e4 || c.g > 6.0e4 || c.b > 6.0e4) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = vec4(min(c.rgb, vec3(24.0)), 1.0); }`,
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uVignette: { value: 0.32 }, uHurt: { value: 0 }, uAberr: { value: 0 },
    uSat: { value: 1.08 }, uContrast: { value: 1.05 }, uTint: { value: new THREE.Color(1.0, 0.99, 0.97) }, uLift: { value: new THREE.Color(0.012, 0.014, 0.022) },
    uDesat: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uVignette, uHurt, uAberr, uSat, uContrast, uDesat; uniform vec3 uTint, uLift;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec3 col;
      if (uAberr > 0.0005) {
        vec2 off = c * uAberr * (0.6 + r2 * 2.0);
        col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      } else col = texture2D(tDiffuse, vUv).rgb;
      // 线性空间分级（本 pass 位于 OutputPass 之前）
      col = col * uTint + uLift * (1.0 - col);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat * (1.0 - uDesat));
      col = (col - 0.18) * uContrast + 0.18;
      col = max(col, 0.0);
      // 暗角
      float v = smoothstep(0.85, 0.18, r2 * (1.0 + uVignette * 1.6));
      col *= mix(1.0, v, uVignette * 1.6);
      // 受击：边缘泛红
      col = mix(col, col * vec3(1.4, 0.35, 0.3) + vec3(0.08, 0.0, 0.0), uHurt * smoothstep(0.05, 0.5, r2));
      // 细微颗粒
      col += (hash(vUv * 1000.0 + uTime) - 0.5) * 0.012;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Post {
  constructor(renderer, scene, camera, vmCamera, fpEnabled, quality = 'high') {
    this.renderer = renderer;
    this.quality = quality;
    const size = renderer.getSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 0 }); // 抗锯齿交给 SMAA
    this.composer = new EffectComposer(renderer, rt);
    this.main = new RenderPass(scene, camera);
    this.overlay = new OverlayPass(scene, vmCamera, fpEnabled);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.42, 0.45, 1.3);
    this.grade = new ShaderPass(GradeShader);
    this.output = new OutputPass();
    this.composer.addPass(this.main);
    this.composer.addPass(this.overlay);
    this.composer.addPass(new ShaderPass(SanitizeShader));
    this.composer.addPass(this.bloom);
    this.bloomBase = this.bloom.strength; this.pulseAmt = 0;
    this.composer.addPass(this.grade);
    this.composer.addPass(this.output);
    this.setQuality(quality);
    this.hurt = 0; this.aberr = 0;
  }
  setQuality(quality) {
    this.quality = quality;
    if (quality === 'high' && !this.smaa) { this.smaa = new SMAAPass(); this.composer.addPass(this.smaa); }
    if (quality !== 'high' && !this.fxaa) { this.fxaa = new ShaderPass(FXAAShader); this.composer.addPass(this.fxaa); }
    if (this.smaa) this.smaa.enabled = quality === 'high';
    if (this.fxaa) this.fxaa.enabled = quality !== 'high';
  }
  setSize(w, h) {
    // 倍率仅在这里计算一次，并和画布一样取整；调用方只传 CSS 尺寸。
    const pr = this.renderer.getPixelRatio();
    const pw = Math.floor(w * pr), ph = Math.floor(h * pr);
    this.composer.setPixelRatio(1);
    this.composer.setSize(pw, ph);
    this.bloom.resolution.set(pw, ph);
    if (this.fxaa) this.fxaa.uniforms.resolution.value.set(1 / pw, 1 / ph);
  }
  pulse(a) { this.pulseAmt = Math.max(this.pulseAmt, a); }
  kick(hurt, aberr) { this.hurt = Math.max(this.hurt, hurt); this.aberr = Math.max(this.aberr, aberr); }
  render(dt) {
    this.hurt *= Math.exp(-dt * 5); this.aberr *= Math.exp(-dt * 8);
    this.pulseAmt *= Math.exp(-dt * 7); this.bloom.strength = this.bloomBase * (1 + this.pulseAmt * 2.5);
    const u = this.grade.uniforms;
    u.uTime.value = (u.uTime.value + dt) % 100;
    u.uHurt.value = this.hurt; u.uAberr.value = this.aberr;
    this.composer.render(dt);
  }
}
