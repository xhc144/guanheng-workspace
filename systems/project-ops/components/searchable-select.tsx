"use client";

import { useId, useState } from "react";
import { labelSearchChoices, type SearchChoice } from "@/lib/search-options.ts";

export type SearchOption = SearchChoice;

export function SearchableSelect({ name, options, defaultValue = "", placeholder = "输入名称搜索", required, ariaLabel, onValueChange }: {
  name: string;
  options: SearchOption[];
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  ariaLabel?: string;
  onValueChange?: (value: string) => void;
}) {
  const listId = useId(), choices = labelSearchChoices(options), initial = choices.find(option => option.id === defaultValue)?.label ?? "";
  const [text, setText] = useState(initial), [value, setValue] = useState(defaultValue);
  function change(next: string, input: HTMLInputElement) {
    const match = choices.find(option => option.label === next);
    input.setCustomValidity(next && !match ? "请从建议列表中选择" : "");
    setText(next); setValue(match?.id ?? ""); onValueChange?.(match?.id ?? "");
  }
  return <><input aria-autocomplete="list" aria-label={ariaLabel} autoComplete="off" list={listId} placeholder={placeholder} required={required} value={text} onChange={event => change(event.target.value, event.currentTarget)}/><input name={name} type="hidden" value={value}/><datalist id={listId}>{choices.map(option => <option key={option.id} value={option.label}/>)}</datalist></>;
}
