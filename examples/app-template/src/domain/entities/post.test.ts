import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors/domain.js';
import { PostEntity } from './post.js';

function draftPost(): PostEntity {
  return PostEntity.create({
    id: 'post-1',
    title: 'Hello',
    body: 'Text',
    status: 'draft',
    publishAt: null,
    emailSubscribers: false,
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

  it('schedule stores a future time and scheduled status', () => {
    const at = new Date(Date.now() + 60_000).toISOString();
    const scheduled = draftPost().schedule({
      publishAt: at,
      emailSubscribers: true,
    });
    expect(scheduled.props.status).toBe('scheduled');
    expect(scheduled.props.emailSubscribers).toBe(true);
    expect(scheduled.props.publishAt).toBe(new Date(at).toISOString());
  });

  it('schedule rejects a past time', () => {
    const at = new Date(Date.now() - 60_000).toISOString();
    expect(() =>
      draftPost().schedule({ publishAt: at, emailSubscribers: false }),
    ).toThrow(DomainError);
  });

  it('cancelSchedule returns a draft and clears the time', () => {
    const at = new Date(Date.now() + 60_000).toISOString();
    const draft = draftPost()
      .schedule({ publishAt: at, emailSubscribers: true })
      .cancelSchedule();
    expect(draft.props.status).toBe('draft');
    expect(draft.props.publishAt).toBeNull();
    expect(draft.props.emailSubscribers).toBe(false);
  });

  it('publish on a scheduled post clears publishAt', () => {
    const at = new Date(Date.now() + 60_000).toISOString();
    const published = draftPost()
      .schedule({ publishAt: at, emailSubscribers: true })
      .publish();
    expect(published.props.status).toBe('published');
    expect(published.props.publishAt).toBeNull();
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
