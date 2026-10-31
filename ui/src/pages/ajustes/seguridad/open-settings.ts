export type SettingsFocus = "security" | "approvals" | "setup";

export function openSettings(category: SettingsFocus) {
  window.dispatchEvent(new CustomEvent<SettingsFocus>("winecore-settings", { detail: category }));
}
