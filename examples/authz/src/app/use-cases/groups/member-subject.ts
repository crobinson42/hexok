import { DomainError } from '../../../domain/errors/domain.js';
import type { GroupRepository } from '../../ports/repos/group-repository.js';

/** A member subject is a concrete `user:` or `group:` ref. Users have no rows. */
export async function memberSubject(
  groups: GroupRepository,
  subject: string,
): Promise<void> {
  if (subject.includes('#')) throw DomainError.MemberInvalid();
  if (subject.startsWith('user:')) {
    if (subject.length === 'user:'.length) throw DomainError.MemberInvalid();
    return;
  }
  if (subject.startsWith('group:')) {
    const id = subject.slice('group:'.length);
    if (id.length === 0) throw DomainError.MemberInvalid();
    if ((await groups.get(id)) === null) {
      throw DomainError.NotFound({ type: 'group', id });
    }
    return;
  }
  throw DomainError.MemberInvalid();
}
