import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors/domain.js';
import { UserEntity } from './user.js';

function user(): UserEntity {
  return UserEntity.create({
    id: 'ada',
    name: 'Ada',
    organizationIds: [],
  });
}

describe('UserEntity', () => {
  it('addMembership appends the organization id', () => {
    expect(user().addMembership('hexok').props.organizationIds).toEqual([
      'hexok',
    ]);
  });

  it('requireMember throws NotAMember when the id is missing', () => {
    expect(() => user().requireMember('hexok')).toThrow(DomainError);
    try {
      user().requireMember('hexok');
    } catch (error) {
      expect(DomainError.is(error) && error.code === 'NotAMember').toBe(true);
    }
  });

  it('addMembership throws AlreadyMember when the id is already there', () => {
    const member = user().addMembership('hexok');
    expect(() => member.addMembership('hexok')).toThrow(DomainError);
    try {
      member.addMembership('hexok');
    } catch (error) {
      expect(DomainError.is(error) && error.code === 'AlreadyMember').toBe(
        true,
      );
    }
  });
});
