---
title: Concepts
description: What each Hexok primitive is for, with a figurative use and the API.
---

Each primitive has a short page: what it is, the problem it solves, how a feature uses it, and the API. The example throughout is a blog. A person writes a post and publishes it. Subscribers receive an email afterward.

| Primitive | Page |
| --- | --- |
| Entity | [Entity](/hexok/concepts/entity/) |
| Schema | [Schema](/hexok/concepts/schema/) |
| Use case | [UseCase](/hexok/concepts/use-case/) and [UseCase.context](/hexok/concepts/use-case/context/) |
| Port | [Port](/hexok/concepts/port/) |
| Adapter | [Adapter](/hexok/concepts/adapter/) |
| Error | [Error](/hexok/concepts/error/), [Error map](/hexok/concepts/error/map/), and [Coded error](/hexok/concepts/error/coded/) |
| Event | [Event](/hexok/concepts/event/) |
| Event catalog | [EventCatalog](/hexok/concepts/event-catalog/) |
| Event handler | [EventHandler](/hexok/concepts/event-handler/) |

Import them from `hexok`. A use case takes its ports in the constructor. You choose the HTTP library and assemble the object graph in your application.
