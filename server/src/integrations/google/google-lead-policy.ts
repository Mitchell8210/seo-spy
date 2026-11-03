export interface Ga4LeadPolicy { eventName: string; pagePaths: string[] }
const excluded = new Set(["page_view", "session_start", "first_visit", "user_engagement", "scroll", "form_start", "click", "contact_link_click"]);
export function leadPagePaths(value: string) {
  const paths = value.split(",").map(path => path.trim()).filter(Boolean);
  if (paths.length > 10 || paths.some(path => !path.startsWith("/") || path.length > 512 || /[?#\s]/.test(path) || path.includes("*"))) return null;
  return [...new Set(paths)].sort();
}
export function leadPolicy(eventName: string, paths: string): Ga4LeadPolicy | null {
  const pagePaths = leadPagePaths(paths);
  if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(eventName) || excluded.has(eventName) || pagePaths === null || eventName === "form_submit" && !pagePaths.length) return null;
  return { eventName, pagePaths };
}
