import { CloseIncident } from './use-cases/close-incident.js';
import { CreateIncident } from './use-cases/create-incident.js';
import { GetIncident } from './use-cases/get-incident.js';
import { ListIncidents } from './use-cases/list-incidents.js';
import { NotifyOnClose } from './use-cases/notify-on-close.js';
import { RelocateSite } from './use-cases/relocate-site.js';
import { UpdateIncident } from './use-cases/update-incident.js';

export const useCases = {
  create: CreateIncident,
  get: GetIncident,
  list: ListIncidents,
  update: UpdateIncident,
  close: CloseIncident,
  notify: NotifyOnClose,
  relocate: RelocateSite,
};

export {
  CloseIncident,
  CreateIncident,
  GetIncident,
  ListIncidents,
  NotifyOnClose,
  RelocateSite,
  UpdateIncident,
};
