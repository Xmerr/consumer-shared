import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { ConsumeMessage } from "amqplib";
import { NonRetryableError, RetryableError } from "../errors/index.js";
import type { IDlqHandler, ILogger } from "../types/index.js";
import { BaseConsumer } from "./base.consumer.js";

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

function createMockDlqHandler(): IDlqHandler {
	return {
		setup: mock(() => Promise.resolve()),
		handleRetryableError: mock(() => Promise.resolve()),
		handleNonRetryableError: mock(() => Promise.resolve()),
	};
}

function createMockChannel() {
	let messageHandler: ((msg: ConsumeMessage | null) => void) | null = null;

	return {
		prefetch: mock(() => Promise.resolve()),
		assertExchange: mock(() => Promise.resolve()),
		assertQueue: mock(() => Promise.resolve()),
		bindQueue: mock(() => Promise.resolve()),
		consume: mock(
			(queue: string, handler: (msg: ConsumeMessage | null) => void) => {
				messageHandler = handler;
				return Promise.resolve({ consumerTag: "test-tag" });
			},
		),
		cancel: mock(() => Promise.resolve()),
		ack: mock(() => {}),
		nack: mock(() => {}),
		simulateMessage(
			content: Record<string, unknown>,
			headers: Record<string, unknown> = {},
		): ConsumeMessage {
			const msg = {
				content: Buffer.from(JSON.stringify(content)),
				fields: {
					deliveryTag: 1,
					redelivered: false,
					exchange: "test-exchange",
					routingKey: "test.routing",
					consumerTag: "test-tag",
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
			messageHandler?.(msg);
			return msg;
		},
		simulateNull(): void {
			messageHandler?.(null);
		},
	};
}

class TestConsumer extends BaseConsumer {
	processMessageMock = mock(() => Promise.resolve());

	protected async processMessage(
		content: Record<string, unknown>,
		message: ConsumeMessage,
	): Promise<void> {
		await this.processMessageMock(content, message);
	}
}

describe("BaseConsumer", () => {
	let channel: ReturnType<typeof createMockChannel>;
	let logger: ILogger;
	let dlqHandler: IDlqHandler;
	let consumer: TestConsumer;

	beforeEach(() => {
		channel = createMockChannel();
		logger = createMockLogger();
		dlqHandler = createMockDlqHandler();
		consumer = new TestConsumer({
			channel: channel as never,
			exchange: "test-exchange",
			queue: "test-exchange.test.routing",
			routingKey: "test.routing",
			dlqHandler,
			logger,
		});
	});

	describe("start", () => {
		it("should assert exchange, queue, bind, setup DLQ, and start consuming", async () => {
			await consumer.start();

			expect(channel.prefetch).toHaveBeenCalledWith(10);
			expect(channel.assertExchange).toHaveBeenCalledWith(
				"test-exchange",
				"topic",
				{ durable: true },
			);
			expect(channel.assertQueue).toHaveBeenCalledWith(
				"test-exchange.test.routing",
				{ durable: true },
			);
			expect(channel.bindQueue).toHaveBeenCalledWith(
				"test-exchange.test.routing",
				"test-exchange",
				"test.routing",
			);
			expect(dlqHandler.setup).toHaveBeenCalledTimes(1);
			expect(channel.consume).toHaveBeenCalledTimes(1);
		});

		it("should use custom prefetch count", async () => {
			const customConsumer = new TestConsumer({
				channel: channel as never,
				exchange: "test-exchange",
				queue: "test-exchange.test.routing",
				routingKey: "test.routing",
				dlqHandler,
				logger,
				prefetchCount: 5,
			});

			await customConsumer.start();

			expect(channel.prefetch).toHaveBeenCalledWith(5);
		});
	});

	describe("stop", () => {
		it("should cancel the consumer", async () => {
			await consumer.start();
			await consumer.stop();

			expect(channel.cancel).toHaveBeenCalledWith("test-tag");
		});

		it("should handle stop when not started", async () => {
			await expect(consumer.stop()).resolves.toBeUndefined();
			expect(channel.cancel).not.toHaveBeenCalled();
		});
	});

	describe("message handling", () => {
		it("should parse JSON and delegate to processMessage", async () => {
			await consumer.start();
			const content = { key: "value", num: 42 };
			channel.simulateMessage(content);

			await new Promise((r) => setTimeout(r, 10));

			expect(consumer.processMessageMock).toHaveBeenCalledTimes(1);
			const [parsedContent] = consumer.processMessageMock.mock.calls[0] as [
				Record<string, unknown>,
			];
			expect(parsedContent).toEqual(content);
		});

		it("should ack message on successful processing", async () => {
			await consumer.start();
			const msg = channel.simulateMessage({ data: "test" });

			await new Promise((r) => setTimeout(r, 10));

			expect(channel.ack).toHaveBeenCalledWith(msg);
		});

		it("should handle null messages gracefully", async () => {
			await consumer.start();
			channel.simulateNull();

			await new Promise((r) => setTimeout(r, 10));

			expect(consumer.processMessageMock).not.toHaveBeenCalled();
			expect(channel.ack).not.toHaveBeenCalled();
		});
	});

	describe("error handling", () => {
		it("should delegate retryable errors to DLQ handler", async () => {
			const error = new RetryableError("timeout", "ETIMEOUT");
			consumer.processMessageMock.mockRejectedValue(error as never);

			await consumer.start();
			const msg = channel.simulateMessage({ data: "test" });

			await new Promise((r) => setTimeout(r, 10));

			expect(dlqHandler.handleRetryableError).toHaveBeenCalledWith(msg, error);
		});

		it("should delegate NonRetryableError to DLQ non-retryable path", async () => {
			const error = new NonRetryableError("bad data", "EINVALID");
			consumer.processMessageMock.mockRejectedValue(error as never);

			await consumer.start();
			const msg = channel.simulateMessage({ data: "bad" });

			await new Promise((r) => setTimeout(r, 10));

			expect(dlqHandler.handleNonRetryableError).toHaveBeenCalledWith(
				msg,
				error,
			);
		});

		it("should treat generic errors as retryable", async () => {
			const error = new Error("unexpected");
			consumer.processMessageMock.mockRejectedValue(error as never);

			await consumer.start();
			const msg = channel.simulateMessage({ data: "test" });

			await new Promise((r) => setTimeout(r, 10));

			expect(dlqHandler.handleRetryableError).toHaveBeenCalledWith(msg, error);
		});

		it("should nack message if DLQ handler fails", async () => {
			const processError = new Error("process failed");
			consumer.processMessageMock.mockRejectedValue(processError as never);
			(
				dlqHandler.handleRetryableError as ReturnType<typeof mock>
			).mockRejectedValue(new Error("dlq failed") as never);

			await consumer.start();
			const msg = channel.simulateMessage({ data: "test" });

			await new Promise((r) => setTimeout(r, 10));

			expect(channel.nack).toHaveBeenCalledWith(msg, false, false);
		});

		it("should handle JSON parse errors as retryable", async () => {
			await consumer.start();

			// Simulate a message with invalid JSON
			const handler = channel.consume.mock.calls[0]?.[1] as (
				msg: ConsumeMessage | null,
			) => void;
			const invalidMsg = {
				content: Buffer.from("not json"),
				fields: {
					deliveryTag: 1,
					redelivered: false,
					exchange: "test-exchange",
					routingKey: "test.routing",
					consumerTag: "test-tag",
				},
				properties: { headers: {} },
			} as ConsumeMessage;

			handler(invalidMsg);

			await new Promise((r) => setTimeout(r, 10));

			expect(dlqHandler.handleRetryableError).toHaveBeenCalledTimes(1);
		});
	});
});
