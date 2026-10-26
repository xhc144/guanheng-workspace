import { cpSync,existsSync,mkdirSync } from "node:fs";
import { join,resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const filename=process.env.DATABASE_FILENAME??"app.db";
if(!/^[a-zA-Z0-9._-]+$/.test(filename))throw new Error("数据库文件名不安全");
const dataRoot=resolve(process.cwd(),"data"),source=join(dataRoot,filename);
if(!existsSync(source))throw new Error(`数据库不存在：${source}`);
const stamp=new Date().toISOString().replace(/[:.]/g,"-");
const backupRoot=join(dataRoot,"backups"),databaseBackup=join(backupRoot,`${stamp}-${filename}`);
mkdirSync(backupRoot,{recursive:true});
const db=new DatabaseSync(source);
try{db.prepare("VACUUM INTO ?").run(databaseBackup);}finally{db.close();}
const uploads=join(dataRoot,"uploads"),uploadsBackup=join(backupRoot,`${stamp}-uploads`);
if(existsSync(uploads))cpSync(uploads,uploadsBackup,{recursive:true,errorOnExist:true});
console.log(JSON.stringify({databaseBackup,uploadsBackup:existsSync(uploadsBackup)?uploadsBackup:null}));
