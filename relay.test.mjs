import test from 'node:test';
import assert from 'node:assert/strict';
import {roomCodec} from './relay.mjs';
test('relay packets decrypt only with the same room key',async()=>{
 const a=await roomCodec('0123456789abcdef01234567'),b=await roomCodec('0123456789abcdef01234567'),c=await roomCodec('fedcba987654321001234567');
 const message={kind:'data',data:{type:'move',base:0,path:[40,33]}};
 const packet=await a.encode(message);
 assert.deepEqual(await b.decode(packet),message);assert.equal(a.topic,b.topic);assert.notEqual(a.topic,c.topic);
 await assert.rejects(()=>c.decode(packet));packet[20]^=1;await assert.rejects(()=>b.decode(packet));
});
test('each relay packet uses a different nonce and rejects short data',async()=>{
 const codec=await roomCodec('0123456789abcdef01234567');
 assert.notDeepEqual(await codec.encode({kind:'hello'}),await codec.encode({kind:'hello'}));
 await assert.rejects(()=>codec.decode(new Uint8Array(4)));
});
