// Slot 注册中心（01 §6 简化版：仅 keyed 'main' 面板；页面模块 import 即自注册）
import type { ComponentType } from 'react';

export interface MainPanelDef {
  id: string;
  label: string;
  order: number;
  component: ComponentType;
}

const panels: MainPanelDef[] = [];

export function registerPanel(def: MainPanelDef): void {
  if (panels.some((p) => p.id === def.id)) return;
  panels.push(def);
  panels.sort((a, b) => a.order - b.order);
}

export function listPanels(): MainPanelDef[] {
  return [...panels];
}
