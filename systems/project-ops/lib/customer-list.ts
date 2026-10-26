export const customerSortColumns = {
  updated: "c.updated_at",
  name: "c.name",
  industry: "COALESCE(c.industry,'')",
  owner: "COALESCE(u.name,'')",
  contracts: "contract_count",
  amount: "contract_cents",
  status: "c.active",
} as const;

export type CustomerSort = keyof typeof customerSortColumns;
export type SortDirection = "asc" | "desc";

export function parseCustomerListQuery(query: Record<string, string | string[] | undefined>) {
  const value = (key: string) => {
    const raw = query[key];
    return typeof raw === "string" ? raw.trim() : "";
  };
  const sort = value("sort") in customerSortColumns ? value("sort") as CustomerSort : "updated";
  const size = Number(value("size"));
  const parsedPage = Number(value("page"));
  return {
    q: value("q"),
    edit: value("edit"),
    agency: ["0", "1", "unknown"].includes(value("agency")) ? value("agency") : "",
    status: ["active", "inactive"].includes(value("status")) ? value("status") : "",
    completeness: ["complete", "missing"].includes(value("completeness")) ? value("completeness") : "",
    industry: value("industry"),
    owner: value("owner"),
    sort,
    direction: value("dir") === "asc" ? "asc" as const : "desc" as const,
    pageSize: [25, 50, 100].includes(size) ? size : 50,
    page: Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1,
  };
}

export function customerOrderBy(sort: CustomerSort, direction: SortDirection) {
  return `${customerSortColumns[sort]} ${direction.toUpperCase()}, c.id ASC`;
}
