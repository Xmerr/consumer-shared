# consumer-shared

Shared infrastructure library for consumer microservices. Provides RabbitMQ connection management, base consumer/publisher abstractions, DLQ retry logic, structured logging, and common error classes.

## Install

```bash
bun add @xmer/consumer-shared
```

## Usage

```typescript
import {
  ConnectionManager,
  BaseConsumer,
  BasePublisher,
  DlqHandler,
  createLogger,
  RetryableError,
  NonRetryableError,
} from "@xmer/consumer-shared";
```

### Bootstrap a consumer service

```typescript
const logger = createLogger({
  job: "my-consumer",
  environment: "production",
  level: "info",
  loki: { host: "http://192.168.0.100:3101" },
});

const connection = new ConnectionManager({
  url: "amqp://user:pass@localhost:5672",
  reconnectAttempts: 5,
  reconnectDelayMs: 1000,
  logger,
});

await connection.connect();
const channel = connection.getChannel();

const dlqHandler = new DlqHandler({
  channel,
  exchange: "my-exchange",
  queue: "my-exchange.my.routing",
  serviceName: "my-consumer",
  logger,
});

const publisher = new BasePublisher({
  channel,
  exchange: "notifications",
  logger,
});
```

### Extend BaseConsumer

```typescript
import { BaseConsumer, NonRetryableError } from "@xmer/consumer-shared";
import type { ConsumeMessage } from "amqplib";

class OrderCreatedConsumer extends BaseConsumer {
  protected async processMessage(
    content: Record<string, unknown>,
    message: ConsumeMessage,
  ): Promise<void> {
    const orderId = content.orderId;
    if (!orderId) {
      throw new NonRetryableError("Missing orderId", "EINVALID");
    }
    // Business logic here
  }
}
```

## Components

| Component | Description |
|-----------|-------------|
| `ConnectionManager` | RabbitMQ connection lifecycle with exponential backoff reconnection |
| `BaseConsumer` | Abstract message consumer — asserts exchange/queue, delegates errors to DLQ handler |
| `BasePublisher` | Publishes JSON to topic exchanges with lazy exchange assertion |
| `DlqHandler` | DLQ retry logic — delayed exchange retries, max 20 attempts, exponential backoff capped at 16h |
| `createLogger` | Pino logger factory with optional Loki and pretty-print transports |

## Error Classes

| Class | Use Case |
|-------|----------|
| `RetryableError` | Transient failures (network timeouts, API unavailable) — triggers DLQ retry |
| `NonRetryableError` | Permanent failures (malformed data, invalid input) — routes directly to DLQ |
| `ConnectionError` | RabbitMQ connection/channel issues |
| `ConfigurationError` | Invalid configuration (includes `field` name) |

## DLQ Retry Behavior

| Attribute | Value |
|-----------|-------|
| Max retries | 20 |
| Backoff | Exponential — 0ms, 1s, 2s, 4s, 8s... capped at 16 hours |
| Delayed exchange | `{exchange}.delay` (x-delayed-message plugin) |
| DLQ queue | `{queue}.dlq` |
| Alert routing key | `notifications.dlq.{service-name}` |

## Scripts

```bash
bun run build          # Compile TypeScript to dist/
bun run lint           # Run Biome linter/formatter
bun run lint:fix       # Auto-fix lint issues
bun test               # Run all tests
bun run test:coverage  # Run tests with coverage
```
