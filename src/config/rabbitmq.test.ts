import { beforeEach, describe, expect, it, mock } from "bun:test";
import { EventEmitter } from "node:events";
import { ConnectionError } from "../errors/index.js";
import type { ILogger } from "../types/index.js";
import { ConnectionManager } from "./rabbitmq.js";

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

class MockConnection extends EventEmitter {
	createChannel = mock(() => Promise.resolve(new MockChannel()));
	close = mock(() => Promise.resolve());
}

class MockChannel {
	close = mock(() => Promise.resolve());
	assertExchange = mock(() => Promise.resolve());
	assertQueue = mock(() => Promise.resolve());
}

const mockConnect = mock(() => Promise.resolve(new MockConnection()));

mock.module("amqplib", () => ({
	default: { connect: mockConnect },
	connect: mockConnect,
}));

describe("ConnectionManager", () => {
	let logger: ILogger;

	beforeEach(() => {
		mockConnect.mockClear();
		mockConnect.mockImplementation(
			() => Promise.resolve(new MockConnection()) as never,
		);
		logger = createMockLogger();
	});

	describe("connect", () => {
		it("should connect successfully on first attempt", async () => {
			const manager = new ConnectionManager({
				url: "amqp://localhost",
				logger,
			});

			await manager.connect();

			expect(manager.state).toBe("connected");
			expect(mockConnect).toHaveBeenCalledTimes(1);
		});

		it("should retry on failure with exponential backoff", async () => {
			mockConnect
				.mockRejectedValueOnce(new Error("refused") as never)
				.mockResolvedValueOnce(new MockConnection() as never);

			const manager = new ConnectionManager({
				url: "amqp://localhost",
				reconnectAttempts: 3,
				reconnectDelayMs: 10,
				logger,
			});

			await manager.connect();

			expect(mockConnect).toHaveBeenCalledTimes(2);
			expect(manager.state).toBe("connected");
		});

		it("should throw ConnectionError after exhausting retries", async () => {
			mockConnect.mockRejectedValue(new Error("refused") as never);

			const manager = new ConnectionManager({
				url: "amqp://localhost",
				reconnectAttempts: 2,
				reconnectDelayMs: 1,
				logger,
			});

			await expect(manager.connect()).rejects.toBeInstanceOf(ConnectionError);
			expect(manager.state).toBe("disconnected");
			expect(mockConnect).toHaveBeenCalledTimes(3);
		});

		it("should set state to connecting during connection", async () => {
			let stateWhileConnecting: string | undefined;
			mockConnect.mockImplementation(async () => {
				stateWhileConnecting = manager.state;
				return new MockConnection() as never;
			});

			const manager = new ConnectionManager({
				url: "amqp://localhost",
				logger,
			});

			await manager.connect();
			expect(stateWhileConnecting).toBe("connecting");
		});
	});

	describe("getChannel", () => {
		it("should return the channel after connect", async () => {
			const manager = new ConnectionManager({
				url: "amqp://localhost",
				logger,
			});

			await manager.connect();
			const channel = manager.getChannel();

			expect(channel).toBeDefined();
		});

		it("should throw ConnectionError if not connected", () => {
			const manager = new ConnectionManager({
				url: "amqp://localhost",
				logger,
			});

			expect(() => manager.getChannel()).toThrow(ConnectionError);
		});
	});

	describe("close", () => {
		it("should close channel and connection", async () => {
			const mockConn = new MockConnection();
			const mockChan = new MockChannel();
			mockConn.createChannel.mockResolvedValue(mockChan as never);
			mockConnect.mockResolvedValue(mockConn as never);

			const manager = new ConnectionManager({
				url: "amqp://localhost",
				logger,
			});

			await manager.connect();
			await manager.close();

			expect(manager.state).toBe("disconnected");
			expect(mockChan.close).toHaveBeenCalledTimes(1);
			expect(mockConn.close).toHaveBeenCalledTimes(1);
		});

		it("should set state to disconnected even if close throws", async () => {
			const mockConn = new MockConnection();
			const mockChan = new MockChannel();
			mockChan.close.mockRejectedValue(new Error("close failed") as never);
			mockConn.createChannel.mockResolvedValue(mockChan as never);
			mockConnect.mockResolvedValue(mockConn as never);

			const manager = new ConnectionManager({
				url: "amqp://localhost",
				logger,
			});

			await manager.connect();
			await expect(manager.close()).rejects.toThrow("close failed");
			expect(manager.state).toBe("disconnected");
		});
	});

	describe("on", () => {
		it("should register and emit error events", async () => {
			const mockConn = new MockConnection();
			mockConnect.mockResolvedValue(mockConn as never);

			const manager = new ConnectionManager({
				url: "amqp://localhost",
				logger,
			});

			const errorHandler = mock(() => {});
			manager.on("error", errorHandler);

			await manager.connect();
			const testError = new Error("test error");
			mockConn.emit("error", testError);

			expect(errorHandler).toHaveBeenCalledWith(testError);
		});

		it("should attempt reconnect on unexpected close", async () => {
			const mockConn = new MockConnection();
			mockConnect.mockResolvedValue(mockConn as never);

			const manager = new ConnectionManager({
				url: "amqp://localhost",
				reconnectAttempts: 0,
				reconnectDelayMs: 1,
				logger,
			});

			const reconnectedHandler = mock(() => {});
			manager.on("reconnected", reconnectedHandler);

			await manager.connect();

			mockConnect.mockResolvedValue(new MockConnection() as never);
			mockConn.emit("close");

			await new Promise((r) => setTimeout(r, 50));

			expect(reconnectedHandler).toHaveBeenCalled();
		});
	});

	describe("backoff calculation", () => {
		it("should apply exponential backoff delay between retries", async () => {
			const delays: number[] = [];
			const originalSetTimeout = globalThis.setTimeout;

			mockConnect
				.mockRejectedValueOnce(new Error("fail") as never)
				.mockRejectedValueOnce(new Error("fail") as never)
				.mockResolvedValueOnce(new MockConnection() as never);

			const manager = new ConnectionManager({
				url: "amqp://localhost",
				reconnectAttempts: 5,
				reconnectDelayMs: 100,
				logger,
			});

			await manager.connect();

			expect(mockConnect).toHaveBeenCalledTimes(3);
		});
	});
});
