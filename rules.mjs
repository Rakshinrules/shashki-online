
export const Rules=(()=>{
  const dirs=[[-1,-1],[-1,1],[1,-1],[1,1]];
  const inside=(r,c)=>r>=0&&r<8&&c>=0&&c<8;
  const color=p=>p==='.'?null:p.toLowerCase();
  const king=p=>p!=='.'&&p===p.toUpperCase();
  const coord=i=>'abcdefgh'[i%8]+(8-Math.floor(i/8));
  const square=s=>(8-Number(s[1]))*8+'abcdefgh'.indexOf(s[0]);
  const promote=(p,i)=>p==='w'&&i<8?'W':p==='b'&&i>=56?'B':p;
  const start=()=>Array.from({length:64},(_,i)=>((Math.floor(i/8)+i%8)%2===0)?'.':i<24?'b':i>=40?'w':'.').join('');
  function jumps(board,from,piece,taken){
    const options=[],row=Math.floor(from/8),col=from%8;
    for(const [dr,dc] of dirs){
      let r=row+dr,c=col+dc;
      if(!king(piece)){
        if(!inside(r,c)||!inside(r+dr,c+dc))continue;
        const over=r*8+c,to=(r+dr)*8+c+dc;
        if(color(board[over])&&color(board[over])!==color(piece)&&!taken.includes(over)&&board[to]==='.')options.push({to,over});
      }else{
        while(inside(r,c)&&board[r*8+c]==='.'){r+=dr;c+=dc;}
        if(!inside(r,c))continue;
        const over=r*8+c;
        if(color(board[over])===color(piece)||taken.includes(over))continue;
        r+=dr;c+=dc;
        while(inside(r,c)&&board[r*8+c]==='.'){
          options.push({to:r*8+c,over});r+=dr;c+=dc;
        }
      }
    }
    return options;
  }
  function legal(position,side){
    const board=Array.from(position),captures=[];
    function visit(b,at,p,path,taken){
      const opts=jumps(b,at,p,taken);
      if(!opts.length&&taken.length){
        const result=b.slice();for(const i of taken)result[i]='.';
        captures.push({path,taken,board:result.join(''),piece:p});return;
      }
      for(const {to,over} of opts){
        const next=b.slice(),q=promote(p,to);next[at]='.';next[to]=q;
        visit(next,to,q,path.concat(to),taken.concat(over));
      }
    }
    for(let i=0;i<64;i++)if(color(board[i])===side)visit(board,i,board[i],[i],[]);
    if(captures.length)return captures;
    const moves=[];
    for(let from=0;from<64;from++){
      const p=board[from];if(color(p)!==side)continue;
      for(const [dr,dc] of dirs){
        if(!king(p)&&dr!==(side==='w'?-1:1))continue;
        let r=Math.floor(from/8)+dr,c=from%8+dc;
        while(inside(r,c)&&board[r*8+c]==='.'){
          const to=r*8+c,next=board.slice(),q=promote(p,to);next[from]='.';next[to]=q;
          moves.push({path:[from,to],taken:[],board:next.join(''),piece:q});
          if(!king(p))break;r+=dr;c+=dc;
        }
      }
    }
    return moves;
  }
  const notation=m=>m.path.map(coord).join(m.taken.length?':':'-');
  function apply(state,path,now=Date.now()){
    if(state.result)throw new Error('Партия завершена');
    const move=legal(state.board,state.turn).find(m=>m.path.length===path.length&&m.path.every((v,i)=>v===path[i]));
    if(!move)throw new Error('Недопустимый ход');
    const next=JSON.parse(JSON.stringify(state));
    const irreversible=move.taken.length>0||!king(state.board[path[0]]);
    next.board=move.board;next.turn=state.turn==='w'?'b':'w';next.ply=state.ply+1;
    next.startedAt=state.startedAt||now;next.turnStartedAt=now;
    next.lastMove={side:state.turn,path:move.path,taken:move.taken,text:notation(move)};
    next.history=(state.history||[]).concat(notation(move));
    next.quietKingPlies=irreversible?0:(state.quietKingPlies||0)+1;
    next.repetitions=irreversible?{}:{...(state.repetitions||{})};
    const key=next.board+next.turn;next.repetitions[key]=(next.repetitions[key]||0)+1;
    if(!legal(next.board,next.turn).length)next.result={winner:state.turn,reason:'no-moves'};
    else if(next.repetitions[key]>=3)next.result={winner:null,reason:'threefold'};
    else if(next.quietKingPlies>=30)next.result={winner:null,reason:'fifteen-king-moves'};
    return next;
  }
  function valid(state){
    return state&&state.version===1&&typeof state.gameId==='string'&&Number.isInteger(state.ply)&&state.ply>=0&&typeof state.board==='string'&&state.board.length===64&&/^[.wbWB]+$/.test(state.board)&&['w','b'].includes(state.turn)&&Array.from(state.board).every((p,i)=>p==='.'||(Math.floor(i/8)+i%8)%2===1);
  }
  return {start,color,king,coord,square,promote,legal,notation,apply,valid};
})();
