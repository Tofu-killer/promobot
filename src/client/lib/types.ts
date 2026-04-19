import type { ReactNode } from 'react';

export type AppRoute =
  | 'dashboard'
  | 'queue'
  | 'projects'
  | 'discovery'
  | 'generate'
  | 'drafts'
  | 'review'
  | 'calendar'
  | 'inbox'
  | 'monitor'
  | 'reputation'
  | 'channels'
  | 'settings';

export interface NavItem {
  id: AppRoute;
  label: string;
  description: string;
}

export interface PageSectionProps {
  title: string;
  eyebrow?: string;
  description: string;
  children?: ReactNode;
}
