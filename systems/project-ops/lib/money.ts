export function parseMoneyToCents(value: string): number {
  const normalized = value.trim().replace(/[,，￥¥\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) throw new Error("金额格式不正确");
  const [yuan, decimal = ""] = normalized.split(".");
  const cents = Number(yuan) * 100 + Number(decimal.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error("金额必须大于0且不能超出范围");
  return cents;
}

export function formatCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error("金额不是安全整数");
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function formatMetricCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error("金额不是安全整数");
  if (Math.abs(cents) < 1_000_000) return formatCents(cents);
  return `${new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    useGrouping: false,
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.abs(cents) >= 1_000_000_000 ? 1 : 2,
  }).format(cents / 1_000_000)} 万`;
}

export function formatBasisPoints(basisPoints: number): string {
  if (!Number.isInteger(basisPoints)) throw new Error("比例不是整数基点");
  return `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(basisPoints / 100)}%`;
}

export function multiplyBasisPoints(cents: number, basisPoints: number): number {
  if (!Number.isSafeInteger(cents) || !Number.isInteger(basisPoints) || cents < 0 || basisPoints < 0) {
    throw new Error("提成计算参数不正确");
  }
  return Math.round((cents * basisPoints) / 10_000);
}
