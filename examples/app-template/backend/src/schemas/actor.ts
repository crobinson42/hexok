export type Actor = {
  id: string;
  roles: string[];
  permissions: string[];
  type: 'user' | 'system' | 'service';
};