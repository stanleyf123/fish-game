'use strict';
const BASE=20,STEP=20,PRICE=100,MAX=2000;
function list(db,pid){return db.prepare('SELECT data FROM fish_storage WHERE player_id=?').all(pid).map(r=>JSON.parse(r.data))}
function used(db,pid){return db.prepare('SELECT COUNT(*) n FROM fish_storage WHERE player_id=?').get(pid).n}
function migrate(db){db.exec(`CREATE TABLE IF NOT EXISTS fish_storage_capacity(player_id INTEGER PRIMARY KEY REFERENCES players(id),capacity INTEGER NOT NULL DEFAULT 20);CREATE TABLE IF NOT EXISTS fish_storage_migrations(name TEXT PRIMARY KEY,created_at INTEGER NOT NULL)`);
 db.transaction(()=>{if(db.prepare('SELECT 1 FROM fish_storage_migrations WHERE name=?').get('count20-v2'))return;
 const put=db.prepare('INSERT INTO fish_storage_capacity(player_id,capacity) VALUES(?,?) ON CONFLICT(player_id) DO UPDATE SET capacity=MAX(capacity,excluded.capacity)');
 for(const r of db.prepare('SELECT player_id,COUNT(*) n FROM fish_storage GROUP BY player_id HAVING COUNT(*)>20').all())put.run(r.player_id,Math.ceil(r.n/20)*20);
 db.prepare('INSERT INTO fish_storage_migrations VALUES(?,?)').run('count20-v2',Date.now());})();}
function capacity(db,pid){return Math.max(BASE,db.prepare('SELECT capacity FROM fish_storage_capacity WHERE player_id=?').get(pid)?.capacity||BASE)}
function state(db,pid){const n=capacity(db,pid);return{storageUnit:'count',storageUsed:used(db,pid),storageCapacity:n,storageExpansion:n<MAX?{from:n,to:Math.min(MAX,n+STEP),gems:PRICE}:null,storageMax:Math.max(MAX,n)}}
module.exports={migrate,capacity,state,used,list,BASE,STEP,PRICE,MAX};
