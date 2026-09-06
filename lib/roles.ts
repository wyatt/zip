export const CUSTOMER_ROLES = ["customer", "demo"] as const;
export const OPERATOR_ROLES = ["operator", "admin", "demo"] as const;

export function isCustomerRole(role: string | undefined) {
  return role === "customer" || role === "demo";
}
export function isOperatorRole(role: string | undefined) {
  return role === "operator" || role === "admin" || role === "demo";
}
export function isDemoRole(role: string | undefined) {
  return role === "demo";
}
export function homeForRole(role: string | undefined) {
  return role === "customer" ? "/request" : "/operator";
}
export function canAccessSurface(role: string | undefined, surface: "customer" | "operator" | "fleet" | "settings") {
  if (isDemoRole(role)) return true;
  if (role === "customer") return surface === "customer";
  return surface !== "customer";
}
