INSERT INTO departments(id,name) VALUES('synthetic-dept','虚构旧账部门');
INSERT INTO users(id,username,name,password_hash,role,department_id) VALUES('synthetic-user','synthetic-old','虚构旧账管理员','not-a-real-password','ADMIN','synthetic-dept');
INSERT INTO customers(id,name,department_id,owner_user_id) VALUES('synthetic-customer','虚构迁移客户','synthetic-dept','synthetic-user');
INSERT INTO contracts(id,number,name,customer_id,amount_cents,status) VALUES('synthetic-contract','SYNTHETIC-23','虚构合同','synthetic-customer',1234567,'ACTIVE');
INSERT INTO projects(id,name,customer_id,department_id,manager_user_id,status) VALUES('synthetic-project','虚构项目','synthetic-customer','synthetic-dept','synthetic-user','ACTIVE');
INSERT INTO receivables(id,contract_id,project_id,name,category,amount_cents,due_date,due_date_is_estimated,owner_user_id,voided_at,void_reason,correction_of_id) VALUES
 ('synthetic-active','synthetic-contract','synthetic-project','有效旧账','首期款',1234567,'2026-01-01',0,'synthetic-user',NULL,NULL,NULL),
 ('synthetic-void','synthetic-contract','synthetic-project','作废旧账','首期款',12345,'2026-01-01',0,'synthetic-user','2026-02-01','虚构更正原因',NULL),
 ('synthetic-estimated','synthetic-contract','synthetic-project','推定日期旧账','服务费',67890,'2026-01-02',1,'synthetic-user',NULL,NULL,'synthetic-void');
INSERT INTO invoices(id,invoice_number,customer_id,invoice_date,amount_cents) VALUES('synthetic-invoice','SYNTHETIC-INV','synthetic-customer','2026-01-03',123456);
INSERT INTO invoice_allocations(id,invoice_id,receivable_id,amount_cents) VALUES('synthetic-ia','synthetic-invoice','synthetic-active',123456);
INSERT INTO receipts(id,customer_id,received_date,amount_cents,date_is_estimated,voided_at,void_reason) VALUES
 ('synthetic-receipt','synthetic-customer','2026-01-04',100001,1,NULL,NULL),
 ('synthetic-void-receipt','synthetic-customer','2026-01-04',200,0,'2026-02-01','虚构作废回款');
INSERT INTO receipt_allocations(id,receipt_id,receivable_id,amount_cents) VALUES
 ('synthetic-ra','synthetic-receipt','synthetic-active',100001),('synthetic-void-ra','synthetic-void-receipt','synthetic-active',200);
INSERT INTO service_periods(id,project_id,start_date,end_date,amount_cents,owner_user_id,receivable_id,status) VALUES
 ('synthetic-service','synthetic-project','2026-01-01','2026-12-31',67890,'synthetic-user','synthetic-estimated','PLANNED');
