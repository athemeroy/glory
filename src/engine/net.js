// 联机入口：浏览器直连（实现见 p2p.js）。游戏代码只通过这个 net 对象收发消息。
import { P2PNet } from './p2p.js';

export const net = new P2PNet();
