export interface AppContext {
  requestId: string;
}

export const defaultContext: AppContext = { requestId: 'boot' };
