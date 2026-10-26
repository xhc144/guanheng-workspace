import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../lib/db.ts";
import { saveProjectRecord } from "../lib/projects.ts";
import { initializeSchema } from "../lib/schema.ts";

function fixture(){
  const db=openDatabase(":memory:");db.prepare("INSERT INTO departments (id,name) VALUES ('d1','交付部')").run();
  db.prepare("INSERT INTO users (id,username,name,password_hash,role,department_id) VALUES ('u1','m','经理','x','DEPARTMENT_MANAGER','d1'),('u2','a','成员甲','x','PROJECT_MEMBER','d1'),('u3','b','成员乙','x','PROJECT_MEMBER','d1')").run();
  db.prepare("INSERT INTO customers (id,name,owner_user_id,department_id) VALUES ('c1','甲客户','u1','d1'),('c2','乙客户','u1','d1')").run();
  db.prepare("INSERT INTO contracts (id,number,name,customer_id,amount_cents) VALUES ('ct1','HT1','合同一','c1',10000),('ct2','HT2','合同二','c1',20000),('ct3','HT3','其他合同','c2',10000)").run();return db;
}

test("project saves multiple contracts and different member commission points atomically",()=>{
  const db=fixture(),id=saveProjectRecord(db,{name:"经营系统",projectVersion:" V3.2 ",customerId:"c1",managerUserId:"u1",departmentId:"d1",status:"ACTIVE",contractIds:["ct1","ct2"],members:[{userId:"u2",duty:"实施",commissionBasisPoints:300},{userId:"u3",duty:"开发",commissionBasisPoints:500}]});
  assert.equal((db.prepare("SELECT project_version FROM projects WHERE id=?").get(id) as {project_version:string}).project_version,"V3.2");
  assert.equal((db.prepare("SELECT COUNT(*) count FROM contract_projects WHERE project_id=?").get(id) as {count:number}).count,2);
  const members=(db.prepare("SELECT user_id,commission_basis_points points FROM project_members WHERE project_id=? ORDER BY user_id").all(id) as {user_id:string;points:number}[]).map(x=>({user_id:String(x.user_id),points:Number(x.points)}));
  assert.deepEqual(members,[{user_id:"u2",points:300},{user_id:"u3",points:500}]);
});

test("project version is editable and persisted",()=>{
  const db=fixture(),id=saveProjectRecord(db,{name:"经营系统",projectVersion:"V1",customerId:"c1",status:"PLANNED",contractIds:[],members:[]});
  saveProjectRecord(db,{id,name:"经营系统",projectVersion:"V2.1",customerId:"c1",status:"ACTIVE",contractIds:[],members:[]});
  const project=db.prepare("SELECT project_version,status FROM projects WHERE id=?").get(id) as {project_version:string;status:string};
  assert.equal(project.project_version,"V2.1");assert.equal(project.status,"ACTIVE");
});

test("existing project cannot change customer",()=>{
  const db=fixture(),id=saveProjectRecord(db,{name:"经营系统",customerId:"c1",status:"ACTIVE",contractIds:["ct1"],members:[]});
  assert.throws(()=>saveProjectRecord(db,{id,name:"经营系统",customerId:"c2",status:"ACTIVE",contractIds:[],members:[]}),/已有项目不可更换客户/);
  const project=db.prepare("SELECT customer_id FROM projects WHERE id=?").get(id) as {customer_id:string};
  assert.equal(project.customer_id,"c1");
  assert.equal((db.prepare("SELECT COUNT(*) count FROM contract_projects WHERE project_id=?").get(id) as {count:number}).count,1);
});

test("project rejects a contract belonging to another customer without partial writes",()=>{
  const db=fixture();assert.throws(()=>saveProjectRecord(db,{name:"错误项目",customerId:"c1",status:"ACTIVE",contractIds:["ct1","ct3"],members:[]}),/客户不一致/);
  assert.equal((db.prepare("SELECT COUNT(*) count FROM projects").get() as {count:number}).count,0);
});

test("existing project tables migrate the project version column",()=>{
  const db=new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY,name TEXT NOT NULL,customer_id TEXT NOT NULL,manager_user_id TEXT,department_id TEXT,start_date TEXT,planned_end_date TEXT,actual_end_date TEXT,status TEXT NOT NULL DEFAULT 'PLANNED',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  initializeSchema(db);
  assert.ok((db.prepare("PRAGMA table_info(projects)").all() as {name:string}[]).some(column=>column.name==="project_version"));
  db.close();
});
