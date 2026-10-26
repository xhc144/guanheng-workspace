import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronsUpDown, Search } from "lucide-react";
import { FilterDisclosure } from "@/components/filter-disclosure";
import type { ReactNode } from "react";
import { tableQueryHref, type TableQuery } from "@/lib/table-query";
import { withBasePath } from "@/lib/base-path";

export function TableSortHeader({ action, className, column, defaultDirection = "asc", hidden = {}, label, prefix, query }: {
  action: string;
  className?: string;
  column: string;
  defaultDirection?: "asc" | "desc";
  hidden?: Record<string, string>;
  label: string;
  prefix: string;
  query: TableQuery;
}) {
  const active = query.sort === column;
  const direction = active ? query.direction : defaultDirection;
  const nextDirection = active && query.direction === "asc" ? "desc" : active ? "asc" : defaultDirection;
  const Icon = active ? direction === "asc" ? ArrowUp : ArrowDown : ChevronsUpDown;
  return <th aria-sort={active ? direction === "asc" ? "ascending" : "descending" : "none"} className={className}>
    <Link className={`sort-link${active ? " active" : ""}`} href={tableQueryHref(action,prefix,{...query,sort:column,direction:nextDirection},1,hidden)}>{label}<Icon aria-hidden="true" size={13}/></Link>
  </th>;
}

export function TableQueryControls({ action, columns, facets = [], hidden = {}, prefix, query }: {
  action: string;
  columns: { value: string; label: string }[];
  facets?: { value: string; label: string; options: { value: string; label: string }[] }[];
  hidden?: Record<string, string>;
  prefix: string;
  query: TableQuery;
}) {
  const name = (value: string) => `${prefix}${value}`;
  const active = Boolean(query.q || Object.keys(query.filters).length || query.sort !== "none" || query.direction !== "asc" || query.pageSize !== 50);
  const clearParams = new URLSearchParams(hidden).toString();
  return <FilterDisclosure active={active}>
    <form action={withBasePath(action)} className="table-toolbar" method="get">
      {Object.entries(hidden).map(([key, value]) => <input key={key} name={key} type="hidden" value={value}/>)}
      <label className="table-search"><span>搜索</span><span className="table-input"><Search aria-hidden="true" size={15}/><input autoComplete="off" defaultValue={query.q} name={name("Q")} placeholder="输入关键字…" spellCheck={false}/></span></label>
      {facets.map((facet) => <label key={facet.value}><span>{facet.label}</span><select defaultValue={query.filters[facet.value]??""} name={name(facet.value)}><option value="">全部{facet.label}</option>{facet.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>)}
      <label><span>排序</span><select defaultValue={query.sort} name={name("Sort")}><option value="none">保持原顺序</option>{columns.map((column) => <option key={column.value} value={column.value}>{column.label}</option>)}</select></label>
      <label><span>顺序</span><select defaultValue={query.direction} name={name("Dir")}><option value="asc">升序</option><option value="desc">降序</option></select></label>
      <label><span>每页</span><select defaultValue={query.pageSize} name={name("Size")}><option value="25">25 条</option><option value="50">50 条</option><option value="100">100 条</option></select></label>
      <div className="table-toolbar-actions"><button className="primary-button" type="submit">应用筛选</button>{active&&<Link className="secondary-button" href={clearParams?`${action}?${clearParams}`:action}>清除</Link>}</div>
    </form>
  </FilterDisclosure>;
}

export function TableQueryFrame({ action, columns, facets, hidden, page, pageCount, prefix, query, total, children }: {
  action: string;
  columns: { value: string; label: string }[];
  facets?: { value: string; label: string; options: { value: string; label: string }[] }[];
  hidden?: Record<string, string>;
  page: number;
  pageCount: number;
  prefix: string;
  query: TableQuery;
  total: number;
  children: ReactNode;
}) {
  const preserved = hidden ?? {};
  const start = total ? (page - 1) * query.pageSize + 1 : 0;
  const end = Math.min(page * query.pageSize, total);
  const sortLabel = columns.find((column) => column.value === query.sort)?.label;
  return <div className="server-table">
    <TableQueryControls action={action} columns={columns} facets={facets} hidden={preserved} prefix={prefix} query={query}/>
    <div aria-live="polite" className="table-view-summary">显示 {start}–{end} / {total} 条 · {sortLabel?`按${sortLabel}${query.direction==="asc"?"升序":"降序"}排列`:"按默认顺序排列"} · 点击列名可排序</div>
    <div className="table-wrap">{children}</div>
    {pageCount>1&&<nav aria-label="表格分页" className="table-pagination"><span className="pagination-summary">{start}–{end} / {total}</span>{page>1?<Link href={tableQueryHref(action,prefix,query,page-1,preserved)}>上一页</Link>:<span aria-disabled="true">上一页</span>}{page<pageCount?<Link href={tableQueryHref(action,prefix,query,page+1,preserved)}>下一页</Link>:<span aria-disabled="true">下一页</span>}</nav>}
  </div>;
}
