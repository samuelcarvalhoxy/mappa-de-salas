// The URL belongs to this tab. Never keep the selected unit in a shared cookie/global variable.
export function unitHeaders(): Record<string,string> {
  if (typeof window === "undefined") return {};
  const unit=new URLSearchParams(window.location.search).get("unit");
  return unit ? {"x-mappa-unit":unit} : {};
}
export function unitExportName(filename: string) {
  const unit=typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("unit");
  return unit ? `${unit}-${filename}` : filename;
}
