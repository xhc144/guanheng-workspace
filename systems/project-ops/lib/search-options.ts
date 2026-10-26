export type SearchChoice = { id: string; name: string; detail?: string };

export function labelSearchChoices(options: SearchChoice[]) {
  const nameCounts = new Map<string, number>();
  for (const option of options) nameCounts.set(option.name, (nameCounts.get(option.name) ?? 0) + 1);
  const baseLabels = options.map(option => nameCounts.get(option.name)! > 1 ? `${option.name} · ${option.detail ?? option.id}` : option.name);
  const labelCounts = new Map<string, number>();
  for (const label of baseLabels) labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  return options.map((option, index) => ({ ...option, label: labelCounts.get(baseLabels[index]!)! > 1 ? `${baseLabels[index]} · ${option.id}` : baseLabels[index]! }));
}
