import { randomInt, randomUUID } from './random.js';

export class DomainError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
export const fail = (code, message, status) => { throw new DomainError(code, message, status); };
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function text(v, field, max, empty = false) {
  if (typeof v !== 'string' || (!empty && !v.trim()) || [...v.trim()].length > max || /[\u0000-\u001f\u007f]/u.test(v))
    fail('INVALID_FIELD', `${field}须为${empty ? '不超过' : '1–'}${max}个可见字符。`);
  return v.trim();
}
function fields(v, allowed) {
  for (const key of Object.keys(v)) if (!allowed.includes(key)) fail('UNKNOWN_FIELD', `不支持的字段：${key}。`);
}
export const validateName = v => text(v, '昵称', 24);
export function validatePack(v) {
  if (!plain(v)) fail('INVALID_PACK', '游戏包须为 JSON 对象。');
  fields(v, ['id', 'version', 'title', 'description', 'rulesId', 'minPlayers', 'maxPlayers', 'handSize', 'cards']);
  const id = text(v.id, '游戏包编号', 48), version = text(v.version, '版本', 40);
  if (!/^[a-z0-9][a-z0-9-]{0,47}$/u.test(id)) fail('INVALID_PACK_ID', '游戏包编号只能含小写字母、数字、连字符。');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/u.test(version)) fail('INVALID_PACK_VERSION', '版本只能含字母、数字、点、下划线、连字符。');
  if (v.rulesId !== 'high-card-v1') fail('UNSUPPORTED_RULES', '本轮只支持 high-card-v1，不执行游戏包脚本。');
  if (!Number.isInteger(v.minPlayers) || !Number.isInteger(v.maxPlayers) || v.minPlayers < 2 || v.maxPlayers > 4 || v.maxPlayers < v.minPlayers)
    fail('INVALID_PLAYER_LIMIT', '人数须为2–4人，最大人数不能小于最小人数。');
  if (v.handSize !== 5) fail('INVALID_HAND_SIZE', '此规则固定每人5张、共5轮。');
  if (!Array.isArray(v.cards) || v.cards.length < v.maxPlayers * 5 || v.cards.length > 200) fail('INVALID_DECK', `牌组须有${v.maxPlayers * 5}–200张牌。`);
  const ids = new Set();
  const cards = v.cards.map(c => {
    if (!plain(c)) fail('INVALID_CARD', '每张卡须为对象。');
    fields(c, ['id', 'label', 'value', 'color']);
    const cid = text(c.id, '卡牌编号', 64);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(cid) || ids.has(cid)) fail('INVALID_CARD_ID', '卡牌编号须唯一且只含字母、数字、点、下划线、连字符。');
    ids.add(cid);
    if (!Number.isInteger(c.value) || c.value < 1 || c.value > 99) fail('INVALID_CARD_VALUE', '卡牌数字须为1–99整数。');
    if (c.color !== undefined && (typeof c.color !== 'string' || !/^#[a-fA-F0-9]{6}$/u.test(c.color))) fail('INVALID_CARD_COLOR', '卡牌颜色须为六位十六进制，例如 #e8a66b。');
    return { id: cid, label: text(c.label, '卡牌名称', 48), value: c.value, ...(c.color ? { color: c.color } : {}) };
  });
  return { id, version, title: text(v.title, '游戏名称', 48), description: text(v.description ?? '', '游戏说明', 500, true), rulesId: v.rulesId, minPlayers: v.minPlayers, maxPlayers: v.maxPlayers, handSize: 5, cards };
}
export function summarizePack(p) {
  const { cards, ...rest } = p;
  return { ...rest, rulesText: '每人5张牌，共5轮。按座位顺序公开出1张，数字最大者各得1分（并列都得分）。每轮起手顺移一位，5轮后总分最高者共同获胜。断线保留座位与回合，不自动代打。' };
}
const player = name => ({ id: randomUUID(), name: validateName(name), score: 0, hand: [] });
const clone = v => structuredClone(v);
const log = (r, s) => { r.log = [...r.log, s].slice(-40); };
export function newRoom(roomCode, pack, name) {
  const p = player(name);
  return { roomCode, version: 1, status: 'lobby', pack: clone(pack), hostId: p.id, players: [p], round: 0, currentPlayerId: null, table: [], lastRound: null, winners: [], log: [`${p.name}创建了房间。`], sessions: {}, receipts: [] };
}
export function joinRoom(room, name) {
  if (room.status !== 'lobby') fail('GAME_STARTED', '本局已开始，结束回大厅后可加入。', 409);
  if (room.players.length >= room.pack.maxPlayers) fail('ROOM_FULL', '房间已满。', 409);
  const p = player(name), next = clone(room);
  next.players.push(p); next.version++; log(next, `${p.name}加入了房间。`);
  return next;
}
export function performAction(room, playerId, action, random) {
  if (!plain(action)) fail('INVALID_ACTION', '操作须为对象。');
  fields(action, ['type', 'cardId', 'commandId', 'expectedVersion']);
  if (!room.players.some(p => p.id === playerId)) fail('NOT_SEATED', '请先加入房间。', 403);
  if (!['start', 'play', 'restart'].includes(action.type)) fail('INVALID_ACTION', '不支持此操作。');
  if (typeof action.commandId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/u.test(action.commandId)) fail('INVALID_COMMAND_ID', '操作编号无效。');
  if (!Number.isSafeInteger(action.expectedVersion) || action.expectedVersion < 1) fail('INVALID_VERSION', '缺少有效房间版本。');
  const fingerprint = JSON.stringify([action.type, action.cardId ?? null, action.expectedVersion]);
  const receipt = room.receipts.find(r => r.playerId === playerId && r.commandId === action.commandId);
  if (receipt) {
    if (receipt.fingerprint !== fingerprint) fail('COMMAND_ID_REUSED', '操作编号不能用于不同操作。', 409);
    return room;
  }
  if (room.version !== action.expectedVersion) fail('VERSION_CONFLICT', '房间已更新，已为你同步，请查看后重试。', 409);
  const n = clone(room);
  if (action.type === 'start') {
    if (room.hostId !== playerId) fail('HOST_ONLY', '只有房主能开始。', 403);
    if (room.status !== 'lobby') fail('INVALID_PHASE', '当前不能开始。', 409);
    if (room.players.length < room.pack.minPlayers) fail('NOT_ENOUGH_PLAYERS', `至少需要${room.pack.minPlayers}人。`, 409);
    const deck = clone(room.pack.cards);
    for (let i = deck.length - 1; i > 0; i--) {
      const x = random ? Math.floor(random() * (i + 1)) : randomInt(i + 1);
      if (!Number.isInteger(x) || x < 0 || x > i) throw new Error('Invalid injected randomness');
      [deck[i], deck[x]] = [deck[x], deck[i]];
    }
    for (const p of n.players) { p.score = 0; p.hand = deck.splice(0, 5); }
    Object.assign(n, { status: 'playing', round: 1, table: [], lastRound: null, winners: [], currentPlayerId: n.players[0].id });
    log(n, '游戏开始，第1轮由房主先出牌。');
  } else if (action.type === 'play') {
    if (room.status !== 'playing') fail('INVALID_PHASE', '当前不在出牌阶段。', 409);
    if (room.currentPlayerId !== playerId) fail('NOT_YOUR_TURN', '还没轮到你。', 409);
    const p = n.players.find(p => p.id === playerId), index = p.hand.findIndex(c => c.id === action.cardId);
    if (index < 0) fail('CARD_NOT_IN_HAND', '这张牌不在你的手中。', 403);
    const [card] = p.hand.splice(index, 1);
    n.table.push({ playerId, playerName: p.name, card });
    log(n, `${p.name}打出${card.label}（${card.value}）。`);
    if (n.table.length === n.players.length) {
      const high = Math.max(...n.table.map(t => t.card.value)), winners = n.table.filter(t => t.card.value === high);
      for (const t of winners) n.players.find(p => p.id === t.playerId).score++;
      n.lastRound = { round: n.round, winnerNames: winners.map(t => t.playerName), points: 1, plays: clone(n.table) };
      log(n, `第${n.round}轮：${n.lastRound.winnerNames.join('、')}各得1分。`);
      if (n.round === 5) {
        n.status = 'finished'; n.currentPlayerId = null;
        const best = Math.max(...n.players.map(p => p.score));
        n.winners = n.players.filter(p => p.score === best).map(p => p.name);
        log(n, `本局结束，${n.winners.join('、')}获胜。`);
      } else { n.round++; n.table = []; n.currentPlayerId = n.players[(n.round - 1) % n.players.length].id; }
    } else n.currentPlayerId = n.players[((n.round - 1) % n.players.length + n.table.length) % n.players.length].id;
  } else {
    if (room.hostId !== playerId) fail('HOST_ONLY', '只有房主能回大厅。', 403);
    if (room.status !== 'finished') fail('INVALID_PHASE', '请先完成本局。', 409);
    Object.assign(n, { status: 'lobby', round: 0, table: [], lastRound: null, winners: [], currentPlayerId: null });
    for (const p of n.players) { p.hand = []; p.score = 0; }
    log(n, '已回到大厅，可加入新玩家或再次开局。');
  }
  n.version++;
  n.receipts = [...n.receipts, { playerId, commandId: action.commandId, fingerprint }].slice(-512);
  return n;
}
export function viewFor(room, playerId) {
  const p = room.players.find(p => p.id === playerId);
  if (!p) fail('NOT_SEATED', '请先加入房间。', 403);
  return { roomCode: room.roomCode, version: room.version, status: room.status, pack: summarizePack(room.pack), you: { id: p.id, name: p.name, isHost: room.hostId === p.id }, players: room.players.map(p => ({ id: p.id, name: p.name, isHost: p.id === room.hostId, score: p.score, handCount: p.hand.length })), hand: clone(p.hand), round: room.round, totalRounds: 5, currentPlayerId: room.currentPlayerId, table: clone(room.table), lastRound: clone(room.lastRound), winners: [...room.winners], log: [...room.log] };
}
