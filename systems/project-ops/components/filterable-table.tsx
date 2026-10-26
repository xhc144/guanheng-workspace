"use client";

import { ArrowDown, ArrowUp, ChevronsUpDown, Search } from "lucide-react";
import { Children, cloneElement, isValidElement, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactElement, type ReactNode, useMemo, useRef, useState } from "react";
import { FilterDisclosure } from "@/components/filter-disclosure";

type NodeElement = ReactElement<{ children?: ReactNode; "aria-sort"?: "ascending" | "descending" | "none" }>;
type Filters = { query: string; sort: string; direction: "asc" | "desc"; pageSize: number; facets: Record<string, string> };

const defaults: Filters = { query: "", sort: "none", direction: "asc", pageSize: 50, facets: {} };
const unsortable = new Set(["操作", "查看", "下钻", "选择"]);
const facetableHeader = /状态|类型|角色|部门|来源|条件|方式|有效性/;
const minimumColumnWidth = 88;

export function ResizableTables({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    const header = target.closest("th") as HTMLTableCellElement | null;
    if (!header || !root.current?.contains(header) || header.getBoundingClientRect().right - event.clientX > 10) return;
    const table = header.closest("table");
    if (!table) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = header.getBoundingClientRect().width;
    const startTableWidth = table.getBoundingClientRect().width;
    table.style.tableLayout = "fixed";
    table.style.width = `${startTableWidth}px`;
    document.body.classList.add("is-resizing-column");
    const move = (next: PointerEvent) => {
      const width = Math.max(minimumColumnWidth, startWidth + next.clientX - startX);
      header.style.width = `${width}px`;
      table.style.width = `${Math.max(startTableWidth, startTableWidth + width - startWidth)}px`;
    };
    const stop = () => {
      document.body.classList.remove("is-resizing-column");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
  }

  return <div className="resizable-tables" onPointerDown={startResize} ref={root}>{children}</div>;
}

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  if (isValidElement(node)) return textOf((node as NodeElement).props.children);
  return "";
}

function childElements(node: ReactNode) {
  return Children.toArray(node).filter(isValidElement) as NodeElement[];
}

function compareText(left: string, right: string) {
  const clean = (value: string) => value.replace(/[\s,¥￥%]/g, "");
  const leftNumber = Number(clean(left));
  const rightNumber = Number(clean(right));
  if (clean(left) && clean(right) && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
  return left.localeCompare(right, "zh-CN", { numeric: true, sensitivity: "base" });
}

export function FilterableTable({ children }: { children: ReactNode }) {
  const form = useRef<HTMLFormElement>(null);
  const [filters, setFilters] = useState(defaults);
  const [page, setPage] = useState(1);
  const table = Children.toArray(children).find(isValidElement);
  const parts = useMemo(() => {
    if (!isValidElement(table) || table.type !== "table") return null;
    const tableElement = table as NodeElement;
    const tableChildren = childElements(tableElement.props.children);
    const bodyIndex = tableChildren.findIndex((child) => child.type === "tbody");
    const body = tableChildren[bodyIndex];
    const headIndex = tableChildren.findIndex((child) => child.type === "thead");
    const head = tableChildren[headIndex];
    const headChildren = head ? childElements(head.props.children) : [];
    const headerRowIndex = headChildren.findIndex((child) => child.type === "tr");
    const headerRow = headChildren[headerRowIndex];
    const headers = headerRow ? childElements(headerRow.props.children).map((cell, index) => textOf(cell).trim() || `第 ${index + 1} 列`) : [];
    const rows = body ? childElements(body.props.children).filter((child) => child.type === "tr") : [];
    return { tableElement, tableChildren, bodyIndex, body, headIndex, head, headChildren, headerRowIndex, headerRow, headers, rows };
  }, [table]);

  if (!parts?.body || parts.bodyIndex < 0) return <div className="table-wrap">{children}</div>;

  const indexedRows = parts.rows.map((row, index) => ({
    row,
    index,
    cells: childElements(row.props.children).map((cell) => textOf(cell).replace(/\s+/g, " ").trim()),
  }));
  const facetColumns = parts.headers.flatMap((header, index) => {
    if (!facetableHeader.test(header)) return [];
    const options = [...new Set(indexedRows.map((row) => row.cells[index]).filter(Boolean))].sort((left, right) => compareText(left, right));
    return options.length > 1 && options.length <= 20 ? [{ header, index, options }] : [];
  });
  const query = filters.query.toLocaleLowerCase("zh-CN");
  const filteredRows = indexedRows.filter(({ cells }) => {
    if (!query) return true;
    return cells.join(" ").toLocaleLowerCase("zh-CN").includes(query);
  }).filter(({ cells }) => Object.entries(filters.facets).every(([column, value]) => !value || cells[Number(column)] === value));
  if (filters.sort !== "none") {
    const column = Number(filters.sort);
    filteredRows.sort((left, right) => {
      const compared = compareText(left.cells[column] ?? "", right.cells[column] ?? "");
      return (filters.direction === "desc" ? -compared : compared) || left.index - right.index;
    });
  }
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / filters.pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleRows = filteredRows.slice((currentPage - 1) * filters.pageSize, currentPage * filters.pageSize).map(({ row }) => row);
  const visibleBody = cloneElement(parts.body, {}, visibleRows);
  const visibleHead = parts.head && parts.headerRow ? cloneElement(parts.head, {}, parts.headChildren.map((row, rowIndex) => rowIndex === parts.headerRowIndex ? cloneElement(parts.headerRow!, {}, childElements(parts.headerRow!.props.children).map((cell, index) => {
    const label = parts.headers[index];
    if (!label || unsortable.has(label)) return cell;
    const activeSort = filters.sort === String(index);
    const Icon = activeSort ? filters.direction === "asc" ? ArrowUp : ArrowDown : ChevronsUpDown;
    return cloneElement(cell, { "aria-sort": activeSort ? filters.direction === "asc" ? "ascending" : "descending" : "none" }, <button className={`sort-link${activeSort ? " active" : ""}`} onClick={() => sortByColumn(index)} type="button">{cell.props.children}<Icon aria-hidden="true" size={13}/></button>);
  })) : row)) : parts.head;
  const visibleTable = cloneElement(parts.tableElement, {}, parts.tableChildren.map((child, index) => index === parts.bodyIndex ? visibleBody : index === parts.headIndex ? visibleHead : child));
  const active = Boolean(filters.query || Object.keys(filters.facets).length || filters.sort !== "none" || filters.direction !== "asc" || filters.pageSize !== 50);
  const start = filteredRows.length ? (currentPage - 1) * filters.pageSize + 1 : 0;
  const end = Math.min(currentPage * filters.pageSize, filteredRows.length);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const pageSize = Number(data.get("pageSize"));
    setFilters({
      query: String(data.get("query") ?? "").trim(),
      sort: String(data.get("sort") ?? "none"),
      direction: data.get("direction") === "desc" ? "desc" : "asc",
      pageSize: [25, 50, 100].includes(pageSize) ? pageSize : 50,
      facets: Object.fromEntries(facetColumns.map(({ index }) => [String(index), String(data.get(`facet_${index}`) ?? "")]).filter(([, value]) => value)),
    });
    setPage(1);
  }

  function clearFilters() {
    form.current?.reset();
    setFilters(defaults);
    setPage(1);
  }

  function sortByColumn(index: number) {
    const sort = String(index);
    const direction = filters.sort === sort && filters.direction === "asc" ? "desc" : "asc";
    const sortSelect = form.current?.elements.namedItem("sort") as HTMLSelectElement | null;
    const directionSelect = form.current?.elements.namedItem("direction") as HTMLSelectElement | null;
    if (sortSelect) sortSelect.value = sort;
    if (directionSelect) directionSelect.value = direction;
    setFilters((current) => ({ ...current, sort, direction }));
    setPage(1);
  }

  return (
    <div className="filterable-table">
      <FilterDisclosure active={active}>
        <form className="table-toolbar" onSubmit={applyFilters} ref={form}>
          <label className="table-search"><span>搜索</span><span className="table-input"><Search aria-hidden="true" size={15}/><input autoComplete="off" name="query" placeholder="输入关键字…" spellCheck={false}/></span></label>
          {facetColumns.map(({header,index,options})=><label key={`${header}:${index}`}><span>{header}</span><select name={`facet_${index}`}><option value="">全部{header}</option>{options.map(option=><option key={option} value={option}>{option}</option>)}</select></label>)}
          <label><span>排序</span><select name="sort"><option value="none">保持原顺序</option>{parts.headers.map((header, index) => !unsortable.has(header) && <option key={`${header}:${index}`} value={index}>{header}</option>)}</select></label>
          <label><span>顺序</span><select name="direction"><option value="asc">升序</option><option value="desc">降序</option></select></label>
          <label><span>每页</span><select defaultValue="50" name="pageSize"><option value="25">25 条</option><option value="50">50 条</option><option value="100">100 条</option></select></label>
          <div className="table-toolbar-actions"><button className="primary-button" type="submit">应用筛选</button>{active && <button className="secondary-button" onClick={clearFilters} type="button">清除</button>}</div>
        </form>
      </FilterDisclosure>
      <div aria-live="polite" className="table-view-summary">显示 {start}–{end} / {filteredRows.length} 条{filteredRows.length !== parts.rows.length ? ` · 原共 ${parts.rows.length} 条` : ""} · {filters.sort!=="none"?`按${parts.headers[Number(filters.sort)]}${filters.direction==="asc"?"升序":"降序"}排列`:"按默认顺序排列"} · 点击列名可排序</div>
      <div className="table-wrap">{visibleTable}</div>
      {pageCount > 1 && <nav aria-label="表格分页" className="table-pagination"><span className="pagination-summary">{start}–{end} / {filteredRows.length}</span><button disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} type="button">上一页</button><button disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)} type="button">下一页</button></nav>}
    </div>
  );
}
