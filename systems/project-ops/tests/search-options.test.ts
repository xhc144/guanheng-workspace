import assert from "node:assert/strict";
import test from "node:test";
import { labelSearchChoices } from "../lib/search-options.ts";

test("duplicate search names receive unique contextual labels",()=>{
  const choices=labelSearchChoices([{id:"p1",name:"同名项目",detail:"甲客户"},{id:"p2",name:"同名项目",detail:"乙客户"},{id:"p3",name:"唯一项目"}]);
  assert.deepEqual(choices.map(choice=>choice.label),["同名项目 · 甲客户","同名项目 · 乙客户","唯一项目"]);
  assert.notEqual(choices[0]?.label,choices[1]?.label);
});

test("duplicate context still falls back to the stable id",()=>{
  const choices=labelSearchChoices([{id:"p1",name:"同名项目",detail:"甲客户"},{id:"p2",name:"同名项目",detail:"甲客户"}]);
  assert.deepEqual(choices.map(choice=>choice.label),["同名项目 · 甲客户 · p1","同名项目 · 甲客户 · p2"]);
});
