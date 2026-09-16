import {Relay} from './relay.mjs';
import {Rules as R} from './rules.mjs';
import {Session} from './session.mjs';

const $=id=>document.getElementById(id),grid=$('board');
let session,peer,channel,room,side,path=[],options=[],note='',network='Подключение…',connectionTimer,renderedPly=-1;
let relay=null, fallbackTimer;
const other=()=>side==='w'?'b':'w';
const peerId=s=>'shashki02-'+room+'-'+s;
const storageKey=()=>`shashki02:${room}:${side}`;
function showError(text){$('error').textContent=text;$('error').hidden=!text;}
function save(){try{localStorage.setItem(storageKey(),JSON.stringify({history:session.state.history,startedAt:session.state.startedAt}));}catch{showError('Браузер не сохранил партию. Не закрывай эту вкладку до конца игры.');}}
function matches(){return options.filter(m=>path.every((p,i)=>m.path[i]===p));}
function render(){
  if(!session)return;
  const s=session.state,b=Array.from(s.board);let taken=[];
  if(path.length>1){let piece=b[path[0]];b[path[0]]='.';for(const i of path.slice(1))piece=R.promote(piece,i);b[path.at(-1)]=piece;taken=matches()[0].taken.slice(0,path.length-1);}
  const targets=new Set(path.length?matches().map(m=>m.path[path.length]).filter(Number.isInteger):[]);
  const playable=new Set(options.map(m=>m.path[0]));
  for(let i=0;i<64;i++){
    const cell=grid.children[i],p=b[i],dark=(Math.floor(i/8)+i%8)%2===1;
    cell.className='sg-cell'+(dark?' dark':'')+(path.at(-1)===i?' selected':'')+(targets.has(i)?' target':'')+(s.lastMove?.path.includes(i)?' last':'');cell.replaceChildren();
    if(dark){cell.disabled=!session.canMove;cell.setAttribute('aria-pressed',String(path.at(-1)===i));cell.setAttribute('aria-label',R.coord(i)+(p==='.'?' — пусто':` — ${R.color(p)==='w'?'белая':'чёрная'} ${R.king(p)?'дамка':'шашка'}`)+(targets.has(i)?', можно сюда':playable.has(i)&&session.canMove?', можно ходить':''));}
    if(p!=='.'){const e=document.createElement('span');e.className='sg-piece '+(R.color(p)==='w'?'white':'black')+(R.king(p)?' king':'')+(taken.includes(i)?' taken':'');e.setAttribute('aria-hidden','true');cell.append(e);}
    if(i%8===0){const e=document.createElement('span');e.className='sg-coordinate sg-rank';e.textContent=8-Math.floor(i/8);e.setAttribute('aria-hidden','true');cell.append(e);}
    if(i>=56){const e=document.createElement('span');e.className='sg-coordinate sg-file';e.textContent='abcdefgh'[i%8];e.setAttribute('aria-hidden','true');cell.append(e);}
  }
  $('black-count').textContent=Array.from(s.board).filter(p=>R.color(p)==='b').length;
  $('white-count').textContent=Array.from(s.board).filter(p=>R.color(p)==='w').length;
  $('connection').textContent=session.connected&&session.synced?'Соперник подключён':network;
  let text=note;
  if(!text&&s.result)text=s.result.winner===null?'Ничья':s.result.winner===side?'Ты победил!':'Победил соперник';
  if(!text&&!session.connected)text='Ожидание соединения';
  if(!text&&!session.synced)text='Сверяем позицию…';
  if(!text&&session.pending!==null)text='Ход отправлен — ждём подтверждения';
  if(!text&&s.turn!==side)text='Ход соперника';
  if(!text)text=path.length>1?'Продолжай взятие':path.length?'Нажми подсвеченную клетку':options.some(m=>m.taken.length)?'Твой ход — взятие обязательно':'Твой ход — выбери шашку';
  $('turn-status').textContent=text;
  $('last-move').textContent=s.lastMove?`${Math.ceil(s.ply/2)}. ${s.lastMove.side==='w'?'Белые':'Чёрные'}: ${s.lastMove.text}`:'Белые начинают';
  $('reconnect').hidden=session.connected;
}
function changed(){if(session.state.ply!==renderedPly){path=[];note='';renderedPly=session.state.ply;options=session.state.result?[]:R.legal(session.state.board,session.state.turn);}save();render();}
function click(i){
  if(!session?.canMove)return;note='';
  if(path.length&&matches().some(m=>m.path[path.length]===i)){
    path.push(i);const complete=matches().find(m=>m.path.length===path.length);
    if(complete){try{session.play(path.slice());}catch(e){note=e.message;render();}}else render();return;
  }
  if(path.length>1)return;
  if(options.some(m=>m.path[0]===i))path=path[0]===i?[]:[i];
  else if(R.color(session.state.board[i])===side)note=options.some(m=>m.taken.length)?'Нужно взять другой шашкой':'У этой шашки нет хода';
  render();
}
for(let i=0;i<64;i++){
  const dark=(Math.floor(i/8)+i%8)%2===1,e=document.createElement(dark?'button':'span');
  if(dark){e.type='button';e.dataset.square=R.coord(i);e.addEventListener('click',()=>click(i));}else e.setAttribute('aria-hidden','true');grid.append(e);
}
function send(message){
  if(relay){relay.send(message);return;}
  if(!channel?.open){session.disconnect();return;}
  try{channel.send(message);}catch{network='Соединение потеряно';session.disconnect();}
}
function attach(conn){
  console.info('[network] attach',side,conn.peer);
  conn.on('iceStateChanged',state=>console.info('[network] ICE',side,state));
  if(conn.peer!==peerId(other())||(channel&&channel!==conn&&channel.open)){conn.close();return;}
  channel=conn;
  conn.on('open',()=>{console.info('[network] data channel open',side);clearTimeout(connectionTimer);clearTimeout(fallbackTimer);showError('');network='Соединено';session.connect();$('invite').open=false;});
  conn.on('data',message=>{if(channel!==conn)return;try{session.receive(message);}catch(e){showError(e.message);conn.close();}});
  conn.on('close',()=>{if(channel===conn){channel=null;network='Соперник отключён';session.disconnect();}});
  conn.on('error',()=>{if(channel===conn){network='Соединение прервано';session.disconnect();showError('Партия сохранена. Попробуй подключиться снова.');}});
}
function join(){
  if(channel?.open)return;
  network='Ищем соперника…';render();
  // Only black initiates a channel, avoiding duplicate simultaneous connections.
  if(side==='b')attach(peer.connect(peerId('w'),{reliable:true,serialization:'json',metadata:{room,side,protocol:1}}));
  clearTimeout(connectionTimer);
  connectionTimer=setTimeout(()=>{if(!session.connected){network='Ждём подключения';showError('Соединение пока не установлено. Открой обе ссылки и нажми «Подключиться снова» у чёрных.');render();}},20000);
}
function setupRelay(){
  if(relay)return;
  console.info('[network] switching to encrypted WebSocket relay',side);
  clearTimeout(connectionTimer);clearTimeout(fallbackTimer);
  peer?.destroy();channel=null;session.disconnect();
  network='Резервная связь: ищем соперника…';showError('');render();
  relay=new Relay({room,side,
    onReady:()=>{console.info('[network] relay connected',side);showError('');network='Соединено';session.connect();$('invite').open=false;},
    onData:m=>{try{session.receive(m);}catch(e){showError(e.message);session.disconnect();}},
    onOffline:()=>{network='Соперник отключён';session.disconnect();},
    onError:e=>{console.error('[network] relay',e.message);showError('Ошибка резервной связи: '+e.message);}
  });
  relay.start().catch(e=>showError(e.message));
}
setInterval(()=>{if(relay?.ready&&session?.connected)session.sync();},5000);
function setupPeer(){
  fallbackTimer=setTimeout(()=>{if(!session.connected)setupRelay();},8000);
  if(typeof window.Peer!=='function'){network='Связь не запущена';showError('Не загрузилась библиотека соединения. Обнови страницу.');render();return;}
  console.info('[network] PeerJS loaded',side);
  peer=new window.Peer(peerId(side),{debug:3});
  peer.on('open',id=>{console.info('[network] signaling ready',side,id);join();});peer.on('connection',attach);
  peer.on('disconnected',()=>{if(!channel?.open){network='Соединение потеряно';session.disconnect();}});
  peer.on('error',e=>{
    if(e.type==='peer-unavailable'){network='Соперник ещё не вошёл';render();return;}
    const descriptions={'unavailable-id':'Эта сторона уже открыта в другой вкладке. Закрой лишнюю вкладку.','browser-incompatible':'В этом браузере нет необходимой поддержки сетевой игры.','network':'Не удалось связаться с сервером соединения.','webrtc':'Браузеры не смогли установить прямое соединение.'};
    showError(descriptions[e.type]||'Ошибка соединения: '+e.type);network='Соединение прервано';if(!channel?.open)session.disconnect();
  });
}
function enter(){
  const p=new URLSearchParams(location.hash.slice(1));room=p.get('room');side=p.get('side');
  if(!room&&!side)return;
  if(!/^[a-z0-9]{24}$/.test(room||'')||!['w','b'].includes(side)){showError('Ссылка на комнату повреждена');$('game').hidden=false;return;}
  $('lobby').hidden=true;$('game').hidden=false;
  let saved=null;try{const raw=localStorage.getItem(storageKey());if(raw)saved=JSON.parse(raw);}catch{}
  try{session=new Session({room,side,send,change:changed,saved});}catch{showError('Сохранённая партия повреждена. Создай новую комнату.');return;}
  $('white-name').textContent=side==='w'?'Ты · белые':'Соперник · белые';
  $('black-name').textContent=side==='b'?'Ты · чёрные':'Соперник · чёрные';
  const invite=new URL(location.href);invite.hash=new URLSearchParams({room,side:other()}).toString();$('invite-link').value=invite.href;
  changed();setupPeer();
}
$('create-room').addEventListener('click',()=>{const bytes=crypto.getRandomValues(new Uint8Array(12));const id=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');location.hash=new URLSearchParams({room:id,side:'w'}).toString();enter();});
$('copy-invite').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('invite-link').value);$('copy-invite').textContent='Ссылка скопирована';}catch{$('invite-link').focus();$('invite-link').select();$('copy-invite').textContent='Выделено — скопируй ссылку';}});
$('reconnect').addEventListener('click',()=>{showError('');if(relay){relay.close();relay=null;setupRelay();return;}if(!peer||peer.destroyed){setupPeer();return;}if(peer.disconnected){peer.reconnect();return;}join();});
setInterval(()=>{if(!session?.state.startedAt)return;const s=session.state;const n=Math.max(0,Math.floor(((s.result?s.turnStartedAt:Date.now())-s.startedAt)/1000));$('clock').textContent=String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');},1000);
enter();
