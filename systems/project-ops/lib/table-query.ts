export type TableSearchParams = Record<string, string | string[] | undefined>;
export type TableQuery = { q: string; sort: string; direction: "asc" | "desc"; pageSize: number; page: number; filters: Record<string, string> };
export type TableColumn<T> = { value: string; label: string; get: (row: T) => unknown };
export type TableFacet<T> = { value: string; label: string; get: (row: T) => unknown };
export type TableSqlColumn = { value: string; label: string; search?: string[]; orderBy?: string };
export type TableSqlFacet = { value: string; label: string; expression: string };

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] ?? "" : value ?? "";
const key = (prefix: string, name: string) => `${prefix}${name}`;
const text = (value: unknown): string => Array.isArray(value) ? value.map(text).join(" ") : String(value ?? "");

function compare(left: unknown, right: unknown) {
  const a = text(left).trim(), b = text(right).trim();
  const clean = (value: string) => value.replace(/[\s,¥￥%]/g, "");
  const aNumber = Number(clean(a)), bNumber = Number(clean(b));
  if (clean(a) && clean(b) && Number.isFinite(aNumber) && Number.isFinite(bNumber)) return aNumber - bNumber;
  return a.localeCompare(b, "zh-CN", { numeric: true, sensitivity: "base" });
}

export function readTableQuery(params: TableSearchParams, prefix: string, fields: string[], facets: string[] = []): TableQuery {
  const sort = first(params[key(prefix, "Sort")]);
  const pageSize = Number(first(params[key(prefix, "Size")]));
  const page = Number(first(params[key(prefix, "Page")]));
  return {
    q: first(params[key(prefix, "Q")]).trim().slice(0, 200),
    sort: fields.includes(sort) ? sort : "none",
    direction: first(params[key(prefix, "Dir")]) === "desc" ? "desc" : "asc",
    pageSize: [25, 50, 100].includes(pageSize) ? pageSize : 50,
    page: Number.isInteger(page) && page > 0 ? page : 1,
    filters: Object.fromEntries(facets.map((facet) => [facet, first(params[key(prefix, facet)])]).filter(([, value]) => value)),
  };
}

export function filterTableRows<T>(rows: T[], query: TableQuery, columns: TableColumn<T>[], facets: TableFacet<T>[] = []) {
  const needle = query.q.toLocaleLowerCase("zh-CN");
  const filtered = rows.filter((row) => {
    if (needle && !columns.some((column) => text(column.get(row)).toLocaleLowerCase("zh-CN").includes(needle))) return false;
    return facets.every((facet) => !query.filters[facet.value] || text(facet.get(row)) === query.filters[facet.value]);
  });
  const sortColumn = columns.find((column) => column.value === query.sort);
  if (sortColumn) filtered.sort((left, right) => (query.direction === "desc" ? -1 : 1) * compare(sortColumn.get(left), sortColumn.get(right)));
  const pageCount = Math.max(1, Math.ceil(filtered.length / query.pageSize));
  const page = Math.min(query.page, pageCount);
  return { rows: filtered.slice((page - 1) * query.pageSize, page * query.pageSize), filtered, total: filtered.length, page, pageCount };
}

export function tableQueryHref(path: string, prefix: string, query: TableQuery, page: number, extra: Record<string, string> = {}) {
  const params = new URLSearchParams(extra);
  if (query.q) params.set(key(prefix, "Q"), query.q);
  for (const [filter, value] of Object.entries(query.filters)) if (value) params.set(key(prefix, filter), value);
  if (query.sort !== "none") params.set(key(prefix, "Sort"), query.sort);
  if (query.direction !== "asc") params.set(key(prefix, "Dir"), query.direction);
  if (query.pageSize !== 50) params.set(key(prefix, "Size"), String(query.pageSize));
  if (page > 1) params.set(key(prefix, "Page"), String(page));
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

export function tableQueryParams(prefix: string, query: TableQuery, includePage = true) {
  const params = new URLSearchParams(tableQueryHref("/", prefix, query, includePage ? query.page : 1).slice(2));
  return Object.fromEntries(params);
}

export function buildTableSql(query: TableQuery, columns: TableSqlColumn[], facets: TableSqlFacet[], defaultOrder: string) {
  const conditions: string[] = [];
  const params: string[] = [];
  const search = columns.flatMap((column) => column.search ?? []);
  if (query.q && search.length) {
    conditions.push(`(${search.map((expression) => `instr(lower(COALESCE(CAST(${expression} AS TEXT),'')),lower(?))>0`).join(" OR ")})`);
    params.push(...search.map(() => query.q));
  }
  for (const facet of facets) {
    const value = query.filters[facet.value];
    if (value) {
      conditions.push(`${facet.expression}=?`);
      params.push(value);
    }
  }
  const selectedOrder = columns.find((column) => column.value === query.sort)?.orderBy;
  const orderBy = selectedOrder ? `${selectedOrder} ${query.direction.toUpperCase()}` : defaultOrder;
  return { where: conditions.length ? ` AND ${conditions.join(" AND ")}` : "", params, orderBy };
}

export function paginateTable(query: TableQuery, total: number) {
  const pageCount = Math.max(1, Math.ceil(total / query.pageSize));
  const page = Math.min(query.page, pageCount);
  return { page, pageCount, limit: query.pageSize, offset: (page - 1) * query.pageSize };
}
