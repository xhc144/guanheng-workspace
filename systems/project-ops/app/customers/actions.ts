"use server";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SESSION_COOKIE } from "@/lib/api.ts";
import { writeAudit } from "@/lib/audit.ts";
import { getSessionUser } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";
import { customerScopeSql } from "@/lib/permissions.ts";

export type CustomerActionState = { ok: boolean; message: string };

const nullableText = z.string().trim().max(200).transform((value) => value || null);
const customerSchema = z.object({
  id: z.string().trim().max(100).optional(),
  name: z.string().trim().min(2, "客户名称至少2个字").max(100),
  shortName: nullableText,
  contactName: nullableText,
  phone: z.string().trim().max(30).regex(/^[0-9+()\-\s]*$/, "联系电话格式不正确").transform((value) => value || null),
  address: nullableText,
  bankName: nullableText,
  bankAccount: z.string().trim().max(50).regex(/^[0-9\-\s]*$/, "银行账号格式不正确").transform((value) => value || null),
  invoiceTitle: nullableText,
  taxId: z.string().trim().max(30).regex(/^[0-9A-Za-z]*$/, "纳税识别号格式不正确").transform((value) => value || null),
  industry: z.string().trim().max(100).transform((value) => value || null),
  isAgency: z.enum(["0", "1"]).transform((value) => value === "1"),
  notes: z.string().trim().max(1000).transform((value) => value || null),
});

async function currentUser() {
  const db = getDb();
  const user = getSessionUser(db, (await cookies()).get(SESSION_COOKIE)?.value);
  if (!user) throw new Error("登录已过期，请重新登录");
  return { db, user };
}

export async function saveCustomer(_state: CustomerActionState, formData: FormData): Promise<CustomerActionState> {
  try {
    const parsed = customerSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "提交内容不正确" };
    const { db, user } = await currentUser();
    const input = parsed.data;
    if (input.id) {
      const scope = customerScopeSql(user);
      const before = db.prepare(`SELECT * FROM customers c WHERE c.id = ? AND ${scope.sql}`)
        .get(input.id, ...scope.params) as Record<string, unknown> | undefined;
      if (!before) return { ok: false, message: "客户不存在或无权修改" };
      db.prepare(`UPDATE customers SET name=?, short_name=?, contact_name=?, phone=?, address=?, bank_name=?,
        bank_account=?, invoice_title=?, tax_id=?, industry=?, is_agency=?, is_agency_confirmed=1, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(input.name, input.shortName, input.contactName, input.phone, input.address, input.bankName,
          input.bankAccount, input.invoiceTitle, input.taxId, input.industry, input.isAgency ? 1 : 0, input.notes, input.id);
      writeAudit(db, { userId: user.id, action: "UPDATE", entityType: "CUSTOMER", entityId: input.id,
        before, after: input });
    } else {
      const id = randomUUID();
      db.prepare(`INSERT INTO customers (id,name,short_name,contact_name,phone,address,bank_name,bank_account,
        invoice_title,tax_id,industry,is_agency,is_agency_confirmed,notes,owner_user_id,department_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, input.name, input.shortName, input.contactName, input.phone, input.address, input.bankName,
          input.bankAccount, input.invoiceTitle, input.taxId, input.industry, input.isAgency ? 1 : 0, 1, input.notes, user.id, user.departmentId);
      writeAudit(db, { userId: user.id, action: "CREATE", entityType: "CUSTOMER", entityId: id, after: input });
    }
    revalidatePath("/customers"); revalidatePath("/");
    return { ok: true, message: input.id ? "客户档案已更新" : "客户档案已创建" };
  } catch (error) {
    const message = error instanceof Error && /UNIQUE/.test(error.message) ? "客户名称已存在" :
      error instanceof Error ? error.message : "保存失败";
    return { ok: false, message };
  }
}

export async function toggleCustomer(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const { db, user } = await currentUser();
  const scope = customerScopeSql(user);
  const before = db.prepare(`SELECT * FROM customers c WHERE c.id = ? AND ${scope.sql}`)
    .get(id, ...scope.params) as Record<string, unknown> | undefined;
  if (!before) throw new Error("客户不存在或无权修改");
  const active = Number(before.active) ? 0 : 1;
  db.prepare("UPDATE customers SET active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(active, id);
  writeAudit(db, { userId: user.id, action: active ? "RESTORE" : "DEACTIVATE", entityType: "CUSTOMER", entityId: id,
    before, after: { active } });
  revalidatePath("/customers"); revalidatePath("/");
}
