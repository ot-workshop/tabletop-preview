import { validatePack, newRoom, joinRoom, performAction, viewFor } from './domain.js';
import { randomInt, randomUUID } from './random.js';

const $ = id => document.getElementById(id);
let room, humanId, pack, timer;
const notice = text => { $('notice').textContent = text; $('notice').hidden = !text; };
function apply(id, type, cardId) {
  room = performAction(room, id, { type, cardId, expectedVersion: room.version, commandId: randomUUID() });
}
function begin() {
  clearTimeout(timer); notice('');
  room = newRoom('LOCAL001', pack, '你'); humanId = room.hostId;
  room = joinRoom(room, '小星（电脑）'); apply(humanId, 'start');
  $('welcome').hidden = true; $('room').hidden = false;
  render();
}
function cardNode(card, name, playable = false) {
  const node = document.createElement(playable ? 'button' : 'div'); node.className = 'card';
  if (card.color) node.style.borderTopColor = card.color;
  const who = document.createElement('small'); who.textContent = name;
  const value = document.createElement('strong'); value.textContent = card.value;
  const label = document.createElement('small'); label.textContent = card.label;
  node.append(who, value, label);
  if (playable) {
    node.type = 'button'; node.disabled = room.status !== 'playing' || room.currentPlayerId !== humanId;
    node.setAttribute('aria-label', `打出${card.label}，${card.value}点`);
    node.onclick = () => { apply(humanId, 'play', card.id); render(); };
  }
  return node;
}
function render() {
  clearTimeout(timer);
  const s = viewFor(room, humanId), mine = s.currentPlayerId === humanId;
  $('room-phase').textContent = s.status === 'finished' ? '本局结束' : '单机演示进行中';
  $('turn-title').textContent = s.status === 'finished' ? '星筹已落定' : mine ? '轮到你出牌' : '小星正在想下一手…';
  $('round-number').textContent = `第 ${s.round} / 5 轮`;
  $('turn-help').textContent = '每人公开出一张，数字最大者得1分；并列都得分。';
  $('table').replaceChildren(...s.table.map(t => cardNode(t.card, t.playerName)));
  if (!s.table.length) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = '新一轮，等待第一张牌。'; $('table').append(p); }
  $('result').hidden = s.status !== 'finished'; $('result').textContent = `获胜：${s.winners.join('、')}`;
  $('again').hidden = s.status !== 'finished';
  $('hand-count').textContent = `${s.hand.length} 张`;
  $('hand').replaceChildren(...s.hand.map(c => cardNode(c, '我的手牌', true)));
  $('players').replaceChildren(...s.players.map(p => {
    const li = document.createElement('li'); if (p.id === s.currentPlayerId) li.className = 'active';
    const name = document.createElement('div'); name.textContent = p.name;
    const detail = document.createElement('small'); detail.textContent = `手牌 ${p.handCount} 张${p.id === s.currentPlayerId ? ' · 正在出牌' : ''}`;
    name.append(detail); const score = document.createElement('b'); score.textContent = `${p.score} 分`; li.append(name, score); return li;
  }));
  $('last-round-panel').hidden = !s.lastRound;
  if (s.lastRound) {
    $('last-round-title').textContent = `第${s.lastRound.round}轮 · ${s.lastRound.winnerNames.join('、')}各得1分`;
    $('last-round').replaceChildren(...s.lastRound.plays.map(t => cardNode(t.card, t.playerName)));
  }
  $('rules').textContent = '你和电脑各有5张牌，共5轮。每轮依次公开出1张，数字最大者各得1分，并列都得分；每轮轮换先手，五轮后总分最高者获胜。本局只在当前浏览器运行，刷新会重置，电脑会自动出牌。';
  $('log').replaceChildren(...s.log.map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
  if (s.status === 'playing' && !mine) timer = setTimeout(() => {
    const player = room.players.find(p => p.id === room.currentPlayerId);
    apply(player.id, 'play', player.hand[randomInt(player.hand.length)].id); render();
  }, 450);
}
$('start-demo').disabled = true;
$('start-demo').onclick = begin; $('again').onclick = begin;
$('home').onclick = () => { clearTimeout(timer); $('room').hidden = true; $('welcome').hidden = false; };
try {
  const response = await fetch('./pack.json'); if (!response.ok) throw new Error('加载失败');
  pack = validatePack(await response.json()); $('start-demo').disabled = false;
} catch { notice('演示内容暂时无法加载，请刷新页面重试。'); }
