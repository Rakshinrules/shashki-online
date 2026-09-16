// Encrypted fallback for networks where a WebRTC data channel cannot open.
const encoder=new TextEncoder(),decoder=new TextDecoder();
const library='https://cdn.jsdelivr.net/npm/mqtt@5.10.4/dist/mqtt.min.js';
export async function loadMqtt(){
  if(window.mqtt)return window.mqtt;
  await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=library;s.onload=resolve;s.onerror=()=>reject(Error('Не загрузилась библиотека резервной связи'));document.head.append(s);});
  return window.mqtt;
}
export async function roomCodec(room){
  const key=await crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',encoder.encode('shashki-relay-key:'+room)),{name:'AES-GCM'},false,['encrypt','decrypt']);
  const digest=await crypto.subtle.digest('SHA-256',encoder.encode('shashki-relay-topic:'+room));
  const topic='shashki/v1/'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  return {topic,async encode(data){const iv=crypto.getRandomValues(new Uint8Array(12));const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,encoder.encode(JSON.stringify(data))));return new Uint8Array([...iv,...cipher]);},async decode(bytes){if(bytes.length<28||bytes.length>300000)throw Error('Invalid packet');return JSON.parse(decoder.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12)},key,bytes.slice(12))));}};
}
export class Relay{
  constructor({room,side,onReady,onData,onOffline,onError}){Object.assign(this,{room,side,onReady,onData,onOffline,onError});this.id=crypto.randomUUID();this.lastSeen=0;this.ready=false;this.queue=Promise.resolve();this.incoming=Promise.resolve();this.closed=false;}
  async start(){
    const mqtt=await loadMqtt();this.codec=await roomCodec(this.room);if(this.closed)return;
    const client=this.client=mqtt.connect('wss://broker.hivemq.com:8884/mqtt',{clientId:'shashki-'+this.id,clean:true,connectTimeout:12000,reconnectPeriod:3000,keepalive:15});
    client.on('connect',()=>client.subscribe(this.codec.topic,{qos:1},err=>{if(err){this.onError(err);return;}this.hello();}));
    client.on('message',(_topic,bytes)=>{this.incoming=this.incoming.then(async()=>{let m;try{m=await this.codec.decode(new Uint8Array(bytes));}catch{return;}if(this.closed||m.id===this.id||m.side===this.side||!['w','b'].includes(m.side))return;this.lastSeen=Date.now();if(!this.ready){this.ready=true;this.onReady();this.hello();}if(m.kind==='data')this.onData(m.data);}).catch(this.onError);});
    client.on('offline',()=>this.offline());client.on('close',()=>this.offline());client.on('error',e=>this.onError(e));
    this.timer=setInterval(()=>{if(this.lastSeen&&Date.now()-this.lastSeen>12000)this.offline();this.hello();},3000);
  }
  offline(){if(this.ready){this.ready=false;this.onOffline();}}
  hello(){this.publish({kind:'hello'});}
  send(data){this.publish({kind:'data',data});}
  publish(data){if(!this.client?.connected||this.closed)return;this.queue=this.queue.then(async()=>{const bytes=await this.codec.encode({...data,id:this.id,side:this.side});if(this.client.connected&&!this.closed)this.client.publish(this.codec.topic,bytes,{qos:1,retain:false});}).catch(this.onError);}
  close(){this.closed=true;clearInterval(this.timer);this.client?.end(true);this.offline();}
}
