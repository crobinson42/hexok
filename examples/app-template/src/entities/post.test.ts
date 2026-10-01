import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors/domain.js';
import { PostEntity } from './post.js';

function draftPost(): PostEntity {
  return PostEntity.create({
    id: 'post-1',
    title: 'Hello',
    body: 'Text',
    status: 'draft',
  });
}

describe('PostEntity', () => {
  it('publish on a draft sets status to published', () => {
    const published = draftPost().publish();
    expect(published.props.status).toBe('published');
  });

  it('publish on a published post throws AlreadyPublished', () => {
    const published = draftPost().publish();
    expect(() => published.publish()).toThrow(DomainError);
    try {
      published.publish();
    } catch (error) {
      expect(DomainError.is(error) && error.code === 'AlreadyPublished').toBe(
        true,
      );
    }
  });

  it('unpublish on a published post sets status to draft', () => {
    const draft = draftPost().publish().unpublish();
    expect(draft.props.status).toBe('draft');
  });

  it('unpublish on a draft throws NotPublished', () => {
    const draft = draftPost();
    expect(() => draft.unpublish()).toThrow(DomainError);
    try {
      draft.unpublish();
    } catch (error) {
      expect(DomainError.is(error) && error.code === 'NotPublished').toBe(true);
    }
  });
});
