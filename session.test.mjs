import test from 'node:test';
import assert from 'node:assert/strict';
import {Session,replay} from './session.mjs';
import {Rules as R} from './rules.mjs';
const room='0123456789abcdef01234567';
const path=text=>text.split(/[:-]/).map(R.square);
function pair(){
  const q=[];let a,b;
  a=new Session({room,side:'w',send:m=>q.push(()=>b.receive(JSON.parse(JSON.stringify(m)))),change:()=>{}});
  b=new Session({room,side:'b',send:m=>q.push(()=>a.receive(JSON.parse(JSON.stringify(m)))),change:()=>{}});
  const flush=()=>{let n=0;while(q.length){if(++n>200)throw Error('message loop');q.shift()();}};
  a.connect();b.connect();flush();return {a,b,q,flush};
}
test('handshake grants only the white turn',()=>{const {a,b}=pair();assert(a.canMove);assert(!b.canMove);assert.equal(a.state.board,b.state.board);});
test('two real moves are acknowledged and synchronized',()=>{const {a,b,flush}=pair();a.play(path('c3-d4'));assert.equal(a.pending,1);assert(!a.canMove);flush();assert.equal(b.state.ply,1);assert(b.canMove);b.play(path('d6-c5'));flush();assert.equal(a.state.ply,2);assert.equal(a.state.board,b.state.board);assert(a.canMove);assert.equal(b.pending,null);});
test('duplicate move is not applied again',()=>{const {a,b,flush}=pair();const m=a.envelope('move',{base:0,path:path('c3-d4')});a.play(m.path);flush();b.receive(m);flush();assert.equal(a.state.ply,1);assert.equal(b.state.ply,1);assert.equal(a.state.board,b.state.board);});
test('cannot play out of turn or through disconnected channel',()=>{const {a,b}=pair();assert.throws(()=>b.play(path('d6-c5')));a.disconnect();assert.throws(()=>a.play(path('c3-d4')));});
test('unacknowledged legal move survives reconnection',()=>{const {a,b,q,flush}=pair();a.play(path('a3-b4'));q.length=0;a.disconnect();b.disconnect();assert.equal(a.pending,1);a.connect();b.connect();flush();assert.equal(a.state.ply,1);assert.equal(b.state.ply,1);assert.equal(a.pending,null);assert(b.canMove);});
test('same revision with conflicting histories is rejected',()=>{const {a,b,flush}=pair();a.play(path('c3-d4'));flush();assert.throws(()=>b.receive(a.envelope('sync',{history:['a3-b4']})),/расходятся/);});
test('wrong room, wrong side and illegal remote moves rejected',()=>{const {a,b}=pair();assert.throws(()=>b.receive({...a.envelope('sync',{history:[]}),room:'another'}));assert.throws(()=>a.receive(a.envelope('sync',{history:[]})));assert.throws(()=>b.receive(a.envelope('move',{base:0,path:path('c3-c4')})));assert.equal(b.state.ply,0);});
test('saved history restores complete validated position',()=>{const {a,b,flush}=pair();a.play(path('e3-f4'));flush();b.play(path('f6-e5'));flush();const c=new Session({room,side:'w',send:()=>{},change:()=>{},saved:{history:a.state.history,startedAt:a.state.startedAt}});assert.equal(c.state.board,a.state.board);assert.equal(c.state.ply,2);assert(!c.canMove);assert.throws(()=>replay(room,['a3-a8']));});
test('fifty paired moves stay identical with capture chains',()=>{const {a,b,flush}=pair();for(let i=0;i<50&&!a.state.result;i++){const active=a.state.turn==='w'?a:b;const moves=R.legal(active.state.board,active.side);active.play(moves[(i*7)%moves.length].path);flush();assert.equal(a.state.board,b.state.board);assert.deepEqual(a.state.history,b.state.history);}});
