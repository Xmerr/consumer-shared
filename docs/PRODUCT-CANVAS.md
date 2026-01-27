# Product Canvas: consumer-shared

> Last updated: 2026-01-27
> Status: Active

## Overview

**One-liner:** Shared infrastructure library that provides RabbitMQ connection management, base consumer/publisher abstractions, DLQ retry logic, structured logging, and error classes for all consumer microservices.

---

## Target User

**Primary Persona:** Yourself — solo developer building consumer microservices on the Consumers platform

| Attribute | Value |
|-----------|-------|
| Skill Level | Expert |
| Key Frustration | Reimplementing the same RabbitMQ boilerplate (connection recovery, retry logic, DLQ handling, logging) in every new consumer service |
| Current Solution | Without this library: copy-pasting infrastructure code between services, leading to drift and inconsistency |
| Frequency of Problem | Every time a new consumer service is created |

**User Quote (representative):**
> "I want to write `processMessage()` and be done. Connection recovery, retries, DLQ, logging — that should just work."

---

## Core Problem

**Problem Statement:**
Every consumer microservice needs the same infrastructure: RabbitMQ connection with reconnection, message consumption with ack/nack, DLQ retry with exponential backoff, structured logging to Loki, and typed error classes. Without a shared library, each service reimplements this independently, causing behavioral drift between services and slowing down new service creation.

**Problem Severity:**
| Dimension | Rating |
|-----------|--------|
| Frequency | Every new service |
| Impact | Painful |
| Urgency | Important |

**What happens if unsolved:**
Two failures compound. First, services drift apart — one retries 10 times, another 20; DLQ formats differ; logging labels are inconsistent. Subtle bugs emerge from inconsistency. Second, every new service takes significantly longer to build because infrastructure code must be copied, adapted, and tested from scratch each time.

---

## Value Proposition

**Why us:**
A single, tested source of truth for all RabbitMQ infrastructure behavior, ensuring every consumer service behaves identically without duplicating code.

**Key Differentiators:**
1. **Reliability first** — Connection recovery, retry logic, and DLQ handling are bulletproof. If this library fails, every service fails.
2. **Convention over configuration** — Sensible defaults match the platform standard (exchange types, retry backoff, DLQ routing) without per-service tuning.
3. **Minimal API surface** — Extend `BaseConsumer`, implement `processMessage()`, done. Infrastructure concerns are invisible to service authors.

**Alternatives & Why We're Better:**
| Alternative | Their Weakness | Our Strength |
|-------------|----------------|--------------|
| Copy-paste per service | Drift, inconsistency, duplicated bugs | Single source of truth, fix once, all services benefit |
| amqp-connection-manager | Generic — doesn't encode our DLQ standard, retry policy, or logging conventions | Purpose-built for this platform's exact conventions |
| rascal | Heavyweight config-driven approach, large API surface | Minimal, opinionated, matches our patterns exactly |

---

## Success Metrics

**North Star Metric:** Zero infrastructure-related failures in production — connection recovery, retry logic, and DLQ alerting all work flawlessly.

| Metric | Current | 6-Month Target | Why It Matters |
|--------|---------|----------------|----------------|
| Infrastructure failure rate | N/A (not built) | 0 unrecovered connection drops, 0 lost messages | If the shared lib fails, every service fails |
| Service adoption | 0 | 100% of consumer services depend on consumer-shared | No service should reimplement infrastructure |
| New service onboarding | N/A | Business logic only — infrastructure is inherited | Validates the library is actually reducing effort |
| Test coverage | N/A | 95%+ maintained at all times | Confidence that changes don't break consuming services |

---

## Anti-Goals

**We are explicitly NOT:**

1. **An application framework**
   - Why not: No CLI scaffolding, no project generator, no prescribed folder structure. This is a library, not a framework. Services own their own structure.

2. **A multi-broker abstraction**
   - Why not: Only supports RabbitMQ via amqplib. No Kafka, Redis Streams, or generic broker interface. The platform is committed to RabbitMQ — abstracting over brokers adds complexity with zero benefit.

3. **A public npm package**
   - Why not: Consumed as a `file:` dependency by sibling projects. No npm publish, no semver guarantees to external users, no public API stability promises.

4. **A home for business logic**
   - Why not: Infrastructure only. No torrent logic, no notification formatting, no domain-specific code. If it's specific to one service, it belongs in that service.

5. **An HTTP layer**
   - Why not: No Express, Hono, or Fastify. This is a RabbitMQ infrastructure library. Services that need HTTP endpoints build that themselves.

6. **A database layer**
   - Why not: No ORM, no database client, no migrations. If a service needs persistence, it handles that independently.

**Feature requests to auto-reject:**
- HTTP server or routing capabilities
- Database client or ORM integration
- Kafka, Redis Streams, or other broker support
- CLI tools or project scaffolding
- Domain-specific business logic
- npm publish or public package distribution

---

## Constraints

| Constraint | Impact on Decisions |
|------------|---------------------|
| Bun runtime only | Must work under Bun — no Node-specific APIs or packages that don't run in Bun |
| amqplib dependency | Committed to amqplib as the RabbitMQ client. No switching to rascal, amqp-connection-manager, or other wrappers. |
| Minimal dependencies | Dependency tree stays small: amqplib, pino, pino-loki. Every new dependency must justify itself. |
| Platform conventions | Must encode the platform's exact standards: topic exchanges with `{ durable: true }`, 20 retries with exponential backoff capped at 16 hours, `{queue}.dlq` naming, `notifications.dlq.{service-name}` alert routing. |
| Library, not service | No `index.ts` entrypoint that starts a process. Exports only. Consuming services own their lifecycle. |

---

## Feature Evaluation Checklist

Use this checklist when evaluating any proposed addition to consumer-shared:

- [ ] **Target User:** Does this serve the solo developer building consumer services?
- [ ] **Problem:** Does this eliminate boilerplate or enforce consistency across services?
- [ ] **Differentiator:** Does this strengthen reliability, convention-over-configuration, or API simplicity?
- [ ] **Metrics:** Will this improve infrastructure reliability, adoption, onboarding speed, or test confidence?
- [ ] **Anti-goals:** Is this infrastructure-only? Not business logic, not HTTP, not database, not multi-broker?
- [ ] **Constraints:** Does this work under Bun, stay within the minimal dependency budget, and follow platform conventions?

**Scoring:**
- 6/6 checks: Strong candidate
- 4-5/6 checks: Discuss trade-offs
- <4/6 checks: Likely reject or defer

---

## Changelog

| Date | Change | Reason |
|------|--------|--------|
| 2026-01-27 | Created canvas | Initial strategy definition for shared infrastructure library |
