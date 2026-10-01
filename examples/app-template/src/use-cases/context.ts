import { UseCase } from 'hexok';
import { DomainError } from '../errors/domain.js';

export type AppCtx = {
  ipAddress: string;
};

export function ipAddressGuard({ ctx }: { ctx: AppCtx }): void {
  if (ctx.ipAddress.length < 1) {
    throw DomainError.IpAddressMissing();
  }
}

export const AppUseCase = UseCase.context<AppCtx>().guard(ipAddressGuard);
