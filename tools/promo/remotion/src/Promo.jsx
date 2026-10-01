import { useEffect, useState } from 'react';
import {
  AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, continueRender, delayRender, interpolate, random, spring, staticFile,
  useCurrentFrame, useVideoConfig, Easing,
} from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';
import { wipe } from '@remotion/transitions/wipe';
import { SHOTS, TOTAL, starts, voTrack } from './data.js';

const GOLD = '#e8b75a';
const INK = '#f4e7c6';
const SERIF = 'PromoSerif, "Songti SC", serif';
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };

// ---------------------------------------------------------------- 转场
// 闪白：前一段在闪光峰值处切到后一段
const Flash = ({ children, presentationDirection, presentationProgress: p, passedProps }) => {
  const entering = presentationDirection === 'entering';
  const flash = entering ? interpolate(p, [0.5, 1], [1, 0], clamp) : interpolate(p, [0, 0.5], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ opacity: entering ? (p >= 0.5 ? 1 : 0) : 1 }}>
      {children}
      <AbsoluteFill style={{ background: passedProps.color, opacity: flash * passedProps.strength }} />
    </AbsoluteFill>
  );
};
// 经黑场淡出淡入
const Dip = ({ children, presentationDirection, presentationProgress: p }) => {
  const o = presentationDirection === 'entering' ? interpolate(p, [0.5, 1], [0, 1], clamp) : interpolate(p, [0, 0.5], [1, 0], clamp);
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>;
};

const makeTransition = (type) => {
  switch (type) {
    case 'flash': return { component: Flash, props: { color: '#fff6e0', strength: 0.95 } };
    case 'dip': return { component: Dip, props: {} };
    case 'wipe': return wipe({ direction: 'from-left' });
    case 'slide': return slide({ direction: 'from-right' });
    default: return fade();
  }
};

// ---------------------------------------------------------------- 通用层
// 旁白期间压低其他声音（f 为总时间线帧号）
const voDuck = (f, level) => {
  let duck = 1;
  for (const v of voTrack) duck = Math.min(duck, interpolate(f, [v.from - 8, v.from, v.from + v.len, v.from + v.len + 15], [1, level, level, 1], clamp));
  return duck;
};
const Vignette = ({ strength = 0.55 }) => (
  <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 46%, rgba(0,0,0,0) 48%, rgba(0,0,0,${strength}) 100%)` }} />
);

const Letterbox = () => (
  <>
    <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 82, background: '#000' }} />
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 82, background: '#000' }} />
  </>
);

const Grain = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ opacity: 0.07, mixBlendMode: 'overlay', pointerEvents: 'none' }}>
      <svg width="100%" height="100%">
        <filter id="g"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={f % 12} /></filter>
        <rect width="100%" height="100%" filter="url(#g)" />
      </svg>
    </AbsoluteFill>
  );
};

// 逐字弹入的标题
const SpringText = ({ text, delay, size, stagger = 3, color = INK, spacing = '0.14em' }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{ fontSize: size, letterSpacing: spacing, lineHeight: 1.15, color, whiteSpace: 'nowrap' }}>
      {[...text].map((ch, i) => {
        const k = spring({ frame: f - delay - i * stagger, fps, config: { damping: 16, stiffness: 110, mass: 0.8 } });
        return (
          <span key={i} style={{ display: 'inline-block', opacity: Math.min(1, k * 1.4), filter: `blur(${(1 - Math.min(1, k)) * 10}px)`, transform: `translateY(${(1 - k) * 26}px)` }}>
            {ch === ' ' ? ' ' : ch}
          </span>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------- 字幕（左下角金线 + 标题 + 副标题）
const Caption = ({ s }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const out = s.out ? s.out[1] : 0;
  const exit = interpolate(f, [s.dur - out - 16, s.dur - out - 2], [1, 0], clamp);
  const bar = spring({ frame: f - 10, fps, config: { damping: 200 } });
  const subK = interpolate(f, [30, 46], [0, 1], clamp);
  const pos = s.hud ? { top: 150 } : { bottom: 150 };
  return (
    <div style={{ position: 'absolute', left: 120, ...pos, opacity: exit, fontFamily: SERIF, textShadow: '0 2px 18px rgba(0,0,0,.85), 0 0 2px rgba(0,0,0,.9)' }}>
      <div style={{ width: bar * 110, height: 3, background: `linear-gradient(90deg, ${GOLD}, rgba(232,183,90,0))`, marginBottom: 20 }} />
      <SpringText text={s.cap[0]} delay={14} size={74} />
      <div style={{ marginTop: 14, fontSize: 26, color: '#dccca4', opacity: subK, letterSpacing: `${interpolate(subK, [0, 1], [0.5, 0.24])}em`, whiteSpace: 'nowrap' }}>
        {s.cap[1]}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- 游戏镜头
const Clip = ({ s, i }) => {
  const f = useCurrentFrame();
  let z = interpolate(f, [0, s.dur], s.zoom || [1, 1], clamp);
  if (s.punch != null && f >= s.punch) z += 0.035 * Math.exp(-(f - s.punch) / 5); // 命中瞬间的镜头冲击
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <AbsoluteFill style={{ transform: `scale(${z})`, filter: 'contrast(1.06) saturate(1.1)' }}>
        <OffthreadVideo src={staticFile(`rec/clips/${s.name}.mp4`)} muted />
      </AbsoluteFill>
      <Vignette strength={s.hud ? 0.35 : 0.55} />
      {s.bars && <Letterbox />}
      <Audio src={staticFile(`rec/sfx/${s.name}.wav`)} volume={(f) => (s.sfx ?? 0.85) * voDuck(starts[i] + f, 0.55)} />
      {s.cap && <Caption s={s} />}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- 标题 / 片尾
const Embers = ({ n = 46, seed = 'e' }) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {Array.from({ length: n }, (_, i) => {
        const x = random(`${seed}x${i}`) * 1920, sp = 0.6 + random(`${seed}s${i}`) * 1.6, r = 1.5 + random(`${seed}r${i}`) * 3.5;
        const y = 1120 - ((f * sp + random(`${seed}y${i}`) * 1200) % 1240);
        const dx = Math.sin((f + i * 37) / (28 + i % 9)) * 18;
        const tw = 0.35 + 0.65 * Math.abs(Math.sin((f + i * 13) / 17));
        return <div key={i} style={{ position: 'absolute', left: x + dx, top: y, width: r, height: r, borderRadius: '50%', background: '#ffd98a', boxShadow: `0 0 ${r * 4}px ${r}px rgba(255,190,90,.55)`, opacity: tw * 0.8 }} />;
      })}
    </AbsoluteFill>
  );
};

const Logo = ({ delay = 12, size = 200 }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sheen = interpolate(f, [delay + 30, delay + 80], [-60, 160], clamp);
  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: size * 0.18 }}>
      {['荣', '耀'].map((ch, i) => {
        const k = spring({ frame: f - delay - i * 10, fps, config: { damping: 14, stiffness: 90 } });
        // 外层负责模糊与光晕，内层只做渐变文字：filter 与 background-clip:text 放在同一元素上会整块涂满
        return (
          <span key={ch} style={{
            display: 'inline-block', opacity: Math.min(1, k * 1.3), transform: `scale(${1.25 - 0.25 * k})`,
            filter: `blur(${(1 - Math.min(1, k)) * 16}px) drop-shadow(0 0 30px rgba(232,183,90,.45))`,
          }}>
            <span style={{
              display: 'inline-block', fontSize: size, lineHeight: 1.1,
              backgroundImage: `linear-gradient(100deg, #c89a48 ${sheen - 30}%, #fff4d2 ${sheen}%, #c89a48 ${sheen + 30}%)`,
              WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', WebkitTextFillColor: 'transparent',
            }}>{ch}</span>
          </span>
        );
      })}
    </div>
  );
};

const Card = ({ bg, children, dur, fadeOut = 0 }) => {
  const f = useCurrentFrame();
  const z = interpolate(f, [0, dur], [1.12, 1.02]);
  const o = interpolate(f, [0, 14], [0, 1], clamp) * (fadeOut ? interpolate(f, [dur - fadeOut, dur], [1, 0], clamp) : 1);
  return (
    <AbsoluteFill style={{ background: '#000', opacity: o }}>
      <AbsoluteFill style={{ transform: `scale(${z})` }}>
        <Img src={staticFile(bg)} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'brightness(.55) saturate(1.05)' }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(0,0,0,.45), rgba(0,0,0,0) 38%, rgba(0,0,0,.6))' }} />
      <Vignette strength={0.8} />
      <Embers />
      <AbsoluteFill style={{ fontFamily: SERIF, color: INK, alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};

const GoldLine = ({ delay, width = 560 }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const k = spring({ frame: f - delay, fps, config: { damping: 200 } });
  return <div style={{ margin: '22px auto 0', height: 2, width: width * k, background: `linear-gradient(90deg, rgba(232,183,90,0), ${GOLD}, rgba(232,183,90,0))` }} />;
};

const Fade = ({ from, children, style }) => {
  const f = useCurrentFrame();
  const k = interpolate(f, [from, from + 18], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  return <div style={{ opacity: k, transform: `translateY(${(1 - k) * 14}px)`, ...style }}>{children}</div>;
};

const EnWord = ({ from }) => {
  const f = useCurrentFrame();
  const k = interpolate(f, [from, from + 40], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  return <div style={{ marginTop: 20, fontSize: 28, fontFamily: 'Georgia, serif', color: '#d9c79c', opacity: k, letterSpacing: `${1.5 - 0.6 * k}em`, paddingLeft: `${1.5 - 0.6 * k}em` }}>GLORY</div>;
};

const TitleCard = ({ s }) => (
  <Card bg="img/ui-login-background.jpg" dur={s.dur}>
    <div style={{ marginTop: -60 }}>
      <Logo delay={10} size={210} />
      <GoldLine delay={34} />
      <EnWord from={38} />
      <Fade from={58} style={{ marginTop: 34, fontSize: 32, letterSpacing: '0.3em', color: '#eadbb6' }}>《全职高手》同人 · 网页动作网游</Fade>
    </div>
  </Card>
);

const EndCard = ({ s }) => (
  <Card bg="img/env-league-arena.jpg" dur={s.dur} fadeOut={28}>
    <div style={{ marginTop: -40 }}>
      <Logo delay={8} size={180} />
      <GoldLine delay={28} />
      <EnWord from={30} />
      <Fade from={50} style={{ marginTop: 40, fontSize: 38, letterSpacing: '0.24em', color: '#f3e3bb' }}>打开网页即可开打</Fade>
      <Fade from={64} style={{ marginTop: 18, fontSize: 24, letterSpacing: '0.3em', color: '#cdbb90' }}>单机 · 浏览器直连联机 · Chrome / Edge</Fade>
      <Fade from={78} style={{ marginTop: 14, fontSize: 20, letterSpacing: '0.3em', color: '#a99b78' }}>《全职高手》同人 · 非商业作品</Fade>
    </div>
  </Card>
);

const ShotView = ({ s, i }) => (s.type === 'title' ? <TitleCard s={s} /> : s.type === 'end' ? <EndCard s={s} /> : <Clip s={s} i={i} />);

// ---------------------------------------------------------------- 旁白字幕与配乐
const shotAt = (f) => { let k = 0; starts.forEach((st, i) => { if (f >= st) k = i; }); return SHOTS[k]; };

const Subtitles = () => {
  const f = useCurrentFrame();
  const v = voTrack.find((x) => f >= x.from && f < x.from + x.len);
  if (!v) return null;
  const o = interpolate(f, [v.from, v.from + 6, v.from + v.len - 8, v.from + v.len], [0, 1, 1, 0], clamp);
  const s = shotAt(f);
  const pos = s.hud ? { bottom: 250 } : { bottom: 24 };
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, ...pos, textAlign: 'center', opacity: o, fontFamily: SERIF, fontSize: 32, letterSpacing: '0.12em', color: '#efe2c0', textShadow: '0 2px 10px rgba(0,0,0,.95)' }}>
      {v.text}
    </div>
  );
};

const musicVolume = (f) => 0.6 * voDuck(f, 0.42) * interpolate(f, [0, 20, TOTAL - 70, TOTAL - 5], [0, 1, 1, 0], clamp);

// ---------------------------------------------------------------- 合成
export const Promo = () => {
  const [handle] = useState(() => delayRender('加载字体'));
  useEffect(() => {
    const ff = new FontFace('PromoSerif', `url(${staticFile('fonts/promo-serif.woff2')})`);
    ff.load().then(() => { document.fonts.add(ff); continueRender(handle); }).catch((e) => { console.error(e); continueRender(handle); });
  }, [handle]);
  const items = [];
  SHOTS.forEach((s, i) => {
    items.push(<TransitionSeries.Sequence key={`s${i}`} durationInFrames={s.dur}><ShotView s={s} i={i} /></TransitionSeries.Sequence>);
    if (s.out) items.push(<TransitionSeries.Transition key={`t${i}`} presentation={makeTransition(s.out[0])} timing={linearTiming({ durationInFrames: s.out[1] })} />);
  });
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <TransitionSeries>{items}</TransitionSeries>
      <Audio src={staticFile('rec/music.wav')} volume={musicVolume} />
      {voTrack.map((v) => (
        <Sequence key={v.id} from={v.from} durationInFrames={v.len + 12}>
          <Audio src={staticFile(`vo/${v.id}.wav`)} volume={1} />
        </Sequence>
      ))}
      <Subtitles />
      <Grain />
    </AbsoluteFill>
  );
};
