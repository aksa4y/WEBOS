/* Pure filesystem rules, shared by IndexedDB storage and Node tests. */
(function(global){
  'use strict';
  class FileSystemModel {
    constructor(items=[]){this.nodes=new Map(items.map(n=>[n.id,{...n}]))}
    all(){return [...this.nodes.values()]}
    get(id){const n=this.nodes.get(id);if(!n)throw Error('Объект не найден');return n}
    validName(name){name=String(name).trim();if(!name||name==='.'||name==='..'||/[\\/\x00-\x1f]/.test(name)||name.length>120)throw Error('Имя: от 1 до 120 символов, без / и \\');return name}
    available(parent,name,exclude){if(this.all().some(n=>n.parent===parent&&n.id!==exclude&&!n.deleted&&n.name.toLocaleLowerCase()===name.toLocaleLowerCase()))throw Error('Объект с таким именем уже существует')}
    live(id){const n=this.get(id);if(n.deleted)throw Error('Объект находится в корзине');return n}
    folder(id){const n=this.live(id);if(!['disk','folder'].includes(n.kind))throw Error('Выберите папку или диск');return n}
    children(id){return this.all().filter(n=>n.parent===id&&!n.deleted)}
    descendants(id){const found=new Set([id]);let changed=true;while(changed){changed=false;for(const n of this.nodes.values())if(found.has(n.parent)&&!found.has(n.id)){found.add(n.id);changed=true}}return found}
    create(parent,name,kind='file',blob=null){if(kind!=='disk')this.folder(parent);else parent=null;name=this.validName(name);this.available(parent,name);if(!['disk','folder','file'].includes(kind))throw Error('Неверный тип объекта');if(kind==='file'&&!(blob instanceof Blob))blob=new Blob([''],{type:'text/plain'});const n={id:crypto.randomUUID(),parent,name,kind,created:Date.now(),modified:Date.now(),...(kind==='file'?{blob,size:blob.size,type:blob.type||'application/octet-stream'}:{})};this.nodes.set(n.id,n);return n}
    rename(id,name){const n=this.live(id);name=this.validName(name);this.available(n.parent,name,id);n.name=name;n.modified=Date.now();return n}
    write(id,blob){const n=this.live(id);if(n.kind!=='file')throw Error('Это не файл');n.blob=blob;n.size=blob.size;n.type=blob.type;n.modified=Date.now();return n}
    move(id,parent){const n=this.live(id);this.folder(parent);if(n.kind==='disk')throw Error('Диск нельзя переместить');if(this.descendants(id).has(parent))throw Error('Нельзя переместить папку внутрь себя');this.available(parent,n.name,id);n.parent=parent;n.modified=Date.now();return n}
    unique(parent,name){let proposed=name,i=2;while(this.all().some(n=>!n.deleted&&n.parent===parent&&n.name.toLocaleLowerCase()===proposed.toLocaleLowerCase())){const dot=name.lastIndexOf('.');proposed=dot>0?name.slice(0,dot)+' ('+i+++')'+name.slice(dot):name+' ('+i+++')'}return proposed}
    copy(id,parent){const n=this.live(id);this.folder(parent);if(n.kind==='disk')throw Error('Выберите папку или файл');if(this.descendants(id).has(parent))throw Error('Нельзя скопировать папку внутрь себя');const source=this.all().filter(x=>this.descendants(id).has(x.id)&&!x.deleted),mapping=new Map(source.map(x=>[x.id,crypto.randomUUID()]));for(const x of source){const item={...x,id:mapping.get(x.id),parent:x.id===id?parent:mapping.get(x.parent),name:x.id===id?this.unique(parent,x.name):x.name,created:Date.now(),modified:Date.now()};this.nodes.set(item.id,item)}return this.get(mapping.get(id))}
    trash(id){const n=this.live(id);if(n.kind==='disk')throw Error('Управление дисками находится в Настройках');for(const key of this.descendants(id)){const x=this.get(key);if(!x.deleted){x.deleted=true;x.trashRoot=id;x.trashedAt=Date.now()}}return n}
    restore(id){const n=this.get(id);if(!n.deleted)return n;const group=n.trashRoot||id,root=this.get(group);let parent=this.nodes.get(root.parent);if(!parent||parent.deleted)parent=this.all().find(x=>x.kind==='disk'&&!x.deleted);if(!parent)throw Error('Нет диска для восстановления');root.parent=parent.id;root.name=this.unique(parent.id,root.name);for(const x of this.nodes.values())if(x.deleted&&x.trashRoot===group){delete x.deleted;delete x.trashRoot;delete x.trashedAt}return root}
    purge(id){const n=this.get(id);if(!n.deleted)throw Error('Сначала переместите объект в корзину');for(const key of this.descendants(id))this.nodes.delete(key)}
    format(id){const n=this.live(id);if(n.kind!=='disk')throw Error('Это не диск');for(const key of this.descendants(id))if(key!==id)this.nodes.delete(key)}
    removeDisk(id){const n=this.live(id);if(n.kind!=='disk'||n.system)throw Error('Системный диск нельзя удалить');if(this.all().some(x=>x.parent===id))throw Error('Сначала очистите диск');this.nodes.delete(id)}
    path(id){let n=this.get(id),parts=[],seen=new Set();while(n){if(seen.has(n.id))throw Error('Повреждён путь');seen.add(n.id);parts.unshift(n.name);n=this.nodes.get(n.parent)}return '/'+parts.join('/')}
    resolve(path,cwd){if(!path||path==='.')return this.live(cwd);let current=path.startsWith('/')?null:cwd;for(const part of path.split('/').filter(Boolean)){if(part==='.')continue;if(part==='..'){current=current?this.get(current).parent:null;continue}const n=this.all().find(n=>!n.deleted&&n.parent===current&&n.name===part);if(!n)throw Error('Путь не найден: '+path);current=n.id}if(!current)throw Error('Укажите диск, например /Forma HD');return this.live(current)}
    validate(){for(const n of this.nodes.values()){if(typeof n.id!=='string'||!/^[-a-zA-Z0-9_]+$/.test(n.id)||!['disk','folder','file'].includes(n.kind))throw Error('Неверная структура файловой системы');this.validName(n.name);if(n.kind==='disk'){if(n.parent!==null)throw Error('Неверный корень диска')}else{const p=this.nodes.get(n.parent);if(!p||!['disk','folder'].includes(p.kind))throw Error('Отсутствует родительская папка');if(!n.deleted&&p.deleted)throw Error('Неверное состояние корзины')}if(n.kind==='file'&&(!(n.blob instanceof Blob)||typeof n.type!=='string'))throw Error('Отсутствует содержимое или тип файла');this.path(n.id);if(!n.deleted)this.available(n.parent,n.name,n.id)}if(!this.all().some(n=>n.kind==='disk'&&n.system&&!n.deleted))throw Error('Отсутствует системный диск');return true}
  }
  global.FileSystemModel=FileSystemModel;
  if(typeof module!=='undefined')module.exports=FileSystemModel;
})(globalThis);
