import { Composition } from 'remotion';
import { Promo } from './Promo.jsx';
import { FPS, W, H, TOTAL } from './data.js';

export const RemotionRoot = () => (
  <Composition id="GloryPromo" component={Promo} durationInFrames={TOTAL} fps={FPS} width={W} height={H} />
);
