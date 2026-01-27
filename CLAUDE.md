# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Shared infrastructure library for all consumer microservices in the [Consumers](../PRODUCT-CANVAS.md) platform. Provides RabbitMQ connection management, base consumer/publisher abstractions, DLQ retry logic, structured logging, and common error classes. Each consumer service depends on this package instead of reimplementing infrastructure concerns.

## Commands

```bash
bun run build          # Compile TypeScript to dist/
bun run lint           # Run Biome linter/formatter
bun run lint:fix       # Auto-fix lint issues
bun test               # Run all tests
bun run test:coverage  # Run tests with coverage (95% threshold)
```

Run a single test file:
```bash
bun test src/config/rabbitmq.test.ts
```

## Architecture

This is a **library**, not a running service. It exports reusable infrastructure components consumed by microservices via package dependency. Follows the **layer-based** structure where each layer groups files by technical role.

```
consumer-shared/
├── src/
│   ├── index.ts                          # Barrel export — public API
│   ├── config/
│   │   ├── index.ts                      # Barrel export for config layer
│   │   ├── rabbitmq.ts                   # ConnectionManager — RabbitMQ connection lifecycle
│   │   └── logger.ts                     # createLogger factory — Pino + Loki
│   ├── consumers/
│   │   └── base.consumer.ts             # Abstract BaseConsumer
│   ├── services/
│   │   └── dlq.service.ts               # DlqHandler — DLQ retry logic with delayed exchange
│   ├── publishers/
│   │   └── base.publisher.ts            # BasePublisher — exchange publishing utility
│   ├── errors/
│   │   └── index.ts                     # RetryableError, NonRetryableError, ConnectionError, ConfigurationError
│   └── types/
│       └── index.ts                     # All shared interfaces
├── package.json
├── tsconfig.json
├── biome.json
└── CLAUDE.md
```

### Layer Responsibilities

| Layer | File | Component | Responsibility |
|-------|------|-----------|----------------|
| `config/` | `rabbitmq.ts` | `ConnectionManager` | RabbitMQ connection lifecycle, channel management, reconnection with exponential backoff |
| `config/` | `logger.ts` | `createLogger` | Pino logger factory with optional `pino-loki` and `pino-pretty` transports |
| `consumers/` | `base.consumer.ts` | `BaseConsumer` | Abstract message consumer — queue assertion, ack/nack, DLQ delegation |
| `services/` | `dlq.service.ts` | `DlqHandler` | DLQ retry orchestration — delayed exchange, retry headers, alerting |
| `publishers/` | `base.publisher.ts` | `BasePublisher` | Exchange publishing utility — JSON serialization, lazy exchange assertion |
| `errors/` | `index.ts` | Error classes | `RetryableError`, `NonRetryableError`, `ConnectionError`, `ConfigurationError` |
| `types/` | `index.ts` | Interfaces | `IConnectionManager`, `IConsumer`, `IPublisher`, `IDlqHandler`, `ILogger` |

### Interfaces

All interfaces are defined in `src/types/index.ts` and exported from the barrel:

```typescript
interface IConnectionManager {
  connect(): Promise<void>;
  getChannel(): Channel;
  close(): Promise<void>;
  on(event: 'reconnected' | 'error', handler: (...args: unknown[]) => void): void;
}

interface IConsumer {
  start(): Promise<void>;
  stop(): Promise<void>;
}

interface IPublisher {
  publish(routingKey: string, content: Record<string, unknown>): Promise<void>;
}

interface IDlqHandler {
  setup(): Promise<void>;
  handleRetryableError(message: ConsumeMessage, error: Error): Promise<void>;
  handleNonRetryableError(message: ConsumeMessage, error: Error): Promise<void>;
}

interface ILogger {
  debug(msg: string, context?: Record<string, unknown>): void;
  info(msg: string, context?: Record<string, unknown>): void;
  warn(msg: string, context?: Record<string, unknown>): void;
  error(msg: string, context?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): ILogger;
}
```

## DLQ Retry Behavior

Follows the platform DLQ standard:

| Attribute | Value |
|-----------|-------|
| Max retries | 20 |
| Backoff strategy | Exponential — instant first retry, doubling each attempt, capping at 16 hours |
| Delayed exchange | `{exchange}.delay` (type: `x-delayed-message`, durable) |
| DLQ queue | `{queue}.dlq` |
| DLQ exchange | `{exchange}.dlq` (topic, durable) |
| Alert routing key | `notifications.dlq.{service-name}` |
| Alert exchange | `notifications` |

### Retry Headers

| Header | Purpose |
|--------|---------|
| `x-retry-count` | Current retry attempt (0-based) |
| `x-first-failure-timestamp` | ISO timestamp of the first failure |
| `x-last-error` | Error message from the most recent failure |

### Backoff Schedule

| Retry | Delay |
|-------|-------|
| 1 | 0ms (instant) |
| 2 | 1s |
| 3 | 2s |
| 4 | 4s |
| 5 | 8s |
| ... | doubles each time |
| 15+ | 16 hours (cap) |

## Exchange Assertions

All exchanges are asserted as `topic` type with `{ durable: true }`. The connection manager and publisher assert exchanges idempotently — multiple services can safely assert the same exchange.

The delayed exchange (`{exchange}.delay`) is asserted as type `x-delayed-message` with `{ durable: true, arguments: { 'x-delayed-type': 'topic' } }`. This requires the [RabbitMQ Delayed Message Exchange plugin](https://github.com/rabbitmq/rabbitmq-delayed-message-exchange).

## How Services Consume This Package

Services depend on `consumer-shared` in their `package.json`:

```json
{
  "dependencies": {
    "consumer-shared": "file:../consumer-shared"
  }
}
```

Usage pattern in a consumer service:

```typescript
import {
  ConnectionManager,
  BaseConsumer,
  BasePublisher,
  DlqHandler,
  createLogger,
  RetryableError,
  NonRetryableError,
} from "consumer-shared";
```

Services extend `BaseConsumer` and implement `processMessage()` for their business logic. Infrastructure concerns (connection, retries, logging, DLQ) are handled by the shared components.

## Testing

Uses Bun's built-in test runner. Tests use the arrange-act-assert pattern.

All RabbitMQ operations must be mocked — no real broker connections in tests. The `amqplib` library is mocked at the module level.

```typescript
import { describe, it, expect, mock, beforeEach } from "bun:test";
```

## TypeScript

- ESM modules with `.js` extensions in imports
- Strict mode enabled with `noUncheckedIndexedAccess`
- `declaration: true` in tsconfig for type exports
- All interfaces in `src/types/index.ts`

## Dependencies

- `amqplib` — RabbitMQ client
- `pino` — structured logger
- `pino-loki` — Loki transport for Pino
- `pino-pretty` — dev-only pretty printing (dev dependency)

## Environment Variables

This library does not read environment variables directly. Configuration is passed via constructor options or factory function parameters. Consuming services own their own config layer.

Exception: `createLogger` accepts an options object with `loki`, `level`, `job`, and `environment` — the consuming service reads env vars and passes them in.
