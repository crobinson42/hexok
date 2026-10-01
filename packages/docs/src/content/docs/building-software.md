---
title: Building Software - The Patterns
description: How to build one feature from a user story to a running entry point with clean, hexagonal, and onion architecture.
---

Approach each feature in this order. Clean architecture, hexagonal architecture, and onion architecture start from the same place: one user story, carried through to a running entry point. The running example is a user who creates a blog post and publishes it.

## Start with one story

Every later choice follows from one thing a person can do. Say who acts and what they can do: a user creates a blog post and publishes it. That story is the use case.

## Define the entity and schema

The story names what you store. Creating and publishing a post means persisting a blog post, so define that entity and the schema of its data: an id, a title, a body, and whether the post is published.

## Define the use case and ports

Write the use case as the story itself: create the post and publish it. Saving the post is a port, a dependency the use case calls. When that use case or port already exists, use it.

## Publish side effects

Publishing can cause work that belongs with the event, such as emailing subscribers. The use case publishes an event, and an event handler sends the email. Define the event and the handler when they are not already there. When the use case should announce the publish, give it an event-publisher port and publish inside `execute`.

## Implement the handlers

Implement the handler so that it receives the published-post event and sends the email.

## Implement the adapters

Each port needs an implementation before the feature can run. Add an adapter for saving posts, publishing events, subscribing handlers, and sending email. An adapter is the concrete implementation of a port. The use case and the handlers keep calling the ports.

## Add the gateway

A caller outside the process needs a way to reach the use case. That way is the gateway. It might be HTTP (REST or an RPC-style path), websockets, or gRPC. The common choice is an HTTP path in an RPC shape, one path for this use case. You choose the library: Express, Hono, Koa, or similar. The gateway accepts the call, runs the use case, and returns the result.

## Choose where handlers run

Decide which process runs the handlers. They may share the API process. When a handler does heavy work, and an adapter can publish in one process and subscribe in another, give that handler a background-worker entry point. The API entry point publishes. The worker subscribes and runs the handler.

The [Concepts](/hexok/concepts/) pages open these steps into the primitives: [Entity](/hexok/concepts/entity/), [Schema](/hexok/concepts/schema/), [UseCase](/hexok/concepts/use-case/), [Port](/hexok/concepts/port/), [Adapter](/hexok/concepts/adapter/), [Error](/hexok/concepts/error/), [Event](/hexok/concepts/event/), [EventCatalog](/hexok/concepts/event-catalog/), and [EventHandler](/hexok/concepts/event-handler/).
