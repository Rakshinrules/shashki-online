import {Rules as R} from './rules.mjs';

export function initial(room){
  const board=R.start();
  return {version:1,gameId:room,ply:0,board,turn:'w',history:[],repetitions:{[board+'w']:1},quietKingPlies:0,startedAt:null,turnStartedAt:null,lastMove:null,result:null};
}
export function replay(room,history,startedAt=null){
  if(!Array.isArray(history)||history.length>2048)throw Error('Неверный журнал партии');
  let state=initial(room);
  for(const text of history){
    if(typeof text!=='string'||text.length>90)throw Error('Неверная запись хода');
    const move=R.legal(state.board,state.turn).find(m=>R.notation(m)===text);
    if(!move)throw Error('Недопустимый ход в журнале');
    state=R.apply(state,move.path);
  }
  if(Number.isFinite(startedAt)&&startedAt>0)state.startedAt=startedAt;
  return state;
}
export class Session{
  constructor({room,side,send,change,saved}){
    this.room=room;this.side=side;this.send=send;this.change=change;
    this.state=saved?replay(room,saved.history,saved.startedAt):initial(room);
    this.connected=false;this.synced=false;this.pending=null;
  }
  envelope(type,extra={}){return {protocol:1,room:this.room,side:this.side,type,...extra};}
  connect(){this.connected=true;this.synced=false;this.sync();this.change();}
  disconnect(){this.connected=false;this.synced=false;this.change();}
  sync(){this.send(this.envelope('sync',{history:this.state.history,startedAt:this.state.startedAt}));}
  get canMove(){return this.connected&&this.synced&&this.pending===null&&this.state.turn===this.side&&!this.state.result;}
  play(path){
    if(!this.canMove)throw Error('Сейчас нельзя ходить');
    const base=this.state.ply;
    this.state=R.apply(this.state,path);this.pending=this.state.ply;this.change();
    this.send(this.envelope('move',{base,path,startedAt:this.state.startedAt}));
  }
  acknowledge(){this.send(this.envelope('ack',{ply:this.state.ply,board:this.state.board}));}
  receive(message){
    if(!message||message.protocol!==1||message.room!==this.room||message.side===(this.side)||!['w','b'].includes(message.side))throw Error('Сообщение из другой комнаты');
    if(message.type==='sync'){
      const incoming=replay(this.room,message.history,message.startedAt);
      const n=Math.min(incoming.ply,this.state.ply);
      for(let i=0;i<n;i++)if(incoming.history[i]!==this.state.history[i])throw Error('Журналы партии расходятся');
      if(incoming.ply>this.state.ply)this.state=incoming;
      if(this.pending!==null&&incoming.ply>=this.pending)this.pending=null;
      this.synced=true;
      if(incoming.ply<this.state.ply)this.sync();
      this.acknowledge();this.change();return;
    }
    if(message.type==='ack'){
      if(message.ply===this.state.ply&&message.board===this.state.board){this.pending=null;this.synced=true;this.change();}
      return;
    }
    if(message.type!=='move')throw Error('Неизвестное сообщение');
    if(!Number.isInteger(message.base)||!Array.isArray(message.path)||message.path.length<2||message.path.length>13||!message.path.every(i=>Number.isInteger(i)&&i>=0&&i<64))throw Error('Неверный ход');
    if(message.base<this.state.ply){this.sync();return;}
    if(message.base>this.state.ply){this.sync();return;}
    if(this.state.turn!==message.side)throw Error('Ход вне очереди');
    this.state=R.apply(this.state,message.path);
    if(this.state.ply===1&&Number.isFinite(message.startedAt))this.state.startedAt=message.startedAt;
    this.synced=true;this.acknowledge();this.change();
  }
}
