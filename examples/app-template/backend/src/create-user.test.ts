import { describe, expect, it } from 'vitest';
import { createApp } from './create-user.js';
import { DomainError } from './errors.js';
import { mapError } from './map-error.js';
import { UserCreatedEvent, UserEntity } from './user.js';

describe('CreateUser', () => {
  it('saves a user and refuses a duplicate', async () => {
    const app = createApp();
    const user = await app.createUser.execute({
      id: '1',
      name: 'Ada',
      email: 'ada@ex.com',
    });

    expect(user.props.email).toBe('ada@ex.com');
    expect(user.isNew).toBe(false);

    const event = new UserCreatedEvent(user.toProps());
    expect(app.events.get('userCreated')).toBe(UserCreatedEvent);
    expect(event.payload.id).toBe('1');

    await expect(
      app.createUser.execute({ id: '1', name: 'Ada', email: 'ada@ex.com' }),
    ).rejects.toThrow(DomainError);
    await expect(
      app.createUser.execute({ id: '1', name: 'Ada', email: 'ada@ex.com' }),
    ).rejects.toMatchObject({ code: 'UserExists', catalog: 'domain' });
  });

  it('maps a blank name, a duplicate, and a schema failure', async () => {
    const app = createApp();
    const user = await app.createUser.execute({
      id: '1',
      name: 'Ada',
      email: 'ada@ex.com',
    });
    expect(() => user.rename('  ')).toThrow(DomainError);
    try {
      user.rename('  ');
    } catch (error) {
      expect(mapError(error)).toEqual({
        status: 400,
        body: { code: 'BlankName', message: 'Name is blank' },
      });
    }

    try {
      await app.createUser.execute({
        id: '1',
        name: 'Ada',
        email: 'ada@ex.com',
      });
    } catch (error) {
      expect(mapError(error)).toEqual({
        status: 409,
        body: {
          code: 'UserExists',
          message: 'User already exists',
          id: '1',
        },
      });
    }

    expect(mapError(new Error('boom'))).toEqual({
      status: 500,
      body: { code: 'INTERNAL' },
    });

    expect(() => UserEntity.parse({ id: 1 })).toThrow();
    try {
      UserEntity.parse({ id: 1 });
    } catch (error) {
      expect(mapError(error)).toMatchObject({
        status: 400,
        body: { code: 'VALIDATION' },
      });
    }
  });
});
