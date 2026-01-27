import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { ILogger } from "../types/index.js";
import { BasePublisher } from "./base.publisher.js";

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
		publish: mock(() => true),
	};
}

describe("BasePublisher", () => {
	let channel: ReturnType<typeof createMockChannel>;
	let logger: ILogger;
	let publisher: BasePublisher;

	beforeEach(() => {
		channel = createMockChannel();
		logger = createMockLogger();
		publisher = new BasePublisher({
			channel: channel as never,
			exchange: "test-exchange",
			logger,
		});
	});

	describe("publish", () => {
		it("should serialize content as JSON and publish to exchange", async () => {
			const content = { key: "value", count: 42 };

			await publisher.publish("test.routing", content);

			expect(channel.publish).toHaveBeenCalledTimes(1);
			const [exchange, routingKey, buffer, options] = channel.publish.mock
				.calls[0] as [string, string, Buffer, Record<string, unknown>];
			expect(exchange).toBe("test-exchange");
			expect(routingKey).toBe("test.routing");
			expect(JSON.parse(buffer.toString())).toEqual(content);
			expect(options).toEqual({
				persistent: true,
				contentType: "application/json",
			});
		});

		it("should assert exchange as topic and durable on first publish", async () => {
			await publisher.publish("test.key", { data: true });

			expect(channel.assertExchange).toHaveBeenCalledTimes(1);
			expect(channel.assertExchange).toHaveBeenCalledWith(
				"test-exchange",
				"topic",
				{ durable: true },
			);
		});

		it("should only assert exchange once across multiple publishes", async () => {
			await publisher.publish("key.1", { a: 1 });
			await publisher.publish("key.2", { b: 2 });
			await publisher.publish("key.3", { c: 3 });

			expect(channel.assertExchange).toHaveBeenCalledTimes(1);
			expect(channel.publish).toHaveBeenCalledTimes(3);
		});

		it("should propagate assertExchange errors", async () => {
			channel.assertExchange.mockRejectedValue(
				new Error("exchange error") as never,
			);

			await expect(
				publisher.publish("test.key", { data: true }),
			).rejects.toThrow("exchange error");
		});
	});
});
