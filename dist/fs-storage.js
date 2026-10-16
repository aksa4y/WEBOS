'use strict';
const VFS={
  db:null,model:new FileSystemModel(),queue:Promise.resolve(),
  async init(){
    if(!window.indexedDB)throw Error('Браузер не поддерживает IndexedDB');
    this.db=await new Promise((resolve,reject)=>{const r=indexedDB.open('forma-filesystem',1);r.onupgradeneeded=()=>r.result.createObjectStore('nodes',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>toast('Закройте другие вкладки Forma и обновите страницу')});
    const stored=await new Promise((resolve,reject)=>{const r=this.db.transaction('nodes').objectStore('nodes').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
    this.model=new FileSystemModel(stored);
    if(!stored.length){
      await this.mutate(async m=>{
        const disk=m.create(null,'Forma HD','disk');disk.system=true;
        const dirs={};for(const name of ['Рабочий стол','Документы','Изображения','Музыка','Загрузки'])dirs[name]=m.create(disk.id,name,'folder').id;
        m.create(null,'Данные','disk');
        for(const f of files){let blob;if(f.data){const [header,payload]=f.data.split(',');const bytes=header.includes(';base64')?Uint8Array.from(atob(payload),c=>c.charCodeAt(0)):new TextEncoder().encode(decodeURIComponent(payload));blob=new Blob([bytes],{type:f.type||'application/octet-stream'})}else blob=new Blob([f.text||''],{type:f.type||'text/plain'});const p=dirs[f.folder]||dirs['Документы'];const n=m.create(p,m.unique(p,f.name),'file',blob);if(f.deleted)m.trash(n.id)}
      });
    }
    this.db.onversionchange=()=>{this.db.close();toast('Хранилище обновлено в другой вкладке. Перезагрузите Forma.')};
    this.channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('forma-files-changes'):null;
    if(this.channel)this.channel.onmessage=()=>{this.reload().catch(reportError)};
    return this;
  },
  async reload(){const items=await new Promise((resolve,reject)=>{const r=this.db.transaction('nodes').objectStore('nodes').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});this.model=new FileSystemModel(items);document.dispatchEvent(new Event('fschange'))},
  mutate(fn){const operation=this.queue.then(async()=>{
    // Web Locks serializes mutations across tabs; re-read before writing.
    const run=async()=>{
      const items=await new Promise((resolve,reject)=>{const r=this.db.transaction('nodes').objectStore('nodes').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
      const next=new FileSystemModel(items),result=await fn(next);next.validate();
      await new Promise((resolve,reject)=>{const tx=this.db.transaction('nodes','readwrite'),store=tx.objectStore('nodes');for(const old of items)if(!next.nodes.has(old.id))store.delete(old.id);for(const n of next.all())store.put(n);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||Error('Запись отменена'));tx.onerror=()=>reject(tx.error)});
      this.model=next;document.dispatchEvent(new Event('fschange'));this.channel?.postMessage('changed');return result;
    };
    return navigator.locks?navigator.locks.request('forma-files-write',run):run();
  });this.queue=operation.catch(()=>{});return operation},
  async import(list,parent){let count=0;for(const f of list){await this.mutate(m=>m.create(parent,m.unique(parent,f.name),'file',f));count++}return count},
  bytes(id){const ids=id?this.model.descendants(id):null;return this.model.all().filter(n=>n.kind==='file'&&(!ids||ids.has(n.id))).reduce((sum,n)=>sum+(n.blob?.size||0),0)}
};
