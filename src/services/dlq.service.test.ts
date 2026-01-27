import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { ConsumeMessage } from "amqplib";
import type { ILogger } from "../types/index.js";
import { DlqHandler } from "./dlq.service.js";

function createMockLogger(): ILogger {
	const logger: ILogger = {
		debug: mock(() => {}),
		info: mock(() => {}),
		warn: mock(() => {}),
		error: mock(() => {}),
		child: mock(() => logger),
	};
	return logger;
}

function createMockChannel() {
	return {
		assertExchange: mock(() => Promise.resolve()),
		assertQueue: mock(() => Promise.resolve()),
		bindQueue: mock(() => Promise.resolve()),
		publish: mock(() => true),
		ack: mock(() => {}),
	};
}

function createMockMessage(
	content: Record<string, unknown>,
	headers: Record<string, unknown> = {},
): ConsumeMessage {
	return {
		content: Buffer.from(JSON.stringify(content)),
		fields: {
			deliveryTag: 1,
			redelivered: false,
			exchange: "test-exchange",
			routingKey: "test.routing",
			consumerTag: "consumer-1",
		},
		properties: {
			headers,
			contentType: "application/json",
			contentEncoding: undefined,
			deliveryMode: 2,
			priority: undefined,
			correlationId: undefined,
			replyTo: undefined,
			expiration: undefined,
			messageId: undefined,
			timestamp: undefined,
			type: undefined,
			userId: undefined,
			appId: undefined,
			clusterId: undefined,
		},
	} as ConsumeMessage;
}

describe("DlqHandler", () => {
	let channel: ReturnType<typeof createMockChannel>;
	let logger: ILogger;
	let handler: DlqHandler;

	beforeEach(() => {
		channel = createMockChannel();
		logger = createMockLogger();
		handler = new DlqHandler({
			channel: channel as never,
			exchange: "test-exchange",
			queue: "test-exchange.test.routing",
			serviceName: "test-service",
			logger,
		});
	});

	describe("setup", () => {
		it("should assert delay exchange, DLQ exchange, DLQ queue, and bindings", async () => {
			await handler.setup();

			expect(channel.assertExchange).toHaveBeenCalledWith(
				"test-exchange.delay",
				"x-delayed-message",
				{ durable: true, arguments: { "x-delayed-type": "topic" } },
			);
			expect(channel.assertExchange).toHaveBeenCalledWith(
				"test-exchange.dlq",
				"topic",
				{ durable: true },
			);
			expect(channel.assertExchange).toHaveBeenCalledWith(
				"notifications",
				"topic",
				{ durable: true },
			);
			expect(channel.assertQueue).toHaveBeenCalledWith(
				"test-exchange.test.routing.dlq",
				{ durable: true },
			);
			expect(channel.bindQueue).toHaveBeenCalledWith(
				"test-exchange.test.routing.dlq",
				"test-exchange.dlq",
				"test-exchange.test.routing",
			);
		});

		it("should be idempotent when called multiple times", async () => {
			await handler.setup();
			await handler.setup();

			expect(channel.assertExchange).toHaveBeenCalledTimes(6);
			expect(channel.assertQueue).toHaveBeenCalledTimes(2);
		});
	});

	describe("handleRetryableError", () => {
		it("should publish to delay exchange on first retry with 0ms delay", async () => {
			const message = createMockMessage({ data: "test" });
			const error = new Error("transient failure");

			await handler.handleRetryableError(message, error);

			expect(channel.publish).toHaveBeenCalledTimes(1);
			const [exchange, routingKey, , options] = channel.publish.mock
				.calls[0] as [string, string, Buffer, Record<string, unknown>];
			expect(exchange).toBe("test-exchange.delay");
			expect(routingKey).toBe("test.routing");

			const headers = options.headers as Record<string, unknown>;
			expect(headers["x-delay"]).toBe(0);
			expect(headers["x-retry-count"]).toBe(1);
			expect(headers["x-last-error"]).toBe("transient failure");
			expect(headers["x-first-failure-timestamp"]).toBeDefined();

			expect(channel.ack).toHaveBeenCalledWith(message);
		});

		it("should calculate exponential backoff for subsequent retries", async () => {
			const message = createMockMessage(
				{ data: "test" },
				{
					"x-retry-count": 3,
					"x-first-failure-timestamp": "2024-01-01T00:00:00.000Z",
				},
			);
			const error = new Error("still failing");

			await handler.handleRetryableError(message, error);

			const [, , , options] = channel.publish.mock.calls[0] as [
				string,
				string,
				Buffer,
				Record<string, unknown>,
			];
			const headers = options.headers as Record<string, unknown>;
			// retry 3 -> delay = 1000 * 2^(3-1) = 4000ms
			expect(headers["x-delay"]).toBe(4000);
			expect(headers["x-retry-count"]).toBe(4);
			expect(headers["x-first-failure-timestamp"]).toBe(
				"2024-01-01T00:00:00.000Z",
			);
		});

		it("should cap delay at 16 hours", async () => {
			const message = createMockMessage(
				{ data: "test" },
				{
					"x-retry-count": 18,
					"x-first-failure-timestamp": "2024-01-01T00:00:00.000Z",
				},
			);
			const error = new Error("failing");

			await handler.handleRetryableError(message, error);

			const [, , , options] = channel.publish.mock.calls[0] as [
				string,
				string,
				Buffer,
				Record<string, unknown>,
			];
			const headers = options.headers as Record<string, unknown>;
			const maxDelay = 16 * 60 * 60 * 1000;
			expect(headers["x-delay"]).toBe(maxDelay);
		});

		it("should route to DLQ when max retries exhausted", async () => {
			const message = createMockMessage(
				{ data: "test" },
				{
					"x-retry-count": 20,
					"x-first-failure-timestamp": "2024-01-01T00:00:00.000Z",
				},
			);
			const error = new Error("exhausted");

			await handler.handleRetryableError(message, error);

			// Should publish to DLQ and notifications
			expect(channel.publish).toHaveBeenCalledTimes(2);

			const [dlqExchange, dlqRoutingKey] = channel.publish.mock.calls[0] as [
				string,
				string,
				Buffer,
				Record<string, unknown>,
			];
			expect(dlqExchange).toBe("test-exchange.dlq");
			expect(dlqRoutingKey).toBe("test-exchange.test.routing");

			const [alertExchange, alertRoutingKey] = channel.publish.mock
				.calls[1] as [string, string, Buffer, Record<string, unknown>];
			expect(alertExchange).toBe("notifications");
			expect(alertRoutingKey).toBe("notifications.dlq.test-service");

			expect(channel.ack).toHaveBeenCalledWith(message);
		});

		it("should preserve original message content in retry", async () => {
			const originalContent = { data: "important", id: 123 };
			const message = createMockMessage(originalContent);
			const error = new Error("transient");

			await handler.handleRetryableError(message, error);

			const [, , buffer] = channel.publish.mock.calls[0] as [
				string,
				string,
				Buffer,
				Record<string, unknown>,
			];
			expect(buffer).toEqual(message.content);
		});
	});

	describe("handleNonRetryableError", () => {
		it("should route directly to DLQ without retry", async () => {
			const message = createMockMessage({ data: "bad" });
			const error = new Error("malformed data");

			await handler.handleNonRetryableError(message, error);

			expect(channel.publish).toHaveBeenCalledTimes(2);

			const [dlqExchange] = channel.publish.mock.calls[0] as [
				string,
				string,
				Buffer,
				Record<string, unknown>,
			];
			expect(dlqExchange).toBe("test-exchange.dlq");

			const [, , , dlqOptions] = channel.publish.mock.calls[0] as [
				string,
				string,
				Buffer,
				Record<string, unknown>,
			];
			const headers = dlqOptions.headers as Record<string, unknown>;
			expect(headers["x-last-error"]).toBe("malformed data");

			expect(channel.ack).toHaveBeenCalledWith(message);
		});

		it("should publish alert to notifications exchange", async () => {
			const originalContent = { data: "bad-payload" };
			const message = createMockMessage(originalContent);
			const error = new Error("invalid field");

			await handler.handleNonRetryableError(message, error);

			const [exchange, routingKey, buffer] = channel.publish.mock.calls[1] as [
				string,
				string,
				Buffer,
				Record<string, unknown>,
			];
			expect(exchange).toBe("notifications");
			expect(routingKey).toBe("notifications.dlq.test-service");

			const alert = JSON.parse(buffer.toString());
			expect(alert.service).toBe("test-service");
			expect(alert.queue).toBe("test-exchange.test.routing");
			expect(alert.error).toBe("invalid field");
			expect(alert.originalMessage).toEqual(originalContent);
			expect(alert.timestamp).toBeDefined();
		});
	});

	describe("backoff schedule", () => {
		it.each([
			[0, 0],
			[1, 1000],
			[2, 2000],
			[3, 4000],
			[4, 8000],
			[5, 16000],
			[10, 512000],
		])(
			"should calculate delay for retry %i as %ims",
			async (retryCount, expectedDelay) => {
				const message = createMockMessage(
					{ data: "test" },
					{ "x-retry-count": retryCount },
				);
				const error = new Error("failing");

				await handler.handleRetryableError(message, error);

				const [, , , options] = channel.publish.mock.calls[0] as [
					string,
					string,
					Buffer,
					Record<string, unknown>,
				];
				const headers = options.headers as Record<string, unknown>;
				expect(headers["x-delay"]).toBe(expectedDelay);

				channel.publish.mockClear();
				channel.ack.mockClear();
			},
		);
	});

	describe("header propagation", () => {
		it("should preserve existing headers from the original message", async () => {
			const customHeaders = {
				"x-custom-header": "preserved",
				"x-trace-id": "abc-123",
			};
			const message = createMockMessage({ data: "test" }, customHeaders);
			const error = new Error("transient");

			await handler.handleRetryableError(message, error);

			const [, , , options] = channel.publish.mock.calls[0] as [
				string,
				string,
				Buffer,
				Record<string, unknown>,
			];
			const headers = options.headers as Record<string, unknown>;
			expect(headers["x-custom-header"]).toBe("preserved");
			expect(headers["x-trace-id"]).toBe("abc-123");
		});
	});
});
